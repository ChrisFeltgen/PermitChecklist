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
 * Returns the authenticated user's current public identity ({username,
 * role}), freshly re-checked against api/auth-config.json on every call —
 * not just whatever was stashed in the session at login time. That refresh
 * matters: without it, a session cookie left open in a browser would keep
 * its original role (or keep working at all) even after a full_admin
 * revokes or demotes that account from the Users tab, since PHP sessions
 * here have no server-side expiry (session.lifetime is 0 — "until the
 * browser closes", not a fixed TTL). Callers can gate role-specific
 * features on the returned role (see require_admin_role()) — every account
 * passes this check regardless of role; the role only matters for
 * role-gated actions.
 *
 * $onFail controls what happens when there's no valid session (or the
 * account behind it no longer exists):
 *   'redirect' (default) — for HTML pages (admin.php): sends the browser to
 *     login.php, preserving the current URL as ?next= so login returns here.
 *   'json' — for API endpoints: a fetch() call can't follow that redirect
 *     usefully, so this sends a 401 JSON body instead; admin.js sends the
 *     browser to login.php itself when it sees one.
 */
function require_admin_auth(string $onFail = 'redirect'): array
{
    start_admin_session();

    $sessionUser = $_SESSION['user'] ?? null;
    $username = is_array($sessionUser) ? (string) ($sessionUser['username'] ?? '') : '';

    if ($username !== '') {
        $currentAccount = find_auth_user(read_auth_users(), $username);
        if ($currentAccount !== null) {
            $identity = [
                'username' => (string) $currentAccount['username'],
                'role' => normalize_role($currentAccount['role'] ?? null),
            ];
            // Keep the session's cached role in sync so it doesn't drift
            // from the account record between requests.
            $_SESSION['user'] = $identity;
            return $identity;
        }

        // The account behind this session was deleted since login — drop
        // the stale session instead of continuing to honor it.
        unset($_SESSION['user']);
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
