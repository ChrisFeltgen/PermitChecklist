/* Permit Checklist Admin — talks to api/*.php. No build step, plain JS.
 *
 * admin.php is a server-rendered, session-gated page (see api/auth.php) —
 * by the time this script runs, the visitor is already authenticated and
 * their identity is embedded as window.__ADMIN_USER__. There's no client-
 * side login flow or bootstrap fetch to do first.
 */

const ROLE_RANK = { limited_editor: 1, full_editor: 2, full_admin: 3 };

let state = {
  currentUser: null,
  dirty: false,
  library: {},
  checklistsHash: null,
  permits: [],
  currentPermitFile: null,
  currentPermit: null,
  currentLibraryId: null,
  currentLibraryItem: null,
  users: [],
};

function hasRole(minRole) {
  return !!state.currentUser && (ROLE_RANK[state.currentUser.role] || 0) >= (ROLE_RANK[minRole] || 99);
}

function roleLabel(role) {
  return { full_admin: "Full Admin", full_editor: "Full Editor", limited_editor: "Limited Editor" }[role] || role;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------------------------------------------------------------------- */
/* Fetch helper                                                            */
/* ---------------------------------------------------------------------- */

function redirectToLoginIfSessionExpired(response) {
  if (response.status === 401) {
    window.location.href = `login.php?next=${encodeURIComponent(window.location.pathname)}`;
    return true;
  }
  return false;
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const options = { method, cache: "no-store" };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (redirectToLoginIfSessionExpired(response)) {
    throw new Error("Your session expired — redirecting to login.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Failed with status ${response.status}`);
  }
  return result;
}

let toastTimer = null;
function showToast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " toast--error" : " toast--success");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function showFormError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

/* ---------------------------------------------------------------------- */
/* Bootstrap                                                               */
/* ---------------------------------------------------------------------- */

function loadCurrentUser() {
  const user = window.__ADMIN_USER__;
  state.currentUser = user && typeof user.username === "string" ? user : null;
}

async function handleLogout(event) {
  event.preventDefault();
  if (state.dirty && !confirm("You have unsaved changes. Log out anyway?")) return;
  try {
    await fetch("api/logout.php", { method: "POST", cache: "no-store" });
  } catch (e) {
    // Ignore — either way we're navigating away next.
  }
  window.location.href = "index.html";
}

function setupTabsForRole() {
  document.querySelector('.tab[data-tab="library"]').hidden = !hasRole("full_editor");
  document.querySelector('.tab[data-tab="users"]').hidden = !hasRole("full_admin");
  document.getElementById("newPermitBtn").hidden = !hasRole("full_editor");
  document.getElementById("newLibraryBtn").hidden = !hasRole("full_editor");
}

function switchTab(tab) {
  if (state.dirty && !confirm("You have unsaved changes. Switch tabs anyway?")) return;
  document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tab}`;
  });
}

async function init() {
  loadCurrentUser();
  if (!state.currentUser) {
    // admin.php always redirects unauthenticated visitors to login.php
    // server-side before this script ever runs. This only happens when
    // admin.js is served outside that gate (e.g. admin-server.js locally
    // with no ADMIN_USERS configured — see that file for what it does).
    document.getElementById("currentUserLabel").textContent = "(local dev — no login configured)";
  } else {
    document.getElementById("currentUserLabel").textContent = `${state.currentUser.username} (${roleLabel(state.currentUser.role)})`;
  }

  setupTabsForRole();
  bindStaticHandlers();

  try {
    await loadPermits();
    await loadLibrary();
    if (hasRole("full_admin")) {
      await loadUsers();
    }
  } catch (e) {
    showToast(e.message, true);
  }

  switchTab("checklists");
}

/* ---------------------------------------------------------------------- */
/* Shared text <-> structured-field helpers                                */
/* ---------------------------------------------------------------------- */

function linksToText(links) {
  return (links || []).map((l) => `${l.label || ""} | ${l.url || ""}`).join("\n");
}

function parseLinksText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("|");
      const label = idx >= 0 ? line.slice(0, idx).trim() : line.trim();
      const url = idx >= 0 ? line.slice(idx + 1).trim() : "";
      return { label, url };
    })
    .filter((l) => l.label || l.url);
}

function parseListLines(text) {
  return String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function swapArrayItems(arr, i, j) {
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

/* ---------------------------------------------------------------------- */
/* Checklists (permits) tab                                                */
/* ---------------------------------------------------------------------- */

function toEditablePermit(permit) {
  const p = JSON.parse(JSON.stringify(permit || {}));
  p.file = p.file || "";
  p.category = p.category || "";
  p.__categoryText = Array.isArray(p.category) ? p.category.join(", ") : p.category || "";
  p.__propertyTypeText = Array.isArray(p.propertyType) ? p.propertyType.join(", ") : "";
  p.__nocRequired = p.noticeOfCommencementRequired !== false;
  p.__published = p.published !== false;
  p.sections = (p.sections || []).map((s) => ({
    ...s,
    items: (s.items || []).map((item) => ({
      ...item,
      label: (item.label !== undefined ? item.label : item.value) || "",
      __linksText: linksToText(item.links),
      __inspectionsText: (item.inspections || []).join("\n"),
    })),
  }));
  return p;
}

function cleanItem(item) {
  const links = parseLinksText(item.__linksText || "");
  if (item.type === "requirement") {
    const out = { type: "requirement", label: (item.label || "").trim() };
    if (item.description) out.description = item.description;
    if (links.length) out.links = links;
    return out;
  }
  if (item.type === "inspection_group") {
    return {
      type: "inspection_group",
      label: (item.label || "").trim(),
      inspections: parseListLines(item.__inspectionsText || ""),
    };
  }
  const out = { id: (item.id || "").trim() };
  if (item.label) out.label = item.label;
  if (item.description) out.description = item.description;
  if (links.length) out.links = links;
  if (item.variant) out.variant = item.variant;
  return out;
}

function derivePermitForSave(draft) {
  const permit = {};
  permit.file = (draft.file || "").trim();
  permit.name = (draft.name || "").trim();

  const catParts = (draft.__categoryText || "").split(",").map((s) => s.trim()).filter(Boolean);
  permit.category = catParts.length <= 1 ? (catParts[0] || "") : catParts;

  const ptParts = (draft.__propertyTypeText || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ptParts.length) permit.propertyType = ptParts;

  if (draft.whenPermitRequired) permit.whenPermitRequired = draft.whenPermitRequired;
  if (draft.hintTitle) permit.hintTitle = draft.hintTitle;
  if (draft.hint) permit.hint = draft.hint;
  if (draft.noticeOfCommencement) permit.noticeOfCommencement = draft.noticeOfCommencement;
  if (draft.noticeOfCommencementRequirementId) permit.noticeOfCommencementRequirementId = draft.noticeOfCommencementRequirementId;
  if (draft.__nocRequired === false) permit.noticeOfCommencementRequired = false;
  if (draft.__published === false) permit.published = false;

  permit.sections = (draft.sections || []).map((section) => ({
    name: (section.name || "").trim(),
    items: (section.items || []).map(cleanItem),
  }));

  return permit;
}

function formatCategory(cat) {
  if (!cat) return "";
  return Array.isArray(cat) ? cat.join(", ") : cat;
}

async function loadPermits() {
  const res = await apiFetch("api/permits.php");
  state.permits = res.permits;
  state.checklistsHash = res.hash;
  renderPermitList();
}

function renderPermitList() {
  const list = document.getElementById("permitList");
  const filter = document.getElementById("permitSearch").value.trim().toLowerCase();
  const items = state.permits
    .filter((p) => !filter || (p.name || "").toLowerCase().includes(filter) || (p.file || "").toLowerCase().includes(filter))
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  list.innerHTML = items.map((p) => `
    <li data-file="${escapeHtml(p.file)}" class="${p.file === state.currentPermitFile ? "active" : ""}">
      ${escapeHtml(p.name || p.file)}
      ${p.published === false ? '<span class="badge badge--draft">Draft</span>' : ""}
      <span class="meta">${escapeHtml(formatCategory(p.category))}${p.lastUpdated ? " · Updated " + escapeHtml(p.lastUpdated) : ""}</span>
    </li>
  `).join("") || '<li class="empty-state">No checklists found.</li>';
}

async function selectPermit(file) {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  try {
    const res = await apiFetch(`api/permits.php?file=${encodeURIComponent(file)}`);
    state.checklistsHash = res.hash;
    state.currentPermitFile = file;
    state.currentPermit = toEditablePermit(res.permit);
    state.dirty = false;
    renderPermitEditor();
    renderPermitList();
  } catch (e) {
    showToast(e.message, true);
  }
}

function newPermit() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.currentPermitFile = null;
  state.currentPermit = toEditablePermit({ sections: [] });
  state.currentPermit.__isNew = true;
  // New checklists start as drafts — staff build them out before choosing
  // to publish, rather than the public seeing a half-finished page.
  state.currentPermit.__published = false;
  state.dirty = false;
  renderPermitEditor();
  renderPermitList();
}

function renderPermitEditor() {
  const container = document.getElementById("permitEditor");
  if (!state.currentPermit) {
    container.innerHTML = '<p class="empty-state">Select a checklist on the left, or create a new one.</p>';
    return;
  }
  container.innerHTML = buildPermitFormHTML(state.currentPermit, state.currentPermit.__isNew === true);
}

// Notice of Commencement library items (req_notice_of_commencement,
// req_notice_of_commencement_hvac_15000, and any future variant) are only
// ever meant to be shown via the automatic box controlled by the "Show
// Notice of Commencement box" checkbox and requirement id override below —
// never added by hand as a section item, or the checklist ends up with two
// copies of the same yellow box.
function isNoticeOfCommencementLibraryId(id) {
  return typeof id === "string" && id.startsWith("req_notice_of_commencement");
}

function buildPermitFormHTML(p, isNew) {
  const libraryOptions = Object.entries(state.library)
    .filter(([id]) => !isNoticeOfCommencementLibraryId(id))
    .slice()
    .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""))
    .map(([id, item]) => `<option value="${escapeHtml(id)}">${escapeHtml(item.name || id)}</option>`)
    .join("");

  const sectionsHtml = (p.sections || []).map((section, si) => buildSectionHTML(section, si, p.sections.length)).join("")
    || '<p class="empty-state">No sections yet.</p>';

  return `
    <form class="editor-form" id="permitForm">
      <datalist id="libraryOptionsList">${libraryOptions}</datalist>

      <div class="status-row">
        <span class="badge ${p.__published ? "badge--live" : "badge--draft"}">${p.__published ? "Published" : "Draft"}</span>
        <label class="checkbox-row">
          <input type="checkbox" data-field="__published" ${p.__published ? "checked" : ""}>
          Published (visible on the public checklist page)
        </label>
        <div class="spacer"></div>
        <button type="button" class="btn btn--ghost btn--small" data-action="preview-permit">Preview</button>
      </div>

      <div class="field-grid">
        <label>Permit file id (URL key)
          <input type="text" data-field="file" value="${escapeHtml(p.file || "")}" ${isNew ? "" : "disabled"} placeholder="e.g. water_heater_changeout">
        </label>
        <label>Name
          <input type="text" data-field="name" value="${escapeHtml(p.name || "")}" required>
        </label>
        <label>Category (comma-separated)
          <input type="text" data-field="__categoryText" value="${escapeHtml(p.__categoryText || "")}" placeholder="Building, Electrical" required>
        </label>
        <label>Property types (comma-separated, blank = all)
          <input type="text" data-field="__propertyTypeText" value="${escapeHtml(p.__propertyTypeText || "")}" placeholder="Residential, Commercial">
        </label>
      </div>

      <label>When Permit Required (blue callout)
        <textarea data-field="whenPermitRequired">${escapeHtml(p.whenPermitRequired || "")}</textarea>
      </label>

      <div class="field-grid">
        <label>Hint title (green callout)
          <input type="text" data-field="hintTitle" value="${escapeHtml(p.hintTitle || "")}">
        </label>
        <label>Hint body
          <input type="text" data-field="hint" value="${escapeHtml(p.hint || "")}">
        </label>
      </div>

      <p class="empty-state">Last updated: ${p.lastUpdated ? escapeHtml(p.lastUpdated) : "(will be set on save)"}</p>

      <h2>Sections</h2>
      <div id="sectionsContainer">${sectionsHtml}</div>
      <button type="button" class="btn btn--ghost btn--small" data-action="add-section">+ Add Section</button>

      <h2>Notice of Commencement</h2>
      <p class="empty-state">Always shown last on the public checklist, after all sections above.</p>
      <label>Notice of Commencement text (yellow callout)
        <textarea data-field="noticeOfCommencement">${escapeHtml(p.noticeOfCommencement || "")}</textarea>
      </label>

      <div class="field-grid">
        <label class="checkbox-row">
          <input type="checkbox" data-field="__nocRequired" ${p.__nocRequired ? "checked" : ""}>
          Show Notice of Commencement box
        </label>
        <label>Notice of Commencement requirement id override
          <input type="text" data-field="noticeOfCommencementRequirementId" value="${escapeHtml(p.noticeOfCommencementRequirementId || "")}" placeholder="req_notice_of_commencement (default)">
        </label>
      </div>

      <p class="form-error" id="permitFormError" hidden></p>

      <div class="editor-actions">
        ${!isNew && hasRole("full_editor") ? '<button type="button" class="btn btn--danger" data-action="delete-permit">Delete Checklist</button>' : ""}
        <div class="spacer"></div>
        <button type="button" class="btn btn--ghost" data-action="cancel-permit">Cancel</button>
        <button type="submit" class="btn btn--primary">${isNew ? "Create Checklist" : "Save Changes"}</button>
      </div>
    </form>
  `;
}

function buildSectionHTML(section, si, total) {
  const itemsHtml = (section.items || []).map((item, ii) => buildItemHTML(item, si, ii, section.items.length)).join("")
    || '<p class="empty-state">No items in this section.</p>';
  return `
    <div class="section-block" data-section-index="${si}">
      <div class="section-block__head">
        <input type="text" data-field="name" data-scope="section" data-section-index="${si}" value="${escapeHtml(section.name || "")}" placeholder="Section name">
        <button type="button" class="icon-btn" data-action="move-section-up" data-section-index="${si}" ${si === 0 ? "disabled" : ""} title="Move up">&uarr;</button>
        <button type="button" class="icon-btn" data-action="move-section-down" data-section-index="${si}" ${si === total - 1 ? "disabled" : ""} title="Move down">&darr;</button>
        <button type="button" class="icon-btn" data-action="remove-section" data-section-index="${si}" title="Remove section">&times;</button>
      </div>
      <div class="items-container">${itemsHtml}</div>
      <button type="button" class="btn btn--ghost btn--small" data-action="add-item" data-section-index="${si}">+ Add Item</button>
    </div>
  `;
}

function buildItemHTML(item, si, ii, total) {
  const kind = item.type === "requirement" ? "requirement" : item.type === "inspection_group" ? "inspection_group" : "library_ref";
  const attrs = `data-scope="item" data-section-index="${si}" data-item-index="${ii}"`;

  let bodyHtml = "";
  if (kind === "library_ref") {
    bodyHtml = `
      <label>Library item
        <input type="text" list="libraryOptionsList" data-field="id" ${attrs} value="${escapeHtml(item.id || "")}" placeholder="library item id">
      </label>
      <details>
        <summary>Overrides (optional)</summary>
        <label>Label override
          <input type="text" data-field="label" ${attrs} value="${escapeHtml(item.label || "")}">
        </label>
        <label>Description override
          <textarea data-field="description" ${attrs}>${escapeHtml(item.description || "")}</textarea>
        </label>
        <label>Links override (one per line: Label | URL)
          <textarea data-field="__linksText" ${attrs}>${escapeHtml(item.__linksText || "")}</textarea>
        </label>
        <label>Variant override
          <select data-field="variant" ${attrs}>
            <option value="">(default)</option>
            <option value="notice" ${item.variant === "notice" ? "selected" : ""}>Notice</option>
          </select>
        </label>
      </details>
    `;
  } else if (kind === "requirement") {
    bodyHtml = `
      <label>Label
        <input type="text" data-field="label" ${attrs} value="${escapeHtml(item.label || "")}" required>
      </label>
      <label>Description
        <textarea data-field="description" ${attrs}>${escapeHtml(item.description || "")}</textarea>
      </label>
      <label>Links (one per line: Label | URL)
        <textarea data-field="__linksText" ${attrs}>${escapeHtml(item.__linksText || "")}</textarea>
      </label>
    `;
  } else {
    bodyHtml = `
      <label>Label
        <input type="text" data-field="label" ${attrs} value="${escapeHtml(item.label || "")}" required>
      </label>
      <label>Inspections (one per line)
        <textarea data-field="__inspectionsText" ${attrs}>${escapeHtml(item.__inspectionsText || "")}</textarea>
      </label>
    `;
  }

  return `
    <div class="item-block" data-section-index="${si}" data-item-index="${ii}">
      <div class="item-block__head">
        <select data-action="change-item-type" data-section-index="${si}" data-item-index="${ii}">
          <option value="library_ref" ${kind === "library_ref" ? "selected" : ""}>Library Reference</option>
          <option value="requirement" ${kind === "requirement" ? "selected" : ""}>Requirement</option>
          <option value="inspection_group" ${kind === "inspection_group" ? "selected" : ""}>Inspection Group</option>
        </select>
        <div class="grow"></div>
        <button type="button" class="icon-btn" data-action="move-item-up" data-section-index="${si}" data-item-index="${ii}" ${ii === 0 ? "disabled" : ""} title="Move up">&uarr;</button>
        <button type="button" class="icon-btn" data-action="move-item-down" data-section-index="${si}" data-item-index="${ii}" ${ii === total - 1 ? "disabled" : ""} title="Move down">&darr;</button>
        <button type="button" class="icon-btn" data-action="remove-item" data-section-index="${si}" data-item-index="${ii}" title="Remove item">&times;</button>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function changeItemType(si, ii, newKind) {
  const item = state.currentPermit.sections[si].items[ii];
  const label = item.label || "";
  let newItem;
  if (newKind === "requirement") {
    newItem = { type: "requirement", label, description: item.description || "", __linksText: item.__linksText || "" };
  } else if (newKind === "inspection_group") {
    newItem = { type: "inspection_group", label, __inspectionsText: item.__inspectionsText || "" };
  } else {
    newItem = { id: item.id || "", label: "", __linksText: item.__linksText || "" };
  }
  state.currentPermit.sections[si].items[ii] = newItem;
  state.dirty = true;
  renderPermitEditor();
}

function onPermitEditorInput(e) {
  const el = e.target;
  const field = el.dataset.field;
  if (!field || !state.currentPermit || el.type === "checkbox" || el.tagName === "SELECT") return;
  state.dirty = true;
  const scope = el.dataset.scope;
  if (scope === "item") {
    state.currentPermit.sections[Number(el.dataset.sectionIndex)].items[Number(el.dataset.itemIndex)][field] = el.value;
  } else if (scope === "section") {
    state.currentPermit.sections[Number(el.dataset.sectionIndex)][field] = el.value;
  } else {
    state.currentPermit[field] = el.value;
  }
}

function onPermitEditorChange(e) {
  const el = e.target;
  const field = el.dataset.field;
  if (field && state.currentPermit) {
    state.dirty = true;
    const value = el.type === "checkbox" ? el.checked : el.value;
    const scope = el.dataset.scope;
    if (scope === "item") {
      state.currentPermit.sections[Number(el.dataset.sectionIndex)].items[Number(el.dataset.itemIndex)][field] = value;
    } else if (scope === "section") {
      state.currentPermit.sections[Number(el.dataset.sectionIndex)][field] = value;
    } else {
      state.currentPermit[field] = value;
      if (field === "__published") {
        // Checkbox toggle, not a text field — a full re-render is fine and
        // keeps the Draft/Published badge in sync immediately.
        renderPermitEditor();
        return;
      }
    }
    return;
  }
  if (el.dataset.action === "change-item-type") {
    changeItemType(Number(el.dataset.sectionIndex), Number(el.dataset.itemIndex), el.value);
  }
}

function onPermitEditorClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn || !state.currentPermit) return;
  const action = btn.dataset.action;
  const si = btn.dataset.sectionIndex !== undefined ? Number(btn.dataset.sectionIndex) : null;
  const ii = btn.dataset.itemIndex !== undefined ? Number(btn.dataset.itemIndex) : null;

  if (action === "add-section") {
    state.currentPermit.sections = state.currentPermit.sections || [];
    state.currentPermit.sections.push({ name: "", items: [] });
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "remove-section") {
    if (!confirm("Remove this section and all of its items?")) return;
    state.currentPermit.sections.splice(si, 1);
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "move-section-up" || action === "move-section-down") {
    swapArrayItems(state.currentPermit.sections, si, si + (action === "move-section-up" ? -1 : 1));
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "add-item") {
    state.currentPermit.sections[si].items = state.currentPermit.sections[si].items || [];
    state.currentPermit.sections[si].items.push({ id: "", label: "", __linksText: "" });
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "remove-item") {
    state.currentPermit.sections[si].items.splice(ii, 1);
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "move-item-up" || action === "move-item-down") {
    swapArrayItems(state.currentPermit.sections[si].items, ii, ii + (action === "move-item-up" ? -1 : 1));
    state.dirty = true;
    renderPermitEditor();
  } else if (action === "delete-permit") {
    deleteCurrentPermit();
  } else if (action === "preview-permit") {
    previewCurrentPermit();
  } else if (action === "cancel-permit") {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    state.currentPermitFile = null;
    state.currentPermit = null;
    state.dirty = false;
    renderPermitEditor();
    renderPermitList();
  }
}

