# Permit Application Checklists

A static, data-driven web tool for viewing permit requirements, application documents, plan requirements, inspections, and printable checklists.

The app is designed so most content changes happen in `data/checklists.json`. The interface in `index.html` reads that JSON file and builds the permit list, filters, detail view, and print layout.

## Project Files

- `index.html` - Main interface, rendering logic, responsive behavior, and print styles.
- `data/checklists.json` - Permit checklist data and reusable library items.
- `assets/css/tailwind.css` - Local Tailwind CSS utility file used by the page.
- `login.php`, `admin.php`, `admin.js`, `admin.css`, `api/` - Admin panel (login, Library Manager, Checklist Editor, User Management). See [Admin Panel](#admin-panel) below.

## Main Interface

The first screen is the working checklist interface, not a landing page.

- Search filters permit types by permit name.
- Property Type filters by `propertyType` values such as `Residential`, `Commercial`, and `Multi-Family`.
- Category buttons are generated from each permit's `category` value. Current categories include `Building`, `Electrical`, `Mechanical`, and `Plumbing`.
- Selecting a permit updates the URL with `?permit=<file>`, renders the checklist, and shows the Print Checklist button.
- Direct links also support hash navigation with `#<file>`.
- On desktop, selecting a new permit scrolls the page back to the absolute top so the header and Print Checklist button are visible.

## Desktop View

Desktop layout uses a two-column interface:

- Left panel: search, property type filter, category filters, and permit list.
- Right panel: selected permit checklist, update date, permit-required callout, hint callout, sections, checklist items, and print button.
- The left permit list is scrollable and keeps the selected permit in view.
- The selected permit content resets to the top when switching permit types.

## Mobile View

Mobile layout prioritizes the selected permit list and keeps filters compact:

- Search stays visible near the top.
- Property type and category filters are tucked behind the More Options button.
- Selecting a permit scrolls down to the checklist content.
- More Options automatically closes after changing filters.
- Text and checklist items are wrapped for smaller screens.

## Checklist Printing

The Print Checklist button appears only after a permit type is selected.

Printing uses the browser's native print dialog and print-specific CSS:

- Navigation, filters, search, and other screen-only controls are hidden.
- A print header with City of Pompano Beach branding is shown.
- Checklist cards are simplified for paper.
- Checkboxes remain visible for printed use.
- Links are printed as plain black text.
- Sections are styled to reduce awkward page breaks where possible.

## Data Loading

`index.html` chooses the JSON path based on the hostname:

- Local development on `localhost` or `127.0.0.1`: `data/checklists.json`
- Production: `../../../../assets/json/checklists.json`

If the production deployment stores the JSON somewhere else, update `DATA_FILE` in `index.html`.

## JSON Overview

The JSON file has two top-level objects:

```json
{
  "library": {},
  "permits": []
}
```

- `library` stores reusable checklist items, usually application forms.
- `permits` stores each permit type shown in the interface.

The app inserts some values as HTML, so trusted content may use small markup such as `<br><br>` in descriptions. Do not paste untrusted HTML into the JSON.

## Library Items

Library items are reusable objects referenced by permit checklist items using an `id`.

```json
"library": {
  "app_building": {
    "name": "Building Permit Application",
    "description": "Required for most construction-related permits.",
    "links": [
      {
        "label": "Building Permit Application",
        "url": "https://example.com/building-permit.pdf"
      }
    ]
  }
}
```

Available library item fields:

- `name` - Display name for the reusable item.
- `description` - Optional supporting text.
- `links` - Optional array of link objects.
- `variant` - Optional display style. Use `notice` for a yellow notice-style requirement box.

## Link Objects

Links can be used in library items and requirement items.

```json
{
  "label": "Application Form",
  "url": "https://example.com/application.pdf"
}
```

Available link fields:

- `label` - Text shown to the user.
- `url` - Link target. External links open in a new tab.

## Permit Fields

Each object in `permits` represents one selectable permit type.

Available permit fields:

- `file` - Required. Stable unique ID used for URLs, selection state, and direct links. Use lowercase words separated by underscores, such as `water_heater_changeout`.
- `published` - Optional. Set to `false` to keep a checklist hidden from the public page entirely — not in the list, search, filters, or reachable via a direct link — while staff finish it in the admin panel. Defaults to `true`. See [Admin Panel](#admin-panel).
- `lastUpdated` - Optional. Date string in `YYYY-MM-DD` format. Rendered as `MM/DD/YYYY`.
- `name` - Required. Permit name shown in the permit list and detail heading.
- `category` - Required. A string or array of strings used to generate category filters.
- `propertyType` - Optional. Array used by the Property Type filter, such as `["Residential", "Commercial"]`. If omitted, the permit appears for all property type filters.
- `whenPermitRequired` - Optional. Text for the blue "When do I need a Permit?" callout.
- `hintTitle` - Optional. Title for a standalone green hint callout. If provided without `hint`, a title-only hint box is shown.
- `hint` - Optional. Body text for the standalone green hint callout. If provided without `hintTitle`, the title defaults to `Hint`.
- `noticeOfCommencement` - Optional. Text for a yellow Notice of Commencement callout near the bottom of the checklist.
- `noticeOfCommencementRequired` - Optional. Set to `false` to completely hide the Notice of Commencement box for a permit. Defaults to `true`.
- `noticeOfCommencementRequirementId` - Optional. Library item ID for the automatic Notice of Commencement box. Defaults to `req_notice_of_commencement`; use `req_notice_of_commencement_hvac_15000` for repair or replacement of an existing heating or air-conditioning system.
- `sections` - Required. Array of checklist sections.

## Notice of Commencement Options

By default, every selected permit shows the standard Notice of Commencement box after the permit sections. Most permits do not need any extra field:

```json
{
  "file": "sample_permit",
  "name": "Sample Permit"
}
```

Use the HVAC `$15,000` version for repair or replacement of an existing heating or air-conditioning system:

```json
{
  "file": "ac_changeout",
  "noticeOfCommencementRequirementId": "req_notice_of_commencement_hvac_15000"
}
```

If a permit should not show any Notice of Commencement box, disable it explicitly:

```json
{
  "file": "sample_permit_without_noc",
  "noticeOfCommencementRequired": false
}
```

No current permits use the disabled option.

## Permit Structure

A typical permit should look like this:

```json
{
  "file": "sample_permit",
  "lastUpdated": "2026-04-25",
  "name": "Sample Permit",
  "category": "Building",
  "propertyType": [
    "Residential",
    "Commercial"
  ],
  "whenPermitRequired": "A permit is required when the proposed work includes structural changes.",
  "hintTitle": "Before You Apply",
  "hint": "Separate trade permits may be required depending on the scope of work.",
  "noticeOfCommencement": "A Notice of Commencement may be required before inspections.",
  "sections": [
    {
      "name": "Applications",
      "items": [
        {
          "id": "app_building"
        }
      ]
    },
    {
      "name": "Requirements",
      "items": [
        {
          "type": "requirement",
          "label": "Survey or Site Plan",
          "description": "Provide a survey or site plan showing the proposed work area."
        }
      ]
    },
    {
      "name": "Inspections",
      "items": [
        {
          "type": "inspection_group",
          "label": "Building Inspections",
          "inspections": [
            "BLDG FINAL STRUCTURAL"
          ]
        }
      ]
    }
  ]
}
```

## Section Fields

Each permit has a `sections` array. Each section renders as a grouped card.

Available section fields:

- `name` - Required. Section heading shown in the checklist.
- `items` - Required. Array of checklist items.

Common section names include:

- `Applications`
- `Requirements`
- `Plans`
- `Inspections`

The app does not require those exact names, but using consistent section names keeps checklists easier to scan.

## Checklist Item Types

There are three supported item patterns.

### Library Reference Item

Use this when the item already exists in `library`.

```json
{
  "id": "app_building"
}
```

Available fields:

- `id` - Required. Key from the `library` object.
- `label` - Optional. Overrides the library item's name for this permit only.
- `value` - Optional. Same as `label` if you prefer that field name.
- `description` - Optional. Overrides the library item's description for this permit only.
- `links` - Optional. Overrides the library item's links for this permit only.
- `variant` - Optional. Overrides the library item's display style for this permit only.

If the `id` is not found in `library`, the app displays the raw `id` as the item name.

### Requirement Item

Use this for permit-specific requirements, plans, forms, or notes.

```json
{
  "type": "requirement",
  "label": "Product Approval Documents",
  "description": "Provide a current Florida Product Approval or Miami-Dade NOA.",
  "links": [
    {
      "label": "Florida Product Approvals",
      "url": "https://www.floridabuilding.org/pr/pr_app_srch.aspx"
    }
  ]
}
```

Available fields:

- `type` - Required. Must be `requirement`.
- `label` - Preferred display name.
- `value` - Optional fallback display name if `label` is not used.
- `description` - Optional supporting text.
- `links` - Optional array of link objects.

### Inspection Group Item

Use this for grouped inspection lists.

```json
{
  "type": "inspection_group",
  "label": "Building Inspections",
  "inspections": [
    "BLDG FOOTINGS",
    "BLDG FINAL STRUCTURAL"
  ]
}
```

Available fields:

- `type` - Required. Must be `inspection_group`.
- `label` - Required. Heading for the inspection group.
- `inspections` - Required. Array of inspection names.

## Adding A New Permit

1. Add reusable forms or repeated items to `library` if they will be used by multiple permits.
2. Add a new object to the `permits` array.
3. Give it a unique `file` value. This becomes the direct-link key.
4. Add `name`, `category`, optional `propertyType`, and any callout fields.
5. Add sections with items.
6. Validate that `data/checklists.json` is still valid JSON.
7. Open the page locally and confirm the permit appears in search, filters, details, and print preview.

## Editing Existing Permits

- Keep `file` stable when possible so existing direct links keep working.
- Use `lastUpdated` when content changes are meaningful to users.
- Prefer library items for repeated applications and forms.
- Use permit-specific `description` overrides when the same library item needs different wording in one checklist.
- Avoid duplicate permit entries for nearly identical scopes; combine them with `whenPermitRequired`, `hintTitle`, `hint`, and conditional descriptions where possible.

## Filtering Rules

- Search matches only the permit `name`.
- Category filters come from `category`. A permit may use a single string or an array of strings.
- Property Type filter checks `propertyType`. If `propertyType` is missing, the permit is included for all property types.
- The permit list displays category and property type metadata under each permit name.

## Direct Links

Use the `file` value to link directly to a permit:

```text
index.html?permit=water_heater_changeout
index.html#water_heater_changeout
```

Query string links are preferred because the app updates the URL in that format when a user selects a permit.

## Local Development

This is a static site with no build step. Because the page fetches JSON, it should be served from a local web server instead of opened directly from the filesystem.

## Deployment Notes

- Deploy `index.html`, `assets/css/tailwind.css`, and the JSON file together.
- Confirm `DATA_FILE` in `index.html` points to the deployed JSON path.
- No package install or build is required for the app itself.
- Keep JSON valid: no trailing commas, comments, or unquoted keys.
- If deploying the admin panel too, see [Admin Panel](#admin-panel) — it needs a PHP-capable host.

## Admin Panel

`admin.php` is a login-gated interface for editing `data/checklists.json` without hand-editing JSON. It's a separate app from the public checklist page — `index.html` still just fetches the JSON file directly and has no login of its own.

The architecture deliberately mirrors the sibling [pompano-beach-project-map](https://github.com/ChrisFeltgen/pompano-beach-project-map) admin panel: a PHP session set by a server-rendered `login.php`, `admin.php` gated by `require_admin_auth()` as its first line (redirects to `login.php` if there's no session — the page never renders unauthenticated), a JSON account file (`api/auth-config.json`, gitignored) instead of a database, and API endpoints under `api/` that return `{error: "..."}` on failure and rely on the session cookie's `SameSite=Lax` rather than a separate CSRF token. There's no build step; deploy the whole repo to a PHP 8+ host (tested against the `scrapcraft.dev` host during development).

Two intentional differences from that sibling project, both because `checklists.json` feeds the live public checklist page directly (the sibling's `projects.json` doesn't carry the same weight):

- **Three roles instead of two** — see below.
- **Backups + conflict detection on save** — the sibling's `projects.php` does a plain locked write with neither. `api/lib/checklistsStore.php` takes a timestamped backup before every save (`data/backups/`, most recent 30 kept) and validates the file's shape first, so a bad edit or two overlapping saves can't take down the public page.

### Roles

Roles are a hierarchy — each one includes everything the role below it can do:

- **Limited editor** - Edit fields, sections, and items on *existing* checklists only. Cannot create/delete checklists, cannot touch the Library, cannot manage users.
- **Full editor** - Everything a limited editor can do, plus create/delete checklists and manage Library items (the reusable application forms/snippets checklists reference by `id`).
- **Full admin** - Everything a full editor can do, plus add/remove user accounts and reset passwords.

Every role/permission check is enforced server-side in `api/*.php` (`require_admin_role()` in `api/auth.php`), not just hidden in the UI. Sessions are also re-checked against `api/auth-config.json` on every request, not just at login — if a `full_admin` removes or demotes an account from the Users tab, that change takes effect on that user's very next request instead of waiting for them to log out.

Login is rate-limited: 5 failed attempts against one account lock it out for 15 minutes.

### First-time setup

No admin credentials are stored in this repository (it's a public repo). After deploying:

1. Copy `api/auth-config.example.json` to `api/auth-config.json` (same folder — that file is gitignored).
2. Generate a password hash — on the server, or on any machine with PHP, then upload the file:
   ```
   php -r "echo password_hash('your-password-here', PASSWORD_DEFAULT), PHP_EOL;"
   ```
3. Paste that hash into `api/auth-config.json`, set `role` to `full_admin`.
4. Visit `admin.php` and log in. Once at least one `full_admin` account exists, add the rest of the staff from the Users tab instead of editing the file again.

To start over, delete `api/auth-config.json` on the server and repeat from step 1.

### Two data files: checklists.source.json and checklists.json

The admin panel edits `data/checklists.source.json` — the full data, including draft checklists. `data/checklists.json` (same name and location the public page has always fetched) is regenerated automatically after every save, with draft (`published: false`) checklists stripped out entirely. This split exists because `index.html` — and, in production, whatever fetches its deployed copy — reads `checklists.json` directly as a static file with no server or auth involved at all, so a client-side "hide drafts" filter alone can't stop someone from requesting the raw file and reading a draft's full content. Filtering has to happen at write time, server-side, which is what `write_public_checklists()` in `api/lib/checklistsStore.php` does.

`checklists.source.json` is gitignored, same reasoning as `api/auth-config.json` — draft content shouldn't sit in this public repo either. **Existing deployments migrate automatically**: the first time the admin panel loads or saves after this update, if `checklists.source.json` doesn't exist yet but `checklists.json` does, it's seeded from that file (identical content, since there were no drafts before this feature existed) — no manual step required.

### How saving works

- Every save takes a timestamped backup of `checklists.source.json` first and validates the file's shape server-side, so a bad edit can't take down the public page.
- If two people save (or delete) around the same time, the second one is rejected with a conflict message instead of silently overwriting the first person's edit — reload and reapply in that case.
- `lastUpdated` on a checklist is set automatically by the server whenever it's saved through the admin panel.

### Draft checklists and previewing

Every checklist has a `published` field (see [Permit Fields](#permit-fields)). New checklists created in the admin panel start as drafts — unpublished — so staff can build them out before the public ever sees them; the Checklists tab shows a **Draft** badge next to any unpublished checklist in the list, and a Published/Draft toggle at the top of its editor.

Draft checklists never reach `data/checklists.json` (see above) — not in the list, search, category filters, or reachable via a direct `?permit=` link — until switched to Published and saved. The admin API (`api/permits.php`, `api/library.php`) requires login for every request, including reads, since it operates on the full `checklists.source.json`.

To see how a checklist (draft or not, saved or not) will actually look, click **Preview** in its editor. It opens the real public page in a new tab rendering exactly what's currently in the form, including unsaved edits — no need to save first just to check formatting.

### Deploying to a different JSON location

`api/lib/checklistsStore.php` has two path functions: `checklists_path()` (the admin-only source, drafts included) and `public_checklists_path()` (what the public page fetches, drafts stripped). Both default to `data/checklists.source.json` and `data/checklists.json` relative to the repo root, which matches local dev and the `scrapcraft.dev` test host. The real production site serves the public JSON from a different path (see "Data Loading" above — `../../../../assets/json/checklists.json` relative to `index.html`). If you deploy the admin panel there, update `public_checklists_path()` to that real on-disk path — and make sure it's not reachable by any URL other than the one `index.html` already fetches — or drafts published from the admin panel won't reach the live public page. `checklists_path()` (the source) just needs to live somewhere the PHP process can read and write; it doesn't need to be, and must not be, web-accessible (see `data/.htaccess`).

### Local development without PHP

`admin-server.js` is a Node.js twin of the PHP admin backend, for clicking through the whole panel with `node admin-server.js` when you don't have PHP installed locally — same idea as the sibling project's own `admin-server.js`. Auth there is HTTP Basic instead of the real session/login.php flow, and it's opt-in:

- With nothing configured, `/admin` is open and you're treated as a `full_admin` — convenient for testing every tab, but *only* the local dev server behaves this way; the real PHP host always requires a login.
- Set `ADMIN_USERS` to test specific roles: `ADMIN_USERS='[{"username":"lim","password":"...","role":"limited_editor"}]' node admin-server.js` (or the legacy single-account `ADMIN_USER`/`ADMIN_PASS` pair, which gets `full_admin`).
- The Users tab isn't implemented locally (it writes to the gitignored `api/auth-config.json` on the real host, same limitation the sibling project's dev server has) — opening it shows an inline notice instead of an error.
- It reads and writes the same `data/checklists.source.json` / `data/checklists.json` split described above, including the auto-migration and the draft-stripping on every save, so testing draft visibility locally matches what the real host does.
- It also serves `index.html` and the rest of the static site, so `node admin-server.js` alone is enough to browse and test the whole app at `http://127.0.0.1:5174`.
