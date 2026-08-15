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

function read_json_body(): array
{
    $rawBody = file_get_contents('php://input');
    $decoded = json_decode($rawBody !== false && $rawBody !== '' ? $rawBody : '{}', true);
    return is_array($decoded) ? $decoded : [];
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'GET') {
        send_json(200, ['users' => array_map('public_user', read_auth_users())]);
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

        // The duplicate-username check and the write happen inside one
        // locked read-modify-write so two simultaneous "add account"
        // requests for the same username can't both pass the check before
        // either writes.
        $updated = update_auth_users(function (array $users) use ($username, $password, $role): array {
            if (find_auth_user($users, $username) !== null) {
                send_json(409, ['error' => 'That username already exists.']);
            }
            $users[] = [
                'username' => $username,
                'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $role,
                'failedAttempts' => 0,
                'lockedUntil' => null,
            ];
            return $users;
        });

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $updated)]);
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));

        if (array_key_exists('password', $body) && strlen((string) $body['password']) < 8) {
            send_json(400, ['error' => 'Password must be at least 8 characters.']);
        }
        if (array_key_exists('role', $body) && !in_array($body['role'], ADMIN_ROLES, true)) {
            send_json(400, ['error' => 'Invalid role.']);
        }

        // The "don't demote the last full_admin" check and the write happen
        // inside one locked read-modify-write so two concurrent demotions
        // can't both pass the count check before either writes — see
        // update_auth_users()'s doc comment.
        $updated = update_auth_users(function (array $users) use ($username, $body): array {
            $index = find_auth_user_index($users, $username);
            if ($index === null) {
                send_json(404, ['error' => 'No account with that username.']);
            }

            if (array_key_exists('password', $body)) {
                $users[$index]['passwordHash'] = password_hash((string) $body['password'], PASSWORD_DEFAULT);
                $users[$index]['failedAttempts'] = 0;
                $users[$index]['lockedUntil'] = null;
            }

            if (array_key_exists('role', $body)) {
                $newRole = normalize_role($body['role']);
                $wasAdmin = normalize_role($users[$index]['role'] ?? null) === 'full_admin';

                if ($wasAdmin && $newRole !== 'full_admin' && count_admin_users($users) <= 1) {
                    send_json(400, ['error' => 'Cannot demote the only remaining full admin account.']);
                }

                $users[$index]['role'] = $newRole;
            }

            return $users;
        });

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $updated)]);
    }

    if ($method === 'DELETE') {
        $body = read_json_body();
        $username = trim((string) ($body['username'] ?? ''));

        $updated = update_auth_users(function (array $users) use ($username): array {
            $index = find_auth_user_index($users, $username);
            if ($index === null) {
                send_json(404, ['error' => 'No account with that username.']);
            }

            if (normalize_role($users[$index]['role'] ?? null) === 'full_admin' && count_admin_users($users) <= 1) {
                send_json(400, ['error' => 'Cannot remove the only remaining full admin account.']);
            }

            array_splice($users, $index, 1);
            return $users;
        });

        send_json(200, ['ok' => true, 'users' => array_map('public_user', $updated)]);
    }

    header('Allow: GET, POST, PUT, DELETE');
    send_json(405, ['error' => 'Method Not Allowed']);
} catch (Throwable $error) {
    send_json(500, ['error' => $error->getMessage()]);
}