async function onPermitFormSubmit(e) {
  e.preventDefault();
  await savePermit();
}

async function savePermit() {
  const errorEl = document.getElementById("permitFormError");
  errorEl.hidden = true;
  const isNew = state.currentPermit.__isNew === true;
  const payload = derivePermitForSave(state.currentPermit);

  if (!payload.file) return showFormError(errorEl, "A permit file id is required.");
  if (isNew && !/^[a-z0-9_]+$/.test(payload.file)) {
    return showFormError(errorEl, "File id should be lowercase letters, numbers, and underscores only (e.g. water_heater_changeout).");
  }
  if (!payload.name) return showFormError(errorEl, "A name is required.");
  if (!payload.category || (Array.isArray(payload.category) && !payload.category.length)) {
    return showFormError(errorEl, "At least one category is required.");
  }
  const hasManualNoc = payload.sections.some((s) => s.items.some((it) => isNoticeOfCommencementLibraryId(it.id)));
  if (hasManualNoc) {
    return showFormError(errorEl, 'Remove the Notice of Commencement item from your sections — it\'s added automatically. Use "Show Notice of Commencement box" below Sections instead.');
  }

  try {
    if (isNew) {
      await apiFetch("api/permits.php", { method: "POST", body: { permit: payload, expectedHash: state.checklistsHash } });
      showToast("Checklist created");
    } else {
      await apiFetch("api/permits.php", { method: "PUT", body: { file: payload.file, permit: payload, expectedHash: state.checklistsHash } });
      showToast("Checklist saved");
    }
    state.dirty = false;
    await loadPermits();
    await selectPermit(payload.file);
  } catch (e) {
    showFormError(errorEl, e.message);
  }
}

