<?php

declare(strict_types=1);

// Shared by api/auth.php (reading, to authenticate) and api/users.php
// (reading + writing, to manage accounts). JSON rather than a PHP-literal
// config file — safe to regenerate from user input via json_encode, where
// regenerating a .php file from user input would mean carefully escaping
// arbitrary strings into PHP source instead of data.

const ADMIN_ROLES = ['limited_editor', 'full_editor', 'full_admin'];
const ADMIN_ROLE_RANK = ['limited_editor' => 1, 'full_editor' => 2, 'full_admin' => 3];

function auth_config_path(): string
{
    return __DIR__ . '/../auth-config.json';
}

function read_auth_users(): array
{
    $path = auth_config_path();

    if (!is_file($path)) {
        return [];
    }

    $content = file_get_contents($path);
    if ($content === false) {
        return [];
    }

    $decoded = json_decode($content, true);
    $users = is_array($decoded) ? ($decoded['users'] ?? null) : null;

    return is_array($users) ? $users : [];
}

function write_auth_users(array $users): bool
{
    $json = json_encode(['users' => array_values($users)], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }

    return file_put_contents(auth_config_path(), $json . "\n", LOCK_EX) !== false;
}

// Normalizes whatever's in a user record's "role" to one of the three
// supported levels, defaulting unset/unrecognized values to the lowest
// privilege rather than silently granting more access.
function normalize_role($role): string
{
    return in_array($role, ADMIN_ROLES, true) ? $role : 'limited_editor';
}

function role_rank(string $role): int
{
    return ADMIN_ROLE_RANK[$role] ?? 0;
}

function count_admin_users(array $users): int
{
    return count(array_filter(
        $users,
        static fn(array $user): bool => normalize_role($user['role'] ?? null) === 'full_admin'
    ));
}

// Strips passwordHash — the only shape of a user record that should ever
// leave the server.
function public_user(array $user): array
{
    return [
        'username' => (string) ($user['username'] ?? ''),
        'role' => normalize_role($user['role'] ?? null),
    ];
}
