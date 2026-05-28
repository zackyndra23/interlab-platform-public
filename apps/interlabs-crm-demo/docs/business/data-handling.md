---
audience: stakeholder
reading_time: 4 min
last_reviewed: 2026-04-27
---

# Data handling

How and where the system stores business data, how it keeps uploaded files
private, how long different types of records are kept, and what the current
state of backup and restore is. This page is written for business
stakeholders; it deliberately avoids product names and technical jargon. For
the operator-facing detail referenced at the end of this document, see the
runbooks under `../runbook/`.

## Where data lives

The system holds three kinds of information, in three places, on a single
server.

**Records** — every Purchase Order, customer, quotation, AWB, Delivery
Order, invoice, BAST, HRGA legal document, tax record, notification,
letter, and audit-trail entry — live in a structured database. This is the
working copy of the business: when a Sales user opens a customer, when
Finance closes out a PO with a customer invoice, or when CEO reviews the
status history of any record, the database is what the system reads from
and writes to.

**Uploaded files** — photos, scanned documents, PDFs, vendor PO Out
documents, BAST handover scans, HRGA legalitas certificates, AWB scans,
invoice copies, and user profile avatars — live in a separate, private
file store on the same server. The database keeps a record of every file
(its name, size, who uploaded it, and which record it belongs to), but the
actual bytes are kept in the file store, not in the database.

**Active sessions** — the short-lived "you are signed in" badge a user
carries while they work in the system — is kept in fast in-memory storage
so that users do not have to sign in again on every action. This is not
business data; it is the equivalent of the wristband at a managed event,
and it disappears on its own when the user signs out or the badge expires.

All three stores live on a single server in Indonesia: an Ubuntu server
hosted by a commercial provider in the Jakarta region. Under normal
operation, the data does not leave Indonesia.

## How files are kept private

Uploaded files are not on a public web server. There is no folder of
documents anyone can browse, and there is no link that always works.

Every download a user performs goes through the system, not directly
against the file store. When a user clicks a file, the system first checks
that the user is allowed to see that record, and only then does it
generate a single-use secure link aimed at the file store. That link
expires within fifteen minutes and is bound to the specific file the user
asked for. After the fifteen minutes, the link no longer works for anyone
— including the user who originally received it.

In practice this means three things:

- A user who is no longer permitted to see a record cannot reuse an old
  link from yesterday's email or chat to fetch its files today.
- Sharing a working link with someone outside the company gives them a
  short window — at most fifteen minutes — and only for that specific
  file.
- Internal staff cannot retrieve a file by guessing its name. The file
  store does not respond to unsigned requests at all; only the system,
  using credentials it never exposes to the browser, can issue a valid
  link.

Uploads are handled the same way in reverse: the file goes through the
system, which records the metadata in the database before storing the
bytes, so there is no orphan file in the store that the rest of the
system does not know about.

## Retention

The system is designed around the principle that business records are
evidence. Once written, a record is preserved — usually indefinitely —
even when it is "deleted" from a user's screen. The table below
summarises the retention behaviour for each category of data.

| Data type | Retention behaviour |
| --------- | ------------------- |
| Workflow records (Purchase Orders, AWBs, Delivery Orders, Quotations, Purchase Requests, Purchase Requisitions, Invoice Manufacture, Invoice Customer, BAST, Job Orders, Installation, PM, Sparepart, Inspection / QC) | Kept indefinitely. Deletion is a soft-delete: the record is hidden from list views and from new automations but remains in the database with a deleted-at timestamp, so the audit trail and history tables stay complete and reconstructible. |
| Customer records | Kept indefinitely. Same soft-delete behaviour as workflow records. PO and quotation history that references a deleted customer continues to resolve. |
| HRGA legal documents (Akta, NIB, NPWP, BPJS, KEMNAKER, Domisili, and similar) | Kept indefinitely. Superseded versions are archived rather than removed: a renewed NPWP, for example, is added as a new active document while the previous version stays in the HRGA archive with an archive flag, so the history of the company's legal status is preserved. |
| Activity log (audit trail) | Kept indefinitely. Every workflow state change, user-management action, and permission edit is recorded with actor, timestamp, note, and reason-if-delayed. The log is append-only from the application's perspective. |
| Sessions ("you are signed in" badges) | Discarded automatically when the badge expires: one hour for the short-lived working badge, seven days for the renewable badge, or thirty days if the user opted into "remember me" at sign-in. No business data is held in sessions. |
| Email queue (outbound notification emails) | Currently undrained. The system writes outbound emails to an internal queue when notifications fire, but the worker that was meant to dispatch those emails over SMTP has not yet been implemented. As a result, queue rows accumulate over time. The notification's in-app dashboard delivery is unaffected; only the email side is paused. This is documented honestly here so it is not surprising in operations. |
| Uploaded files (attachments and avatars) | Kept until manually removed from the file store. When a user "deletes" a file from the application, the system soft-deletes its database record (so the file no longer shows up under the parent record) but does not delete the bytes from the file store. The bytes remain until an operator removes them explicitly. This is intentional — it allows recovery from accidental deletes — but it means the file store grows monotonically under normal use. |

The combination of soft-delete on records and bytes-retained on files
means that nothing the business has ever recorded is silently lost.
Anything a user appears to "delete" is recoverable by an operator with
direct access to the database and file store, until and unless an
explicit purge is performed.

## Backup and restore

Backups are currently the operator's responsibility — the system does not
run automated backups itself. There is no built-in scheduled job that
exports the database, no built-in mirror of the file store to a second
location, and no built-in retention of point-in-time snapshots inside the
application.

The operator is expected to schedule database snapshots and file-store
replication using the hosting provider's tools (for example, the volume
snapshot feature of the underlying virtual server) or a third-party
backup utility, on whatever cadence the business considers acceptable for
its risk tolerance. The same operator is responsible for testing
restoration from those snapshots, ideally on a separate environment,
because untested backups are not real backups.

Restoring after data loss similarly happens at the operator level. The
database and the file store are restored from the operator's snapshots;
the system is brought back up against the restored stores; and the
running application picks up where the snapshots ended. There is no
in-application "restore" wizard.

This is honest reporting of the current state. Two improvements are
expected in future iterations: an automated nightly database export with
a fixed retention window, and a documented file-store replication target.
Until those are in place, the business should treat backup as an
operational practice, not a system feature, and confirm with the operator
that snapshots are running and have been tested recently.

For the operator-facing procedures behind these stores, see
[`../runbook/database.md`](../runbook/database.md) and
[`../runbook/storage.md`](../runbook/storage.md). Those runbooks describe
how to connect to each store directly, how to inspect what is in it, and
how to recover from common failures — which is the foundation any backup
or restore procedure builds on.

<!-- drift-anchors:
  interlabs-crm-demo/docs/CTX_architecture.txt
  backend/src/services/file.service.js
  backend/src/services/email.service.js
  backend/src/jobs/scheduler.js
  backend/migrations/012_file_attachments.sql
  backend/migrations/015_activity_logs.sql
  backend/migrations/016_app_settings_and_email_queue.sql
  docs/runbook/database.md
  docs/runbook/storage.md
  docs/business/system-overview.md
-->