// Opens index.html in a new tab rendering exactly what's currently in the
// editor — including unsaved edits and drafts, which the live page would
// otherwise never show. Hands the data across via sessionStorage rather
// than checklists.json, since index.html normally only ever reads that
// file; window.open() copies sessionStorage into the new tab for us.
function previewCurrentPermit() {
  const payload = derivePermitForSave(state.currentPermit);
  const previewFile = payload.file || "preview_draft";
  payload.file = previewFile;
  try {
    sessionStorage.setItem("checklistPreview", JSON.stringify({ permit: payload, library: state.library }));
  } catch (e) {
    showToast("Could not start preview: " + e.message, true);
    return;
  }
  window.open(`index.html?preview=1&permit=${encodeURIComponent(previewFile)}`, "_blank");
}

async function deleteCurrentPermit() {
  if (!state.currentPermit || state.currentPermit.__isNew) return;
  const file = state.currentPermit.file;
  if (!confirm(`Delete the "${state.currentPermit.name || file}" checklist? A backup is kept on the server, but this can't be undone from the admin page.`)) return;
  try {
    await apiFetch(`api/permits.php?file=${encodeURIComponent(file)}`, { method: "DELETE" });
    showToast("Checklist deleted");
    state.currentPermit = null;
    state.currentPermitFile = null;
    state.dirty = false;
    await loadPermits();
    renderPermitEditor();
  } catch (e) {
    showToast(e.message, true);
  }
}

