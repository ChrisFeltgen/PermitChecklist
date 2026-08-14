<?php

declare(strict_types=1);

// Shared session bootstrap for login.php, api/logout.php, and
// require_admin_auth() in api/auth.php — one place to keep the cookie
// settings consistent everywhere a session is started or read.
function start_admin_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');

    session_set_cookie_params([
        'lifetime' => 0, // session cookie — ends when the browser closes
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $isHttps,
    ]);

    session_name('permit_checklist_admin_session');
    session_start();
}

// Guards the login form's "next" (post-login redirect) parameter against
// open-redirect abuse — only a same-site relative path is ever honored,
// never an absolute URL or protocol-relative "//evil.example" one.
function is_safe_local_redirect(string $target): bool
{
    if ($target === '') {
        return false;
    }

    if (str_starts_with($target, '//') || str_contains($target, '\\')) {
        return false;
    }

    if (preg_match('#^[a-zA-Z][a-zA-Z0-9+.-]*://#', $target) === 1) {
        return false;
    }

    return preg_match('#^/?[A-Za-z0-9_.\-/]+$#', $target) === 1;
}
