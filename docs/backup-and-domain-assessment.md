# Domain and backup assessment — 2026-10-25

## Domain recommendation

**Decision remains open.** For a short-lived preview, a `workers.dev` address is available after enabling the account subdomain. Cloudflare's current documentation says `workers.dev` is intended for personal/hobby projects and recommends a Workers route or custom domain for production Workers. Because TTE is a public event directory, use `workers.dev` only for a preview/smoke test unless the organizer explicitly accepts that limitation.

Preferred low-cost options to compare:

1. **Existing domain, new subdomain** (for example `tte2027.<existing-domain>`): typically avoids buying a new domain if the organizer already controls a domain active in Cloudflare. Needs domain owner approval and DNS access.
2. **New domain**: costs depend on registrar, TLD, renewal and any privacy/registry fees; compare the total first-year and renewal prices rather than just the introductory price.
3. **workers.dev**: no separate domain purchase, but Cloudflare classifies it as suitable for personal/hobby projects rather than business-critical production.

Official references:
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Cost envelope to validate

Current published Cloudflare pricing checked on 2026-10-25:

- Workers Free is available by default but has daily usage limits. Workers Paid has a minimum charge of US$5/month and includes higher usage allowances.
- D1 Free lists 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. From September 1, 2026, exceeding the Free daily row limits can cause queries to fail rather than merely generate an overage bill. Paid D1 includes 25 billion rows read/month and 50 million rows written/month before usage-based charges, plus 5 GB stored data included in the Workers Paid baseline; check current plan details before purchase.
- R2 Standard lists 10 GB-month storage, 1 million Class A operations/month, and 10 million Class B operations/month in the free tier, with no internet egress charge. Above included amounts, storage and operations are billable.

This project cannot estimate final costs from the visitor count alone. Important variables are page views per visitor, map/search API requests, booth count, image count/size, backup frequency, and backup retention.

Official references:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/

## Backup recommendation

**Do not treat the current JSON export endpoint as a production recovery solution.** It is a first implementation step, not yet a restore workflow. It exports selected D1 tables to R2, but currently does not include R2 image objects and has no validated full restore, entity restore, automatic retention cleanup, or recovery test.

Before launch, compare these options:

- D1's managed backup/restore capabilities available to the account and plan.
- Scheduled D1 export to R2 plus export/backup of referenced R2 objects.
- An additional off-account copy if losing access to the Cloudflare account or R2 bucket is within the threat model.

Required release gates:

1. Define RPO (how much recent data loss is acceptable) and RTO (how quickly the system must recover).
2. Back up D1 and the associated R2 images/files consistently.
3. Verify file size, record counts, and checksums where practical.
4. Restore into a separate test database/bucket and verify records, booth assignments, images, and public visibility states.
5. Test restoring one entity without overwriting unrelated data.
6. Enforce retention automatically only after the restore workflow has been tested.

Official starting point for a D1-to-R2 export pattern:
- https://developers.cloudflare.com/workflows/examples/backup-d1/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