/* ---------------------------------------------------------------------- */
/* Library tab                                                             */
/* ---------------------------------------------------------------------- */

function toEditableLibraryItem(id, item) {
  const it = JSON.parse(JSON.stringify(item || {}));
  it.id = id || "";
  it.__linksText = linksToText(it.links);
  it.variant = it.variant || "";
  return it;
}

async function loadLibrary() {
  const res = await apiFetch("api/library.php");
  state.library = res.library;
  state.checklistsHash = res.hash;
  renderLibraryList();
}

function renderLibraryList() {
  const list = document.getElementById("libraryList");
  const filter = document.getElementById("librarySearch").value.trim().toLowerCase();
  const entries = Object.entries(state.library)
    .filter(([id, item]) => !filter || (item.name || "").toLowerCase().includes(filter) || id.toLowerCase().includes(filter))
    .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));
  list.innerHTML = entries.map(([id, item]) => `
    <li data-id="${escapeHtml(id)}" class="${id === state.currentLibraryId ? "active" : ""}">
      ${escapeHtml(item.name || id)}
      <span class="meta">${escapeHtml(id)}</span>
    </li>
  `).join("") || '<li class="empty-state">No library items found.</li>';
}

async function selectLibraryItem(id) {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.currentLibraryId = id;
  state.currentLibraryItem = toEditableLibraryItem(id, state.library[id]);
  state.dirty = false;
  renderLibraryEditor();
  renderLibraryList();
}

