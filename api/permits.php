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

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    // Auth required for every method, including GET: this endpoint reads
    // checklists.source.json, which includes drafts (published: false) —
    // only the regenerated public checklists.json (served as a plain
    // static file, drafts already stripped by write_public_checklists())
    // is safe to hand to an unauthenticated caller.
    require __DIR__ . '/auth.php';
    $currentUser = require_admin_auth('json');

    if ($method === 'GET') {
        $data = load_checklists();

        $file = $_GET['file'] ?? '';
        if ($file !== '') {
            foreach ($data['permits'] as $permit) {
                if ($permit['file'] === $file) {
                    send_json(200, ['permit' => $permit, 'hash' => checklists_hash($data)]);
                }
            }
            send_json(404, ['error' => 'Permit not found.']);
        }

        $summaries = array_map(static fn(array $p): array => [
            'file' => $p['file'],
            'name' => $p['name'] ?? $p['file'],
            'category' => $p['category'] ?? null,
            'propertyType' => $p['propertyType'] ?? null,
            'lastUpdated' => $p['lastUpdated'] ?? null,
            'published' => ($p['published'] ?? true) !== false,
        ], $data['permits']);
        send_json(200, ['permits' => $summaries, 'hash' => checklists_hash($data)]);
    }

    if ($method === 'POST') {
        require_admin_role($currentUser, 'full_editor');

        $body = json_decode(file_get_contents('php://input') ?: '{}', true);
        $body = is_array($body) ? $body : [];
        $permit = $body['permit'] ?? null;

        if (!is_array($permit) || empty($permit['file']) || empty($permit['name'])) {
            send_json(400, ['error' => "A new permit needs at least a 'file' id and a 'name'."]);
        }

        $data = load_checklists();
        foreach ($data['permits'] as $p) {
            if ($p['file'] === $permit['file']) {
                send_json(409, ['error' => "Permit '{$permit['file']}' already exists."]);
            }
        }

        if (!isset($permit['sections']) || !is_array($permit['sections'])) {
            $permit['sections'] = [];
        }
        $permit['lastUpdated'] = gmdate('Y-m-d');
        $data['permits'][] = $permit;

        try {
            save_checklists($data, $body['expectedHash'] ?? null);
        } catch (Throwable $error) {
            send_json(str_starts_with($error->getMessage(), 'CONFLICT') ? 409 : 400, ['error' => $error->getMessage()]);
        }

        send_json(200, ['ok' => true]);
    }

    if ($method === 'PUT') {
        // Limited editors can update the content of an existing permit, but
        // not create or delete one — the 'file' id is immutable here.
        require_admin_role($currentUser, 'limited_editor');

        $body = json_decode(file_get_contents('php://input') ?: '{}', true);
        $body = is_array($body) ? $body : [];
        $file = (string) ($body['file'] ?? '');
        $updated = $body['permit'] ?? null;

        if ($file === '' || !is_array($updated)) {
            send_json(400, ['error' => "'file' and 'permit' are required."]);
        }

        $data = load_checklists();
        $found = false;
        foreach ($data['permits'] as $i => $p) {
            if ($p['file'] === $file) {
                $updated['file'] = $file;
                $updated['lastUpdated'] = gmdate('Y-m-d');
                $data['permits'][$i] = $updated;
                $found = true;
                break;
            }
        }
        if (!$found) {
            send_json(404, ['error' => 'Permit not found.']);
        }

        try {
            save_checklists($data, $body['expectedHash'] ?? null);
        } catch (Throwable $error) {
            send_json(str_starts_with($error->getMessage(), 'CONFLICT') ? 409 : 400, ['error' => $error->getMessage()]);
        }

        send_json(200, ['ok' => true]);
    }

    if ($method === 'DELETE') {
        require_admin_role($currentUser, 'full_editor');

        $file = (string) ($_GET['file'] ?? '');
        $expectedHash = $_GET['expectedHash'] ?? null;
        $data = load_checklists();
        $before = count($data['permits']);
        $data['permits'] = array_values(array_filter($data['permits'], static fn(array $p): bool => $p['file'] !== $file));

        if (count($data['permits']) === $before) {
            send_json(404, ['error' => 'Permit not found.']);
        }

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
