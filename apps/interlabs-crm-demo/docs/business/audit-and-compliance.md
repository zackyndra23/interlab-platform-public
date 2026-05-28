---
audience: stakeholder
reading_time: 5 min
last_reviewed: 2026-04-27
---

# Audit and Compliance

This document explains what the system records about user activity, how
access is protected, what happens when records are deleted, how user
sessions stay secure, and what categories of data the system intentionally
does not log. It is the reference companion to
[system-overview.md](./system-overview.md) and the SLA rules described in
[sla-policies.md](./sla-policies.md).

## What we log

Every state change in the system records who did it, when they did it,
what changed, and the reason or note attached to the change when one is
required. Workflow stage transitions, record edits, user management
actions, permission edits, login attempts (both successful and failed),
exports, and other permission-sensitive actions are kept in a single
activity log that grows append-only — entries are added, never edited and
never quietly removed.

For a Purchase Order, the audit trail goes deeper than the activity log
alone. Each of the eleven lifecycle stages writes its own history entry
the moment the stage advances. That entry captures the actor, the role
that actor was acting in, the timestamp, the note attached to the
hand-off, the reason given if the stage was already overdue, and any
attachment that was uploaded alongside the transition. Because the entry
is written at the same time as the stage change itself, it is impossible
for a hand-off to happen without leaving a record.