function newLibraryItem() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.currentLibraryId = null;
  state.currentLibraryItem = toEditableLibraryItem("", {});
  state.currentLibraryItem.__isNew = true;
  state.dirty = false;
  renderLibraryEditor();
  renderLibraryList();
}

function renderLibraryEditor() {
  const container = document.getElementById("libraryEditor");
  if (!state.currentLibraryItem) {
    container.innerHTML = '<p class="empty-state">Select a library item on the left, or create a new one.</p>';
    return;
  }
  container.innerHTML = buildLibraryFormHTML(state.currentLibraryItem, state.currentLibraryItem.__isNew === true);
}

function buildLibraryFormHTML(item, isNew) {
  return `
    <form class="editor-form" id="libraryForm">
      <label>Item id (key)
        <input type="text" data-field="id" value="${escapeHtml(item.id || "")}" ${isNew ? "" : "disabled"} placeholder="e.g. app_building">
      </label>
      <label>Name
        <input type="text" data-field="name" value="${escapeHtml(item.name || "")}" required>
      </label>
      <label>Description
        <textarea data-field="description">${escapeHtml(item.description || "")}</textarea>
      </label>
      <label>Links (one per line: Label | URL)
        <textarea data-field="__linksText">${escapeHtml(item.__linksText || "")}</textarea>
      </label>
      <label>Variant
        <select data-field="variant">
          <option value="">(default)</option>
          <option value="notice" ${item.variant === "notice" ? "selected" : ""}>Notice</option>
        </select>
      </label>
      <p class="form-error" id="libraryFormError" hidden></p>
      <div class="editor-actions">
        ${!isNew ? '<button type="button" class="btn btn--danger" data-action="delete-library">Delete Item</button>' : ""}
        <div class="spacer"></div>
        <button type="button" class="btn btn--ghost" data-action="cancel-library">Cancel</button>
        <button type="submit" class="btn btn--primary">${isNew ? "Create Item" : "Save Changes"}</button>
      </div>
    </form>
  `;
}

