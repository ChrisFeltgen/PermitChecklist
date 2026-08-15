<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require_once __DIR__ . '/lib/checklistsStore.php';

function send_json(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

// Names every permit that still references a given library item, so a
// delete can warn ("still used by...") instead of silently orphaning it.
function library_item_usages(array $data, string $id): array
{
    $usages = [];
    foreach ($data['permits'] as $permit) {
        foreach ($permit['sections'] ?? [] as $section) {
            foreach ($section['items'] ?? [] as $item) {
                if (($item['id'] ?? null) === $id) {
                    $usages[] = $permit['name'] ?? $permit['file'];
                    continue 2;
                }
            }
        }
    }
    return $usages;
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    // Auth required for every method, including GET: this endpoint reads
    // checklists.source.json, which can reference library items only used
    // by draft checklists — only the regenerated public checklists.json
    // (served as a plain static file) is safe to hand to an unauthenticated
    // caller.
    require __DIR__ . '/auth.php';
    $currentUser = require_admin_auth('json');

    if ($method === 'GET') {
        $data = load_checklists();
        send_json(200, ['library' => $data['library'], 'hash' => checklists_hash($data)]);
    }

    // Limited editors can edit checklist pages but not the shared Library —
    // it's referenced by many permits at once.
    require_admin_role($currentUser, 'full_editor');

    $body = json_decode(file_get_contents('php://input') ?: '{}', true);
    $body = is_array($body) ? $body : [];

    if ($method === 'POST') {
        $id = trim((string) ($body['id'] ?? ''));
        $name = trim((string) ($body['name'] ?? ''));
        if ($id === '' || $name === '') {
            send_json(400, ['error' => "A library item needs an 'id' and a 'name'."]);
        }

        $data = load_checklists();
        if (isset($data['library'][$id])) {
            send_json(409, ['error' => "Library item '$id' already exists."]);
        }

        $data['library'][$id] = array_filter([
            'name' => $name,
            'description' => $body['description'] ?? null,
            'links' => $body['links'] ?? null,
            'variant' => $body['variant'] ?? null,
        ], 'value_is_present');

        try {
            save_checklists($data, $body['expectedHash'] ?? null);
        } catch (Throwable $error) {
            send_json(str_starts_with($error->getMessage(), 'CONFLICT') ? 409 : 400, ['error' => $error->getMessage()]);
        }

        send_json(200, ['ok' => true]);
    }

    if ($method === 'PUT') {
        $id = trim((string) ($body['id'] ?? ''));
        $data = load_checklists();

        if ($id === '' || !isset($data['library'][$id])) {
            send_json(404, ['error' => 'Library item not found.']);
        }

        $item = $data['library'][$id];
        foreach (['name', 'description', 'links', 'variant'] as $field) {
            if (array_key_exists($field, $body)) {
                $item[$field] = $body[$field];
            }
        }
        $data['library'][$id] = array_filter($item, 'value_is_present');

        try {
            save_checklists($data, $body['expectedHash'] ?? null);
        } catch (Throwable $error) {
            send_json(str_starts_with($error->getMessage(), 'CONFLICT') ? 409 : 400, ['error' => $error->getMessage()]);
        }

        send_json(200, ['ok' => true]);
    }

    if ($method === 'DELETE') {
        $id = (string) ($_GET['id'] ?? '');
        $force = ($_GET['force'] ?? '') === '1';
        $expectedHash = $_GET['expectedHash'] ?? null;

        $data = load_checklists();
        if ($id === '' || !isset($data['library'][$id])) {
            send_json(404, ['error' => 'Library item not found.']);
        }

        $usages = library_item_usages($data, $id);
        if ($usages && !$force) {
            send_json(409, ['error' => 'This item is still used by other permits.', 'usages' => $usages]);
        }

        unset($data['library'][$id]);

        try {
            save_checklists($data, $expectedHash);
        } catch (Throwable $error) {
            send_json(str_starts_with($error->getMessage(), 'CONFLICT') ? 409 : 400, ['error' => $error->getMessage()]);
        }

        send_json(200, ['ok' => true]);
    }

    header('Allow: GET, POST, PUT, DELETE');
    send_json(405, ['error' => 'Method Not Allowed']);
} catch (Throwable $error) {
    send_json(500, ['error' => $error->getMessage()]);
}
