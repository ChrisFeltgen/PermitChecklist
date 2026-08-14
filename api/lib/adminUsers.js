// Shared Basic Auth checker for admin-server.js (the Node-based local dev
// server). Mirrors api/auth.php's account concept, but reads accounts from
// an environment variable instead of the gitignored api/auth-config.json,
// since this is only ever meant to run on a developer's own machine.
//
// Configure one or more accounts with ADMIN_USERS as a JSON array:
//   ADMIN_USERS=[{"username":"admin","password":"...","role":"full_admin"}]
// A single legacy ADMIN_USER / ADMIN_PASS pair is still supported as a
// fallback (role defaults to full_admin so it exercises every tab).
//
// If nothing is configured, admin-server.js leaves local admin access
// unprotected for convenience — the real gate is the PHP session in
// api/auth.php on the actual host — and treats the visitor as a full_admin
// so every tab is testable without any setup.

const crypto = require('crypto');

const ROLES = ['limited_editor', 'full_editor', 'full_admin'];

function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'full_admin';
}

function getConfiguredUsers() {
  const raw = process.env.ADMIN_USERS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((user) => user && typeof user.username === 'string' && typeof user.password === 'string')
          .map((user) => ({ ...user, role: normalizeRole(user.role) }));
      }
    } catch {
      // Fall through to the legacy single-account env vars below.
    }
  }

  const legacyUser = process.env.ADMIN_USER;
  const legacyPass = process.env.ADMIN_PASS;

  return legacyUser && legacyPass ? [{ username: legacyUser, password: legacyPass, role: 'full_admin' }] : [];
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) {
    // Still run a same-cost comparison so failure timing doesn't leak length.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function parseBasicAuthHeader(header) {
  const match = /^Basic\s+(.+)$/i.exec(header || '');
  if (!match) return null;

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');

  return {
    username: separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex),
    password: separatorIndex === -1 ? '' : decoded.slice(separatorIndex + 1),
  };
}

// Returns { username, role } on success, or null on failure/no config.
function verifyBasicAuth(authorizationHeader) {
  const provided = parseBasicAuthHeader(authorizationHeader);
  if (!provided) return null;

  const match = getConfiguredUsers().find(
    (user) =>
      timingSafeStringEqual(user.username, provided.username) &&
      timingSafeStringEqual(user.password, provided.password)
  );

  return match ? { username: match.username, role: match.role } : null;
}

function hasConfiguredUsers() {
  return getConfiguredUsers().length > 0;
}

module.exports = { verifyBasicAuth, hasConfiguredUsers };