function onLibraryEditorInputOrChange(e) {
  const field = e.target.dataset.field;
  if (!field || !state.currentLibraryItem) return;
  state.dirty = true;
  state.currentLibraryItem[field] = e.target.value;
}

function onLibraryEditorClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "delete-library") {
    deleteCurrentLibraryItem();
  } else if (btn.dataset.action === "cancel-library") {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    state.currentLibraryItem = null;
    state.currentLibraryId = null;
    state.dirty = false;
    renderLibraryEditor();
    renderLibraryList();
  }
}

async function onLibraryFormSubmit(e) {
  e.preventDefault();
  await saveLibraryItem();
}

async function saveLibraryItem() {
  const errorEl = document.getElementById("libraryFormError");
  errorEl.hidden = true;
  const item = state.currentLibraryItem;
  const isNew = item.__isNew === true;
  const id = (item.id || "").trim();
  const name = (item.name || "").trim();
  if (!id) return showFormError(errorEl, "An item id is required.");
  if (!name) return showFormError(errorEl, "A name is required.");

  const body = {
    id,
    name,
    description: item.description || "",
    links: parseLinksText(item.__linksText || ""),
    variant: item.variant || "",
    expectedHash: state.checklistsHash,
  };

  try {
    if (isNew) {
      await apiFetch("api/library.php", { method: "POST", body });
      showToast("Library item created");
    } else {
      await apiFetch("api/library.php", { method: "PUT", body });
      showToast("Library item saved");
    }
    state.dirty = false;
    await loadLibrary();
    await selectLibraryItem(id);
  } catch (e) {
    showFormError(errorEl, e.message);
  }
}

