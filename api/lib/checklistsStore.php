<?php

declare(strict_types=1);

// Shared by api/permits.php and api/library.php — both edit different parts
// of the same data/checklists.json file, so loading, validating, and saving
// it lives in one place.
//
// Unlike authStore.php's plain locked write, saving here also takes a
// timestamped backup first and can reject a save whose expectedHash no
// longer matches what's on disk. checklists.json feeds the public checklist
// page directly, so a bad edit or two overlapping saves are worth the extra
// safety net even though the sibling project's projects.json doesn't have
// either.

function checklists_path(): string
{
    return dirname(__DIR__, 2) . '/data/checklists.json';
}

function checklists_backups_dir(): string
{
    return dirname(__DIR__, 2) . '/data/backups';
}

function load_checklists(): array
{
    $path = checklists_path();
    if (!is_file($path)) {
        throw new RuntimeException('checklists.json was not found on the server.');
    }

    $content = file_get_contents($path);
    if ($content === false) {
        throw new RuntimeException('checklists.json could not be read.');
    }

    $decoded = json_decode($content, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('checklists.json does not contain valid JSON.');
    }

    if (!isset($decoded['library']) || !is_array($decoded['library'])) {
        $decoded['library'] = [];
    }
    if (!isset($decoded['permits']) || !is_array($decoded['permits'])) {
        $decoded['permits'] = [];
    }

    return $decoded;
}

// Stable hash used for optimistic-concurrency checks between load and save
// — passed back to the client as "hash", sent back as "expectedHash" on
// save, so a second overlapping save is rejected instead of silently
// clobbering the first.
function checklists_hash(array $data): string
{
    return sha1(json_encode($data));
}

/**
 * Validates the overall shape of checklists.json. Returns an array of
 * human-readable error strings; empty means valid.
 */
function validate_checklists(array $data): array
{
    $errors = [];

    if (!isset($data['library']) || !is_array($data['library'])) {
        $errors[] = "'library' must be an object";
    }
    if (!isset($data['permits']) || !is_array($data['permits'])) {
        $errors[] = "'permits' must be an array";
        return $errors;
    }

    $seenFiles = [];
    foreach ($data['permits'] as $i => $permit) {
        if (!is_array($permit)) {
            $errors[] = "permits[$i] must be an object";
            continue;
        }
        if (empty($permit['file'])) {
            $errors[] = "permits[$i] is missing 'file'";
            continue;
        }
        if (isset($seenFiles[$permit['file']])) {
            $errors[] = "duplicate permit file id '{$permit['file']}'";
        }
        $seenFiles[$permit['file']] = true;

        if (empty($permit['name'])) {
            $errors[] = "permit '{$permit['file']}' is missing 'name'";
        }
        if (empty($permit['category'])) {
            $errors[] = "permit '{$permit['file']}' is missing 'category'";
        }
        if (!isset($permit['sections']) || !is_array($permit['sections'])) {
            $errors[] = "permit '{$permit['file']}' is missing 'sections'";
            continue;
        }

        foreach ($permit['sections'] as $si => $section) {
            if (!is_array($section) || empty($section['name'])) {
                $errors[] = "permit '{$permit['file']}' section[$si] is missing 'name'";
            }
            if (!isset($section['items']) || !is_array($section['items'])) {
                $errors[] = "permit '{$permit['file']}' section[$si] is missing 'items'";
                continue;
            }
            foreach ($section['items'] as $ii => $item) {
                if (!is_array($item)) {
                    $errors[] = "permit '{$permit['file']}' section[$si] item[$ii] must be an object";
                    continue;
                }
                if (isset($item['type'])) {
                    if ($item['type'] === 'requirement') {
                        if (empty($item['label']) && empty($item['value'])) {
                            $errors[] = "permit '{$permit['file']}' section[$si] item[$ii]: requirement needs 'label'";
                        }
                    } elseif ($item['type'] === 'inspection_group') {
                        if (empty($item['label'])) {
                            $errors[] = "permit '{$permit['file']}' section[$si] item[$ii]: inspection_group needs 'label'";
                        }
                        if (!isset($item['inspections']) || !is_array($item['inspections'])) {
                            $errors[] = "permit '{$permit['file']}' section[$si] item[$ii]: inspection_group needs an 'inspections' array";
                        }
                    } else {
                        $errors[] = "permit '{$permit['file']}' section[$si] item[$ii]: unknown type '{$item['type']}'";
                    }
                } elseif (empty($item['id'])) {
                    $errors[] = "permit '{$permit['file']}' section[$si] item[$ii]: needs an 'id' (library reference) or a 'type'";
                }
            }
        }
    }

    foreach ($data['library'] as $key => $item) {
        if (!is_array($item) || empty($item['name'])) {
            $errors[] = "library item '$key' is missing 'name'";
        }
    }

    return $errors;
}

function backup_checklists(string $rawJson): void
{
    $dir = checklists_backups_dir();
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $stamp = gmdate('Ymd-His');
    $path = "$dir/checklists-{$stamp}.json";
    $suffix = 0;
    while (file_exists($path)) {
        $suffix++;
        $path = "$dir/checklists-{$stamp}-{$suffix}.json";
    }
    file_put_contents($path, $rawJson);

    // Keep the most recent 30 backups.
    $files = glob("$dir/checklists-*.json");
    if ($files && count($files) > 30) {
        sort($files);
        foreach (array_slice($files, 0, count($files) - 30) as $old) {
            @unlink($old);
        }
    }
}

/**
 * Validates and writes $data back to checklists.json. Takes a backup first
 * and, if $expectedHash is given, rejects the save with a "CONFLICT: ..."
 * message when the file on disk no longer matches it (someone else saved
 * in between) rather than silently overwriting their change.
 *
 * @throws InvalidArgumentException on validation failure.
 * @throws RuntimeException on I/O failure or a concurrency conflict.
 */
function save_checklists(array $data, ?string $expectedHash = null): void
{
    $errors = validate_checklists($data);
    if (!empty($errors)) {
        throw new InvalidArgumentException(implode('; ', $errors));
    }

    $path = checklists_path();
    $fp = fopen($path, 'c+');
    if (!$fp) {
        throw new RuntimeException('Unable to open checklists.json for writing.');
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        throw new RuntimeException('Unable to lock checklists.json.');
    }

    $currentRaw = stream_get_contents($fp);

    if ($expectedHash !== null && $currentRaw !== false && trim($currentRaw) !== '') {
        $currentData = json_decode($currentRaw, true);
        if (is_array($currentData) && checklists_hash($currentData) !== $expectedHash) {
            flock($fp, LOCK_UN);
            fclose($fp);
            throw new RuntimeException('CONFLICT: checklists.json changed since you loaded it. Reload and reapply your edit.');
        }
    }

    if ($currentRaw !== false && trim($currentRaw) !== '') {
        backup_checklists($currentRaw);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    // Match the file's existing line-ending convention (this repo's
    // checklists.json is CRLF) — otherwise every save rewrites every line
    // ending and turns a one-field edit into a full-file diff.
    $useCrlf = $currentRaw !== false && str_contains($currentRaw, "\r\n");
    $output = $useCrlf ? str_replace("\n", "\r\n", $json) : $json;
    $output .= $useCrlf ? "\r\n" : "\n";

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, $output);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}
