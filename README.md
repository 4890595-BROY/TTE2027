# TTE 2027 Exhibition Map — MVP scaffold

This repository starts the TTE 2027 app using Cloudflare Workers static assets, D1 (relational records), and R2 (images and backup objects). The current UI is a responsive, bilingual visitor-facing preview. The API includes initial authentication, event/booth/exhibitor records, approval endpoints, user management, audit logging, and a full JSON export to R2.

## Current implementation status

- [x] Responsive Thai/English visitor UI, search, booth selection, zoom controls, shareable booth hash, sample preview data.
- [x] D1 schema for events, booths, exhibitors, assignments, accounts, submissions, images, audit log, settings, backup records.
- [x] Worker API foundation, Google OAuth flow, allowlisted account check, session cookie, public booth/search endpoints, admin/exhibitor API endpoints.
- [x] R2 backup export endpoint and retention setting (policy value only).
- [ ] Complete the Admin dashboard UI for all APIs.
- [ ] Finish image upload/delete/reordering endpoints and connect to the UI.
- [ ] Implement backup restore with preflight/validation and entity-level restore.
- [ ] Complete CSV/XLSX import preview/conflict resolution.
- [ ] Add automated tests, security review, and a live deployment smoke test.
- [ ] Choose production domain and final backup policy.

The preview uses clearly labeled sample booth data only. It is not the official TTE 2027 booth layout or exhibitor directory.

## Prerequisites

- Node.js 20+ and npm
- Cloudflare account
- Google OAuth web client credentials

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local D1 database:

   ```bash
   npx wrangler d1 create tte2027-db
   ```

   Copy the returned database ID into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`.

3. Create the R2 bucket:

   ```bash
   npx wrangler r2 bucket create tte2027-files
   ```

4. Apply migrations locally:

   ```bash
   npm run db:local
   ```

5. Copy `.dev.vars.example` to `.dev.vars` and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `INITIAL_ADMIN_EMAIL`, and `APP_ORIGIN=http://localhost:8787`. Do not commit `.dev.vars`.

6. In Google Cloud Console, configure an OAuth web client with redirect URI `http://localhost:8787/api/auth/callback` for local work. For production, add the exact production callback URI too.

7. Start locally:

   ```bash
   npm run dev
   ```

## Cloudflare production setup

1. Create D1 and R2 resources in the intended Cloudflare account.
2. Replace the placeholder database ID in `wrangler.jsonc`.
3. Set production secrets using `npx wrangler secret put GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, and `INITIAL_ADMIN_EMAIL`.
4. Set `APP_ORIGIN` to the final production origin as a secret or deployment variable. Do not turn on exhibitor access until Admin has reviewed the initial data and the map.
5. Apply remote migrations: `npm run db:remote`.
6. Deploy with `npm run deploy` only after the remaining implementation checklist and smoke tests are complete.

## API overview

- `GET /api/health`
- `GET /api/auth/google`, `GET /api/auth/callback`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/public/event`, `GET /api/public/booths`, `GET /api/public/exhibitors?q=...`
- Admin: `GET /api/admin/overview`, `/users`, `/events`, `/booths`, `/exhibitors`, `/submissions`, `/audit`, `/backups`; create/update routes are documented in `docs/implementation-notes.md`.
- Exhibitor: `GET /api/exhibitor/me`, `POST /api/exhibitor/submit`
- `POST /api/admin/backup/export` stores a JSON export in R2. This is export-only; restore must not be considered production-ready yet.

## Domain and backup assessment

See `docs/backup-and-domain-assessment.md` for the current comparison. The domain is not selected yet. Cloudflare documents `workers.dev` as intended for personal/hobby projects rather than business-critical production; compare an existing domain/subdomain before deciding to use it for the live event. The current R2 JSON export is not a complete recovery plan.

## Important release gates

- The actual event map and exhibitor list must be entered and reviewed by Admin; sample records are not official data.
- Google OAuth and authorized user emails must be configured before login works.
- Public visitor publication and exhibitor editing access are independent settings. Keep `exhibitor_portal_enabled=false` until the owner approves access.
- The backup export endpoint is not a complete recovery system yet. Before production, implement and test safe full/entity restore, retention cleanup, and an off-account backup or documented recovery objective.
- The Cloudflare account connection used for development is not itself authorization to use any email as the app's initial owner. Set `INITIAL_ADMIN_EMAIL` deliberately.