async function afterLibraryDelete() {
  showToast("Library item deleted");
  state.currentLibraryItem = null;
  state.currentLibraryId = null;
  await loadLibrary();
  renderLibraryEditor();
}

async function deleteCurrentLibraryItem() {
  const item = state.currentLibraryItem;
  if (!item || item.__isNew) return;
  const id = item.id;
  if (!confirm(`Delete the "${item.name || id}" library item?`)) return;
  try {
    await apiFetch(`api/library.php?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await afterLibraryDelete();
  } catch (e) {
    if (String(e.message).includes("still used by")) {
      if (confirm(`"${item.name || id}" is still in use by other permits.\n\nDelete anyway? Those checklists will show the raw id until updated.`)) {
        try {
          await apiFetch(`api/library.php?id=${encodeURIComponent(id)}&force=1`, { method: "DELETE" });
          await afterLibraryDelete();
        } catch (e2) {
          showToast(e2.message, true);
        }
      }
    } else {
      showToast(e.message, true);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Users tab                                                               */
/* ---------------------------------------------------------------------- */

async function loadUsers() {
  const res = await apiFetch("api/users.php");
  state.users = res.users;
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = state.users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>
        <select data-action="change-role" data-username="${escapeHtml(u.username)}">
          <option value="limited_editor" ${u.role === "limited_editor" ? "selected" : ""}>Limited editor</option>
          <option value="full_editor" ${u.role === "full_editor" ? "selected" : ""}>Full editor</option>
          <option value="full_admin" ${u.role === "full_admin" ? "selected" : ""}>Full admin</option>
        </select>
      </td>
      <td class="row-actions">
        <button type="button" class="btn btn--ghost btn--small" data-action="reset-password" data-username="${escapeHtml(u.username)}">Reset password</button>
        <button type="button" class="btn btn--danger btn--small" data-action="delete-user" data-username="${escapeHtml(u.username)}" ${state.currentUser && u.username === state.currentUser.username ? "disabled" : ""}>Delete</button>
      </td>
    </tr>
  `).join("");
}

async function resetPassword(username) {
  const pw = window.prompt(`New temporary password for ${username} (min 8 characters):`);
  if (pw === null) return;
  if (pw.length < 8) {
    showToast("Password must be at least 8 characters", true);
    return;
  }
  try {
    await apiFetch("api/users.php", { method: "PUT", body: { username, password: pw } });
    showToast("Password updated");
  } catch (e) {
    showToast(e.message, true);
  }
}

async function onUsersTableChange(e) {
  const sel = e.target.closest('[data-action="change-role"]');
  if (!sel) return;
  try {
    await apiFetch("api/users.php", { method: "PUT", body: { username: sel.dataset.username, role: sel.value } });
    showToast("Role updated");
    await loadUsers();
  } catch (e2) {
    showToast(e2.message, true);
    await loadUsers();
  }
}

async function onUsersTableClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const username = btn.dataset.username;
  if (btn.dataset.action === "reset-password") {
    await resetPassword(username);
  } else if (btn.dataset.action === "delete-user") {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      await apiFetch("api/users.php", { method: "DELETE", body: { username } });
      showToast("User deleted");
      await loadUsers();
    } catch (e2) {
      showToast(e2.message, true);
    }
  }
}

