// Local dev twin of the PHP admin backend (api/*.php + admin.php). Lets you
// run and click through the whole admin panel with `node admin-server.js`
// when you don't have a local PHP install — mirrors the equivalent tool in
// the sibling pompano-beach-project-map repo.
//
// Auth here is HTTP Basic (not the real session/login.php flow) and is
// opt-in — see api/lib/adminUsers.js. Nothing this file does touches
// api/auth-config.json; it never runs on the real host.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { verifyBasicAuth, hasConfiguredUsers } = require('./api/lib/adminUsers');

const root = __dirname;
const checklistsFile = path.join(root, 'data', 'checklists.json');
const backupsDir = path.join(root, 'data', 'backups');
const port = Number(process.env.PORT || 5174);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const ROLE_RANK = { limited_editor: 1, full_editor: 2, full_admin: 3 };
function hasMinRole(user, minRole) {
  return !!user && (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[minRole] || 99);
}

// Returns the local dev "session" user, or false after already sending a
// 401 (only reachable when ADMIN_USERS/ADMIN_USER+ADMIN_PASS is set).
function checkLocalAdminAuth(request, response) {
  if (!hasConfiguredUsers()) {
    return { username: 'local-dev', role: 'full_admin' };
  }

  const user = verifyBasicAuth(request.headers.authorization);
  if (user) return user;

  response.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Permit Checklist Admin"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('Authentication required.\n');
  return false;
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function readJsonBody(request) {
  const raw = await readRequestBody(request);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function serveAdminPage(request, response) {
  const adminUser = checkLocalAdminAuth(request, response);
  if (adminUser === false) return;

  try {
    const content = await fs.promises.readFile(path.join(root, 'admin.php'), 'utf8');
    // Node doesn't execute PHP — strip the leading auth-check tag and the
    // one later inline PHP expression (window.__ADMIN_USER__), matching
    // what the real PHP host renders once a request is authenticated.
    const html = content
      .replace(/^<\?php[\s\S]*?\?>\s*/, '')
      .replace(/<\?php\s+echo\s+json_encode\(\$currentAdminUser\);\s*\?>/, JSON.stringify(adminUser));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  } catch {
    response.writeHead(404);
    response.end('Not Found');
  }
}

function serveLoginNotice(response) {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(
    'This local dev server uses HTTP Basic Auth instead of login.php.\n' +
    'Set ADMIN_USERS (or ADMIN_USER/ADMIN_PASS) and visit /admin — your browser will prompt for credentials.\n' +
    'With nothing configured, /admin is open with a full_admin identity for convenience.\n'
  );
}

/* ---------------------------------------------------------------------- */
/* checklists.json store — mirrors api/lib/checklistsStore.php             */
/* ---------------------------------------------------------------------- */

async function loadChecklists() {
  const content = await fs.promises.readFile(checklistsFile, 'utf8');
  const decoded = JSON.parse(content);
  if (!decoded.library || typeof decoded.library !== 'object') decoded.library = {};
  if (!Array.isArray(decoded.permits)) decoded.permits = [];
  return decoded;
}

function checklistsHash(data) {
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
}

function validateChecklists(data) {
  const errors = [];
  if (!data.library || typeof data.library !== 'object') errors.push("'library' must be an object");
  if (!Array.isArray(data.permits)) {
    errors.push("'permits' must be an array");
    return errors;
  }

  const seen = new Set();
  data.permits.forEach((permit, i) => {
    if (!permit || typeof permit !== 'object') return errors.push(`permits[${i}] must be an object`);
    if (!permit.file) return errors.push(`permits[${i}] is missing 'file'`);
    if (seen.has(permit.file)) errors.push(`duplicate permit file id '${permit.file}'`);
    seen.add(permit.file);
    if (!permit.name) errors.push(`permit '${permit.file}' is missing 'name'`);
    if (!permit.category || (Array.isArray(permit.category) && !permit.category.length)) errors.push(`permit '${permit.file}' is missing 'category'`);
    if (!Array.isArray(permit.sections)) return errors.push(`permit '${permit.file}' is missing 'sections'`);

    permit.sections.forEach((section, si) => {
      if (!section || !section.name) errors.push(`permit '${permit.file}' section[${si}] is missing 'name'`);
      if (!Array.isArray(section && section.items)) return errors.push(`permit '${permit.file}' section[${si}] is missing 'items'`);
      section.items.forEach((item, ii) => {
        if (!item || typeof item !== 'object') return errors.push(`permit '${permit.file}' section[${si}] item[${ii}] must be an object`);
        if (item.type) {
          if (item.type === 'requirement') {
            if (!item.label && !item.value) errors.push(`permit '${permit.file}' section[${si}] item[${ii}]: requirement needs 'label'`);
          } else if (item.type === 'inspection_group') {
            if (!item.label) errors.push(`permit '${permit.file}' section[${si}] item[${ii}]: inspection_group needs 'label'`);
            if (!Array.isArray(item.inspections)) errors.push(`permit '${permit.file}' section[${si}] item[${ii}]: inspection_group needs an 'inspections' array`);
          } else {
            errors.push(`permit '${permit.file}' section[${si}] item[${ii}]: unknown type '${item.type}'`);
          }
        } else if (!item.id) {
          errors.push(`permit '${permit.file}' section[${si}] item[${ii}]: needs an 'id' (library reference) or a 'type'`);
        }
      });
    });
  });

  Object.entries(data.library).forEach(([key, item]) => {
    if (!item || typeof item !== 'object' || !item.name) errors.push(`library item '${key}' is missing 'name'`);
  });

  return errors;
}

async function backupChecklists(rawJson) {
  await fs.promises.mkdir(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let backupPath = path.join(backupsDir, `checklists-${stamp}.json`);
  let suffix = 0;
  while (fs.existsSync(backupPath)) {
    suffix += 1;
    backupPath = path.join(backupsDir, `checklists-${stamp}-${suffix}.json`);
  }
  await fs.promises.writeFile(backupPath, rawJson);

  const files = (await fs.promises.readdir(backupsDir)).filter((f) => f.startsWith('checklists-') && f.endsWith('.json')).sort();
  if (files.length > 30) {
    await Promise.all(files.slice(0, files.length - 30).map((f) => fs.promises.unlink(path.join(backupsDir, f)).catch(() => {})));
  }
}

async function saveChecklists(data, expectedHash) {
  const errors = validateChecklists(data);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  let currentRaw = '';
  try {
    currentRaw = await fs.promises.readFile(checklistsFile, 'utf8');
  } catch {
    // No existing file — nothing to conflict-check or back up.
  }

  if (expectedHash && currentRaw.trim()) {
    const currentData = JSON.parse(currentRaw);
    if (checklistsHash(currentData) !== expectedHash) {
      const err = new Error('CONFLICT: checklists.json changed since you loaded it. Reload and reapply your edit.');
      err.status = 409;
      throw err;
    }
  }

  if (currentRaw.trim()) {
    await backupChecklists(currentRaw);
  }

  // Match the file's existing line-ending convention (this repo's
  // checklists.json is CRLF) — otherwise every save rewrites every line
  // ending and turns a one-field edit into a full-file diff.
  const useCrlf = currentRaw.includes('\r\n');
  let output = JSON.stringify(data, null, 2);
  if (useCrlf) output = output.replace(/\n/g, '\r\n');
  output += useCrlf ? '\r\n' : '\n';

  await fs.promises.writeFile(checklistsFile, output, 'utf8');
}

/* ---------------------------------------------------------------------- */
/* API routes                                                              */
/* ---------------------------------------------------------------------- */

async function handlePermitsApi(request, response, url) {
  const method = request.method;

  if (method === 'GET') {
    const data = await loadChecklists();
    const file = url.searchParams.get('file');
    if (file) {
      const permit = data.permits.find((p) => p.file === file);
      if (!permit) return sendJson(response, 404, { error: 'Permit not found.' });
      return sendJson(response, 200, { permit, hash: checklistsHash(data) });
    }
    const summaries = data.permits.map((p) => ({
      file: p.file, name: p.name || p.file, category: p.category ?? null, propertyType: p.propertyType ?? null, lastUpdated: p.lastUpdated ?? null,
      published: (p.published ?? true) !== false,
    }));
    return sendJson(response, 200, { permits: summaries, hash: checklistsHash(data) });
  }

  const user = checkLocalAdminAuth(request, response);
  if (user === false) return;

  if (method === 'POST') {
    if (!hasMinRole(user, 'full_editor')) return sendJson(response, 403, { error: 'You do not have permission to do that.' });
    const body = await readJsonBody(request);
    const permit = body.permit;
    if (!permit || !permit.file || !permit.name) return sendJson(response, 400, { error: "A new permit needs at least a 'file' id and a 'name'." });

    const data = await loadChecklists();
    if (data.permits.some((p) => p.file === permit.file)) return sendJson(response, 409, { error: `Permit '${permit.file}' already exists.` });

    if (!Array.isArray(permit.sections)) permit.sections = [];
    permit.lastUpdated = new Date().toISOString().slice(0, 10);
    data.permits.push(permit);

    try {
      await saveChecklists(data, body.expectedHash);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'PUT') {
    if (!hasMinRole(user, 'limited_editor')) return sendJson(response, 403, { error: 'You do not have permission to do that.' });
    const body = await readJsonBody(request);
    const file = body.file;
    const updated = body.permit;
    if (!file || !updated || typeof updated !== 'object') return sendJson(response, 400, { error: "'file' and 'permit' are required." });

    const data = await loadChecklists();
    const index = data.permits.findIndex((p) => p.file === file);
    if (index === -1) return sendJson(response, 404, { error: 'Permit not found.' });

    updated.file = file;
    updated.lastUpdated = new Date().toISOString().slice(0, 10);
    data.permits[index] = updated;

    try {
      await saveChecklists(data, body.expectedHash);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'DELETE') {
    if (!hasMinRole(user, 'full_editor')) return sendJson(response, 403, { error: 'You do not have permission to do that.' });
    const file = url.searchParams.get('file');
    const data = await loadChecklists();
    const before = data.permits.length;
    data.permits = data.permits.filter((p) => p.file !== file);
    if (data.permits.length === before) return sendJson(response, 404, { error: 'Permit not found.' });

    try {
      await saveChecklists(data);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  response.writeHead(405, { Allow: 'GET, POST, PUT, DELETE' });
  response.end('Method Not Allowed');
}

function libraryItemUsages(data, id) {
  const usages = [];
  for (const permit of data.permits) {
    let used = false;
    for (const section of permit.sections || []) {
      for (const item of section.items || []) {
        if (item.id === id) { used = true; break; }
      }
      if (used) break;
    }
    if (used) usages.push(permit.name || permit.file);
  }
  return usages;
}

async function handleLibraryApi(request, response, url) {
  const method = request.method;

  if (method === 'GET') {
    const data = await loadChecklists();
    return sendJson(response, 200, { library: data.library, hash: checklistsHash(data) });
  }

  const user = checkLocalAdminAuth(request, response);
  if (user === false) return;
  if (!hasMinRole(user, 'full_editor')) return sendJson(response, 403, { error: 'You do not have permission to do that.' });

  if (method === 'POST') {
    const body = await readJsonBody(request);
    const id = (body.id || '').trim();
    const name = (body.name || '').trim();
    if (!id || !name) return sendJson(response, 400, { error: "A library item needs an 'id' and a 'name'." });

    const data = await loadChecklists();
    if (data.library[id]) return sendJson(response, 409, { error: `Library item '${id}' already exists.` });

    const item = {};
    if (name) item.name = name;
    if (body.description) item.description = body.description;
    if (body.links && body.links.length) item.links = body.links;
    if (body.variant) item.variant = body.variant;
    data.library[id] = item;

    try {
      await saveChecklists(data, body.expectedHash);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'PUT') {
    const body = await readJsonBody(request);
    const id = (body.id || '').trim();
    const data = await loadChecklists();
    if (!id || !data.library[id]) return sendJson(response, 404, { error: 'Library item not found.' });

    const item = { ...data.library[id] };
    ['name', 'description', 'links', 'variant'].forEach((field) => {
      if (field in body) item[field] = body[field];
    });
    const cleaned = {};
    Object.entries(item).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) cleaned[k] = v;
    });
    data.library[id] = cleaned;

    try {
      await saveChecklists(data, body.expectedHash);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    const force = url.searchParams.get('force') === '1';
    const data = await loadChecklists();
    if (!id || !data.library[id]) return sendJson(response, 404, { error: 'Library item not found.' });

    const usages = libraryItemUsages(data, id);
    if (usages.length && !force) return sendJson(response, 409, { error: 'This item is still used by other permits.', usages });

    delete data.library[id];
    try {
      await saveChecklists(data);
    } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
    return sendJson(response, 200, { ok: true });
  }

  response.writeHead(405, { Allow: 'GET, POST, PUT, DELETE' });
  response.end('Method Not Allowed');
}

function handleUsersApi(request, response) {
  // Account management writes to the gitignored api/auth-config.json on the
  // real PHP host — there's nothing meaningful for this Node twin to do
  // locally, same call the sibling project's admin-server.js makes.
  sendJson(response, 501, { error: 'User management runs on the PHP host only — not available in the local dev server.' });
}

function handleLogoutApi(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end('Method Not Allowed');
    return;
  }
  sendJson(response, 200, { ok: true });
}

/* ---------------------------------------------------------------------- */
/* Static files + router                                                   */
/* ---------------------------------------------------------------------- */

function getStaticFilePath(urlPathname) {
  const pathname = urlPathname === '/' ? '/index.html' : urlPathname;
  const filePath = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

async function serveStatic(request, response, urlPathname) {
  const filePath = getStaticFilePath(urlPathname);
  if (!filePath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fs.promises.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not Found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/admin' || url.pathname === '/admin.php') {
      await serveAdminPage(request, response);
      return;
    }
    if (url.pathname === '/login.php') {
      serveLoginNotice(response);
      return;
    }
    if (url.pathname === '/api/permits.php') {
      await handlePermitsApi(request, response, url);
      return;
    }
    if (url.pathname === '/api/library.php') {
      await handleLibraryApi(request, response, url);
      return;
    }
    if (url.pathname === '/api/users.php') {
      handleUsersApi(request, response);
      return;
    }
    if (url.pathname === '/api/logout.php') {
      handleLogoutApi(request, response);
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Permit checklist admin dev server running at http://127.0.0.1:${port}/admin`);
  if (!hasConfiguredUsers()) {
    console.log('No ADMIN_USERS configured — /admin is open, identity is { username: "local-dev", role: "full_admin" }.');
  }
});
