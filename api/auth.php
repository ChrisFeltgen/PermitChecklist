<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/authStore.php';
require_once __DIR__ . '/lib/session.php';

/**
 * Gates the admin page and its API endpoints behind a real PHP session —
 * set by login.php after verifying credentials, cleared by api/logout.php.
 * Include this at the very top of any file that needs protecting, before
 * any other output, then call require_admin_auth() explicitly.
 *
 * Returns the authenticated user's public identity ({username, role}) so
 * callers can gate role-specific features (see require_admin_role()) —
 * every account passes this check regardless of role; the role only
 * matters for role-gated actions.
 *
 * $onFail controls what happens when there's no valid session:
 *   'redirect' (default) — for HTML pages (admin.php): sends the browser to
 *     login.php, preserving the current URL as ?next= so login returns here.
 *   'json' — for API endpoints: a fetch() call can't follow that redirect
 *     usefully, so this sends a 401 JSON body instead; admin.js sends the
 *     browser to login.php itself when it sees one.
 */
function require_admin_auth(string $onFail = 'redirect'): array
{
    start_admin_session();

    $user = $_SESSION['user'] ?? null;
    if (is_array($user) && isset($user['username'])) {
        return [
            'username' => (string) $user['username'],
            'role' => normalize_role($user['role'] ?? null),
        ];
    }

    if ($onFail === 'json') {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Authentication required.']) . "\n";
        exit;
    }

    $next = urlencode($_SERVER['REQUEST_URI'] ?? 'admin.php');
    header('Location: login.php?next=' . $next);
    exit;
}

/**
 * Call after require_admin_auth() in any endpoint that needs at least
 * $minRole in the role hierarchy (limited_editor < full_editor < full_admin)
 * — e.g. require_admin_role($currentUser, 'full_admin') for account
 * management, require_admin_role($currentUser, 'full_editor') for creating
 * or deleting checklists and editing the Library.
 */
function require_admin_role(array $currentUser, string $minRole): void
{
    if (role_rank($currentUser['role'] ?? '') < role_rank($minRole)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'You do not have permission to do that.']) . "\n";
        exit;
    }
}
