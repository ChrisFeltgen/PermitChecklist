# Permit Application Checklists

A static, data-driven web tool for viewing permit requirements, application documents, plan requirements, inspections, and printable checklists.

The app is designed so most content changes happen in `data/checklists.json`. The interface in `index.html` reads that JSON file and builds the permit list, filters, detail view, and print layout.

## Project Files

- `index.html` - Main interface, rendering logic, responsive behavior, and print styles.
- `data/checklists.json` - Permit checklist data and reusable library items.
- `assets/css/tailwind.css` - Local Tailwind CSS utility file used by the page.

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
- `lastUpdated` - Optional. Date string in `YYYY-MM-DD` format. Rendered as `MM/DD/YYYY`.
- `name` - Required. Permit name shown in the permit list and detail heading.
- `category` - Required. A string or array of strings used to generate category filters.
- `propertyType` - Optional. Array used by the Property Type filter, such as `["Residential", "Commercial"]`. If omitted, the permit appears for all property type filters.
- `whenPermitRequired` - Optional. Text for the blue "When do I need a Permit?" callout.
- `hintTitle` - Optional. Title for a standalone green hint callout. If provided without `hint`, a title-only hint box is shown.
- `hint` - Optional. Body text for the standalone green hint callout. If provided without `hintTitle`, the title defaults to `Hint`.
- `noticeOfCommencement` - Optional. Text for a yellow Notice of Commencement callout near the bottom of the checklist.
- `sections` - Required. Array of checklist sections.

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
