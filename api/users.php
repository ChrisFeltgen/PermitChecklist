<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require __DIR__ . '/auth.php';

$currentUser = require_admin_auth('json');
require_admin_role($currentUser, 'full_admin');

function send_json(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

function find_user_index(array $users, string $username): ?int
{
    foreach ($users as $index => $user) {
        $existing = (string) ($user['username'] ?? '');
        if ($existing !== '' && hash_equals(strtolower($existing), strtolower($username))) {
            return $index;
        }
    }

    return null;
}

function read_json_body(): array
{
    $rawBody = file_get_contents('php://input');
    $decoded = json_decode($rawBody !== false && $rawBody !== '' ? $rawBody : '{}', true);
    return is_array($decoded) ? $decoded : [];
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $users = read_auth_users();

    if ($method === 'GET') {
        send_json(200, ['users' => array_map('public_user', $users)]);
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $role = normalize_role($body['role'] ?? 'limited_editor');

        if (!preg_match('/^[A-Za-z0-9_.-]{2,40}$/', $username)) {
            send_json(400, ['error' => 'Username must be 2-40 characters: letters, numbers, period, underscore, or hyphen.']);
        }

        if (strlen($password) < 8) {
            send_json(400, ['error' => 'Password must be at least 8 characters.']);
        }

        if (find_user_index($users, $username) !== null) {
            send_json(409, ['error' => 'That username already exists.']);
        }

        $users[] = [
            'username' => $username,
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => $role,
        ];

        if (!write_auth_users($users)) {
            send_json(500, ['error' => 'Could not save the new account.']);
        }

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $users)]);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));
        $index = find_user_index($users, $username);

        if ($index === null) {
            send_json(404, ['error' => 'No account with that username.']);
        }

        if (array_key_exists('password', $body)) {
            $password = (string) $body['password'];
            if (strlen($password) < 8) {
                send_json(400, ['error' => 'Password must be at least 8 characters.']);
            }
            $users[$index]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
        }

        if (array_key_exists('role', $body)) {
            $newRole = normalize_role($body['role']);
            $wasAdmin = normalize_role($users[$index]['role'] ?? null) === 'full_admin';

            if ($wasAdmin && $newRole !== 'full_admin' && count_admin_users($users) <= 1) {
                send_json(400, ['error' => 'Cannot demote the only remaining full admin account.']);
            }

            $users[$index]['role'] = $newRole;
        }

        if (!write_auth_users($users)) {
            send_json(500, ['error' => 'Could not save the account changes.']);
        }

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $users)]);
    }

    if ($method === 'DELETE') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));
        $index = find_user_index($users, $username);

        if ($index === null) {
            send_json(404, ['error' => 'No account with that username.']);
        }

        if (normalize_role($users[$index]['role'] ?? null) === 'full_admin' && count_admin_users($users) <= 1) {
            send_json(400, ['error' => 'Cannot remove the only remaining full admin account.']);
        }

        array_splice($users, $index, 1);

        if (!write_auth_users($users)) {
            send_json(500, ['error' => 'Could not remove the account.']);
        }

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $users)]);
    }

    header('Allow: GET, POST, PUT, DELETE');
    send_json(405, ['error' => 'Method Not Allowed']);
} catch (Throwable $error) {
    send_json(500, ['error' => $error->getMessage()]);
}
