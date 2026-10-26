# Implementation notes

## Data model

- `events` isolates each event year.
- `booths` are stable records; displayed booth number is a unique per-event field, so reassignment can be explicit.
- `exhibitors` contain the approved public-facing content.
- `submissions` preserve the payload submitted for review; `audit_log` records administrative actions.
- `users` and `exhibitor_accounts` enforce Google-account allowlisting and booth/exhibitor assignment.
- `images` reference R2 object keys. File upload endpoints are not implemented yet.
- `backup_records` tracks R2 JSON exports; restore and retention enforcement remain release gates.

## Auth and access

Google OAuth uses authorization code flow, a random state cookie, verified Google email, a server-side allowlist in D1, and a signed 12-hour HMAC session cookie. The first user matching `INITIAL_ADMIN_EMAIL` is provisioned as `owner`; other accounts must already exist in `users`. Keep the secret out of source control. Before production, add automated tests for cookie parsing, OAuth state mismatch, inactive users, role enforcement, CSRF for all mutation routes, and session rotation/revocation.

## Known implementation gaps

1. The app shell currently exposes a sign-in entry point, but there is no complete admin dashboard UI yet.
2. The API uses a starter-level signed cookie, not a full server-side session store. Logout clears the browser cookie but does not revoke a copied token before expiry.
3. Mutating endpoints need explicit CSRF/origin protection before production.
4. D1 migrations currently seed the event and settings but no official booths.
5. Booth positioning is represented as percentages in the schema; final plan editor needs to use normalized canvas coordinates and be tested on mobile/desktop.
6. CSV import, XLSX parsing, import preview/conflict resolution, image management, entity restore, full restore, retention cleanup, and email delivery are not implemented.
7. Admin UI must include an explicit owner action to enable Visitor map publication and a separate action to enable Exhibitor portal access.

## Cost and recovery decision notes (checked 2026-10-25)

- Cloudflare Workers Free currently includes limited daily requests; Workers Paid is listed at a minimum of US$5/month with larger included usage. Static asset requests are free, but API/Worker requests and D1 usage have their own limits and billing rules.
- D1 Free currently lists 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage; excess daily read/write limits on Free can fail. The expected 1,000–10,000 visitors do not alone establish usage: page views, search frequency, number of booths, and event duration matter.
- R2 Standard currently lists 10 GB-month free, 1 million Class A operations/month, 10 million Class B operations/month, and no internet egress charge; usage above included limits is billable.
- Recommendation for evaluation: start by estimating Worker API calls and expected media volume; use D1 for records, R2 for images and export files. Before go-live, compare the account's current pricing and enable a verified recovery workflow. Do not treat a JSON export alone as a complete restore plan.

Official references:
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
