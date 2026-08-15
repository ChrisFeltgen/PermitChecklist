<?php

declare(strict_types=1);

// Shared by api/permits.php and api/library.php — both edit different parts
// of the same checklist data, so loading, validating, and saving it lives
// in one place.
//
// Two files are involved:
//   - checklists_path() ("checklists.source.json") is the admin-only master
//     copy — everything, including draft (published: false) checklists.
//     All reads/writes in this file operate on it.
//   - public_checklists_path() ("checklists.json", same name/location the
//     public page has always fetched) is regenerated automatically on every
//     successful save, with draft checklists stripped out entirely. Drafts
//     must never reach that file: index.html (and, in production, the
//     deployed copy it fetches) reads it directly with no server involved
//     at all, so filtering has to happen here, at write time — a client-
//     side-only filter can't stop someone from requesting the raw file.
//
// Unlike authStore.php's plain locked write, saving here also takes a
// timestamped backup first and can reject a save whose expectedHash no
// longer matches what's on disk. checklists.json feeds the public checklist
// page directly, so a bad edit or two overlapping saves are worth the extra
// safety net even though the sibling project's projects.json doesn't have
// either.

// Used with array_filter() to drop unset optional fields before persisting
// a record — null, '', and [] all count as "not set". PHP's `[] !== ''` is
// true, so a plain `$v !== null && $v !== ''` predicate (what this replaced)
// lets an empty array through and persists a stray "links": [] — the Node
// dev twin already excluded empty arrays, so this keeps both backends in
// agreement about what an "unset" optional field looks like on disk.
function value_is_present($v): bool
{
    if ($v === null || $v === '') {
        return false;
    }
    return !(is_array($v) && count($v) === 0);
}

function checklists_path(): string
{
    return dirname(__DIR__, 2) . '/data/checklists.source.json';
}

function public_checklists_path(): string
{
    return dirname(__DIR__, 2) . '/data/checklists.json';
}

function checklists_backups_dir(): string
{
    return dirname(__DIR__, 2) . '/data/backups';
}

// One-time migration for existing deployments: before this source/public
// split existed, "checklists.json" WAS the full data (there was no concept
// of a draft). If the source file hasn't been created yet but the old
// public file is there, seed the source from it — same content, so nothing
// changes for a deployment with no drafts, and no manual FTP step is
// needed to pick up this change.
function bootstrap_checklists_source_if_missing(): void
{
    $sourcePath = checklists_path();
    if (is_file($sourcePath)) {
        return;
    }
    $publicPath = public_checklists_path();
    if (!is_file($publicPath)) {
        return;
    }
    copy($publicPath, $sourcePath);
}

function load_checklists(): array
{
    bootstrap_checklists_source_if_missing();

    $path = checklists_path();
    if (!is_file($path)) {
        throw new RuntimeException('checklists.source.json was not found on the server.');
    }

    $content = file_get_contents($path);
    if ($content === false) {
        throw new RuntimeException('checklists.source.json could not be read.');
    }

    $decoded = json_decode($content, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('checklists.source.json does not contain valid JSON.');
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

// Encodes $data as JSON, matching $referenceRaw's line-ending convention
// (this repo's checklist files are CRLF) so a save doesn't rewrite every
// line ending and turn a one-field edit into a full-file diff.
function encode_checklists_matching_style(array $data, string $referenceRaw): string
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $useCrlf = str_contains($referenceRaw, "\r\n");
    $output = $useCrlf ? str_replace("\n", "\r\n", $json) : $json;
    return $output . ($useCrlf ? "\r\n" : "\n");
}

// Regenerates the public checklists.json from the full (source) data,
// stripping out anything marked published: false. This is the only place
// draft filtering happens for the file the public page actually fetches —
// see the file header comment above.
function write_public_checklists(array $data): void
{
    $public = $data;
    $public['permits'] = array_values(array_filter(
        $data['permits'],
        static fn(array $p): bool => ($p['published'] ?? true) !== false
    ));

    $path = public_checklists_path();
    $existingRaw = is_file($path) ? file_get_contents($path) : false;
    $output = encode_checklists_matching_style($public, $existingRaw !== false ? $existingRaw : '');

    $written = file_put_contents($path, $output, LOCK_EX);
    if ($written === false) {
        throw new RuntimeException('Could not write the public checklists.json copy.');
    }
}

/**
 * Validates and writes $data back to checklists.source.json, then
 * regenerates the public checklists.json from it. Takes a backup of the
 * source file first and, if $expectedHash is given, rejects the save with a
 * "CONFLICT: ..." message when the file on disk no longer matches it
 * (someone else saved in between) rather than silently overwriting their
 * change.
 *
 * @throws InvalidArgumentException on validation failure.
 * @throws RuntimeException on I/O failure or a concurrency conflict.
 */
function save_checklists(array $data, ?string $expectedHash = null): void
{
    // fopen(..., 'c+') below creates an empty file if the source doesn't
    // exist yet, which would skip the same-content migration load_checklists()
    // does — bootstrap first so a save-before-any-read (unlikely, but
    // possible) doesn't start from an empty source instead of the existing
    // public data.
    bootstrap_checklists_source_if_missing();

    $errors = validate_checklists($data);
    if (!empty($errors)) {
        throw new InvalidArgumentException(implode('; ', $errors));
    }

    $path = checklists_path();
    $fp = fopen($path, 'c+');
    if (!$fp) {
        throw new RuntimeException('Unable to open checklists.source.json for writing.');
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        throw new RuntimeException('Unable to lock checklists.source.json.');
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

    $output = encode_checklists_matching_style($data, $currentRaw !== false ? $currentRaw : '');

    ftruncate($fp, 0);
    rewind($fp);
    $written = fwrite($fp, $output);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($written === false || $written < strlen($output)) {
        throw new RuntimeException('checklists.source.json write may be incomplete — check the file and restore from data/backups/ if needed.');
    }

    // Only reached once the source file is safely written — a failure here
    // still leaves the source (the canonical data) intact and backed up.
    write_public_checklists($data);
}