async function onNewUserSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("newUserError");
  errorEl.hidden = true;
  const username = document.getElementById("newUserUsername").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role = document.getElementById("newUserRole").value;
  if (!username || password.length < 8) {
    showFormError(errorEl, "Username and a password of at least 8 characters are required.");
    return;
  }
  try {
    await apiFetch("api/users.php", { method: "POST", body: { username, password, role } });
    showToast("User added");
    e.target.reset();
    await loadUsers();
  } catch (e2) {
    showFormError(errorEl, e2.message);
  }
}

/* ---------------------------------------------------------------------- */
/* Static event wiring (runs once at startup)                              */
/* ---------------------------------------------------------------------- */

function bindStaticHandlers() {
  document.getElementById("logoutButton").addEventListener("click", handleLogout);

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn && !btn.hidden) switchTab(btn.dataset.tab);
  });

  document.getElementById("permitSearch").addEventListener("input", renderPermitList);
  document.getElementById("newPermitBtn").addEventListener("click", newPermit);
  document.getElementById("permitList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-file]");
    if (li) selectPermit(li.dataset.file);
  });
  const permitEditor = document.getElementById("permitEditor");
  permitEditor.addEventListener("input", onPermitEditorInput);
  permitEditor.addEventListener("change", onPermitEditorChange);
  permitEditor.addEventListener("click", onPermitEditorClick);
  permitEditor.addEventListener("submit", onPermitFormSubmit);

  document.getElementById("librarySearch").addEventListener("input", renderLibraryList);
  document.getElementById("newLibraryBtn").addEventListener("click", newLibraryItem);
  document.getElementById("libraryList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) selectLibraryItem(li.dataset.id);
  });
  const libraryEditor = document.getElementById("libraryEditor");
  libraryEditor.addEventListener("input", onLibraryEditorInputOrChange);
  libraryEditor.addEventListener("change", onLibraryEditorInputOrChange);
  libraryEditor.addEventListener("click", onLibraryEditorClick);
  libraryEditor.addEventListener("submit", onLibraryFormSubmit);

  document.getElementById("usersTableBody").addEventListener("change", onUsersTableChange);
  document.getElementById("usersTableBody").addEventListener("click", onUsersTableClick);
  document.getElementById("newUserForm").addEventListener("submit", onNewUserSubmit);
}

init();
