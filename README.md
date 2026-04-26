# Permit Application Checklists

A simple web tool for viewing permit requirements, application documents, and inspection checklists.

---

## Overview

- Browse and search permit types  
- Filter by category and property type  
- View required documents, plans, and inspections  
- Print permit-specific checklists  

---

## Structure

- `index.html` – Main interface  
- `data/checklists.json` – All permit data and reusable library items  

---

## Data

The app is fully data-driven:

- **Library** → Reusable items (applications, requirements, notices like NOC)  
- **Permits** → Organized into sections (Applications, Requirements, Plans, Inspections)
- `whenPermitRequired` controls the "When do I need a Permit?" callout for a permit.
- `hint` is optional and adds a standalone Hint callout for extra information.

---

## Deployment

Static site — no build required.  