The same principle applies to every other workflow that crosses divisions:
**[Sales](./system-overview.md#glossary-sales)** Purchase Requests,
**[Finance](./system-overview.md#glossary-finance)** Purchase Requisitions,
**[Admin & Log](./system-overview.md#glossary-admin--log)** delivery
documents, **[Technical](./system-overview.md#glossary-technical)**
inspection and installation records,
**[HRGA](./system-overview.md#glossary-hrga)** legal document edits, and
**[Tax & Insurance](./system-overview.md#glossary-tax--insurance)** record
updates all write to history tables tied to the record they belong to.

The activity log can be queried by
**[Superadmin](./system-overview.md#glossary-superadmin)** or the
**[CEO](./system-overview.md#glossary-ceo)**. Other roles see the
record-level history that lives on each record they have access to — for
example, a Sales user can see the full hand-off history of a PO they own,
but cannot query the company-wide activity log directly. This separation
keeps day-to-day work transparent without exposing unrelated activity
across the business.

The login record deserves a specific note. Successful logins, failed
logins, password changes, logouts, and account lockouts after repeated
failures are all written to the activity log with the originating address
and the device information the browser reported. This means a security
review can reconstruct exactly who signed in, from where, and when —
including any unsuccessful attempts that may indicate account misuse.

## How we protect access

Permission to do something in this system is checked in three places at
once.

The first place is the menu. Users only see the modules, sub-menus, and
buttons that their role is allowed to use. This is a user-experience
choice — it keeps the interface uncluttered and prevents users from
attempting actions they cannot complete. The menu is not, however, the
rule that protects data. It is a hint, not a gate.

The second place is the system server itself. Whenever a user submits a
request — to view a record, edit a field, advance a stage, upload a file,
or anything else — the server independently checks whether that user's
role and capabilities allow that exact action. This is the authoritative
gate. A user who manipulates what is shown on screen, types a hidden
URL, or sends a request through other means still has to pass this check,
and any request that fails is rejected with a clear permission error.

The third place is the database read itself. Every query the system runs
is constrained by the requesting user's role scope, so even if a query is
issued for a record the user is not entitled to, the database will simply
not return it. This protects against bugs at the upper layers: even if a
new screen accidentally tried to display data the user shouldn't see, the
underlying query would not surface it.

The same permission rule is applied at all three layers, so the layers
reinforce one another rather than each holding a different opinion. The
permission rules themselves live in the database, not inside application
code, which means an authorised administrator can adjust who can do what
without waiting for a software release.

A second protective rule sits on top of access control: a role manager
who is not Superadmin or CEO can only create or edit users in their own
role. A Sales manager can add or disable Sales users; they cannot reach
into Finance or HRGA accounts. This is enforced on the system server, not
just the screen, so it cannot be bypassed by clever requests.

## Soft-delete principle

When a user deletes a record, the system marks it as deleted but does not
remove the data. The record disappears from normal lists and searches, but
it remains in storage with a deletion timestamp and the identity of the
user who deleted it. Anything historically linked to that record — a PO
that referenced a customer, a notification that referenced an attachment,
a status entry that referenced a user — continues to point at a row that
still exists, so the audit trail stays intact and reports for prior
periods stay reproducible.

Permanently removing a record from the database is a separate, restricted
action available only to specific administrative roles, and using it is
itself written to the activity log. In ordinary day-to-day operation,
nobody performs hard deletes. The default behaviour for every user
deletion action throughout the system is the soft-delete behaviour
described above.

This means an auditor reviewing the system at any later date can
reconstruct what existed at any earlier point in time. A customer record
deleted last quarter is still attached to the POs that were active when
it existed; a user disabled six months ago is still credited as the actor
on every hand-off they performed before being disabled. The business view
in front of today's users hides the deleted item; the historical record
behind the view does not.

The same rule applies to user accounts. Disabling a user prevents them
from signing in and removes them from drop-down selectors for new work,
but their past contributions — every PO stage they advanced, every
record they created, every note they wrote — remain visible on those
records under their original name and role.

## Session security

Each user signs into the system with their email address and password.
The login screen is protected against automated guessing: after a small
number of failed attempts from the same address or against the same
account, further attempts are throttled, and a visual challenge confirms
the request is coming from a human.

After a successful sign-in, the system issues two short pieces of proof
of identity. The first is a short-lived session badge that expires after
one hour. Every request the user's browser makes carries this badge, and
the system checks it on every request to confirm the user is still who
they say they are. The second is a longer-lived renewal badge that lives
for one week, or one month if the user ticked "remember me" during sign-in.
The renewal badge is used silently in the background to refresh the
short-lived badge as long as the user remains active, so an active user
is not interrupted to sign in again every hour.

When a user signs out, both badges are revoked. When an administrator
disables a user, the next refresh fails and the user is locked out at
that moment — they cannot continue working on the basis of an old badge
they happened to be holding. If a user simply closes the browser and does
not return, the badges expire on their own; nothing has to be done to
clean up.

Because the badges expire automatically and are revoked the moment an
account is disabled, a lost or shared device cannot be used to access
the system indefinitely. A separate operational protection — failed
sign-in throttling — keeps a stolen email from being used to brute-force
its way past the password.

## What we do NOT log

Some categories of data are deliberately kept out of the audit log, out
of the database, or out of the system entirely.

Passwords are never stored in plain form. Each password is converted by a
one-way function the moment it is set, and only the converted form is
kept. The system can confirm that a password the user types matches a
stored account, but neither the database administrator nor the
**[Superadmin](./system-overview.md#glossary-superadmin)** can read a
user's actual password back. A user who forgets their password must
reset it; nobody can recover it for them.

The contents of uploaded files are not indexed and are not searchable.
The system records the filename, the size, the uploader, the upload time,
the record the file is attached to, and the access events on the file —
but it does not read inside the file or extract its text. An attachment
named "scan.pdf" is treated as an opaque object; what it says inside is
not material the system makes searchable on its own. This is a deliberate
privacy choice: it limits the reach of the audit log to facts about the
file's existence and movement, not its content.

Raw payment card data is not handled by this system at all. Any payment
flow that involves a card runs through a dedicated external payment
provider, and only the result of that flow — confirmation, reference
number, amount — is recorded inside the CRM. The system never sees, never
stores, and never logs card numbers, expiry dates, or security codes.

Personal data fields are kept only on the records where they are
actually needed for the business workflow. A customer billing address
lives on the customer record because it is needed to issue invoices; it
is not duplicated onto every PO that customer placed. A point-of-contact
name lives on the customer or vendor record where the contact is the
business relationship; it is not copied to unrelated records. This
narrows the surface area where personal data appears, which makes it
easier to honour data-handling expectations and to redact information
cleanly if a customer or counterparty later requests it.

Finally, internal application diagnostics — the technical traces the
system writes for its own operators to investigate errors — are kept
separately from the user-facing activity log and are not made visible to
business users. They exist for system reliability, not for business
review, and they are aged out automatically rather than retained for
long-term audit.

<!-- drift-anchors:
  interlabs-crm-demo/docs/CTX_master_context.txt
  interlabs-crm-demo/docs/CTX_architecture.txt
  backend/migrations/015_activity_logs.sql
-->
