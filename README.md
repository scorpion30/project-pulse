# Project Pulse

Tasks, updates and deliveries for a project team, without the admin.

- **Site** (`site/`): static page served by GitHub Pages.
- **Backend** (`backend/`): Google Apps Script bound to the "Project Pulse Database" Google Sheet.
  Every call is a POST of text/plain JSON `{action, token, ...}` to the web app URL in `site/config.js`.

## Updating the backend
1. Paste `backend/Code.gs` into the Apps Script editor and save.
2. Deploy > Manage deployments > edit (pencil) > Version: **New version** > Deploy.
   This keeps the same `/exec` URL, so the site needs no change.

## Accounts
People create an account with email + password. The first person creates a team and is its manager;
others join with a one-time invite code (Team & roles > Make an invite code). Each team only sees its own projects.
