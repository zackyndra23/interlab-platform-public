---
audience: stakeholder
reading_time: 5 min
last_reviewed: 2026-04-27
---

# Roles and Permissions

This document explains who can do what in the system, in plain business
terms. It is a companion to the
[business/system-overview.md](./system-overview.md), which introduces
the eight roles in narrative form. Here we focus on the rules that govern
their access. For how those rules are reviewed and proven, see
[business/audit-and-compliance.md](./audit-and-compliance.md).

## What "role" means here

A role describes what someone is responsible for in the company and which
parts of the system they are allowed to use. Every account in the platform
is attached to exactly one role, and that role decides which menus appear,
which records can be opened, which actions can be taken, and which events
generate notifications for that user. There are eight roles in total, and
they map directly to the way the business is organised: two oversight
roles at the top, and six operational divisions underneath. Roles are not
job titles. A person's job title may change without changing their role,
and several people may share the same role.

## The eight roles

**[Superadmin](./system-overview.md#glossary-superadmin)** is the
system-owner role. Superadmin has unrestricted access to every module,
every record, and every configuration screen. It is the only role that
can create or edit accounts in any other role, manage the permission
matrix, and toggle any notification template on or off. Superadmin
accounts are deliberately rare; in normal operation there are only one
or two of them.

**[CEO](./system-overview.md#glossary-ceo)** is the executive role. The
CEO sees the entire business at a glance: every Purchase Order, every
division's records, and every audit history. The CEO can manage role
groups and email templates, and automatically receives an escalation
notification whenever a service-level deadline is missed anywhere in the
business. The CEO does not normally enter operational data; the role is
for oversight and decision-making.

**[Sales](./system-overview.md#glossary-sales)** owns the customer-facing
side of the business. Sales users maintain the customer list, record
sales forecasts, issue quotations, calculate cost of goods sold, raise
Purchase Requests, and create the Purchase Order record that starts the
fulfilment lifecycle. Sales is the only division that can move a Purchase
Order through its first two stages, and is held to a 2-working-day
deadline at each of those stages. Sales managers, when granted the
privilege, can manage other Sales users.

**[Admin & Log](./system-overview.md#glossary-admin--log)** owns
shipping and logistics. Admin & Log users record the airway bill, the
customs transit and arrival dates, and the Delivery Order that sends
goods to the customer site. They also manage day-to-day operational petty
cash. When the Technical team signals that goods are Ready to Deliver,
Admin & Log has 2 working days to respond. Admin & Log managers, when
granted the privilege, can manage other Admin & Log users.

**[Finance](./system-overview.md#glossary-finance)** owns the money side
of every Purchase Order. Finance users open Purchase Requisitions for
vendors, upload the vendor PO and its date (which advances the customer
order to Production), record manufacture invoices and payments, and
finally issue the customer invoice that closes the lifecycle. Finance
managers, when granted the privilege, can manage other Finance users.

**[Technical](./system-overview.md#glossary-technical)** owns the
service-delivery work that begins once goods arrive. Technical users
perform incoming inspection and quality control, install equipment at the
customer site, run preventive maintenance, manage spareparts, and upload
the customer-signed handover document that signals the order is complete.
Technical also receives 30-day reminders before any Purchase Order due
date. Technical managers, when granted the privilege, can manage other
Technical users.

**[HRGA / Legal](./system-overview.md#glossary-hrga)** owns the company's
legalitas and human-resources records. HRGA users maintain company legal
documents (such as Akta, NIB, NPWP, BPJS, and Domisili), draft and store
company letters, and watch every document's expiry date. The system warns
HRGA 90 days and again 30 days before any monitored document expires.
HRGA also makes the relevant legal documents available, on a controlled
basis, to other divisions that need them. HRGA managers, when granted the
privilege, can manage other HRGA users.

**[Tax & Insurance](./system-overview.md#glossary-tax--insurance)** owns
Indonesian tax operational records. Tax & Insurance users record monthly
tax payments and reports across PPh 21, PPh 25, and PPN, and keep the
supporting evidence (SSP, billing code, NTPN, NTB, SPT) tied to the
correct tax period. Every record carries a complete audit trail, because
these documents may need to be produced during a tax audit. Tax &
Insurance managers, when granted the privilege, can manage other Tax &
Insurance users.

## What each role can see and do

The table below summarises, in business terms, which areas of the system
each role is allowed to use. A check mark means the role has full access
to that area in the normal course of work. "Partial" means access is
allowed but limited (for example, view-only access, or access restricted
to records the role itself owns, or access only when an explicit
privilege has been granted). A dash means the role is not expected to use
that area at all in day-to-day work. Superadmin and CEO are the only
roles with unrestricted reach across every area.

| Role             | Customers & Sales | Purchase Orders | Files & Documents | Reports & Dashboards | User & Permission Admin | Company Legalitas (HRGA) | Tax Filings |
|------------------|:-----------------:|:---------------:|:-----------------:|:--------------------:|:-----------------------:|:------------------------:|:-----------:|
| Superadmin       |         ✓         |        ✓        |         ✓         |          ✓           |            ✓            |            ✓             |      ✓      |
| CEO              |         ✓         |        ✓        |         ✓         |          ✓           |            ✓            |            ✓             |      ✓      |
| Sales            |         ✓         |     partial     |      partial      |       partial        |         partial         |            —             |      —      |
| Admin & Log      |      partial      |     partial     |      partial      |       partial        |         partial         |            —             |      —      |
| Finance          |      partial      |     partial     |      partial      |       partial        |         partial         |            —             |   partial   |
| Technical        |      partial      |     partial     |      partial      |       partial        |         partial         |            —             |      —      |
| HRGA / Legal     |         —         |        —        |      partial      |       partial        |         partial         |            ✓             |      —      |
| Tax & Insurance  |         —         |        —        |      partial      |       partial        |         partial         |            —             |      ✓      |

Reading this table:

- A divisional role's "partial" access to Purchase Orders means that the
  role can act on the PO stages it owns and read the others, but cannot
  perform stage transitions that belong to another division.
- "Partial" access to Files & Documents means the role can upload,
  preview, and download files attached to records it is allowed to see,
  using the secure short-lived links the system issues on demand.
- "Partial" access to User & Permission Admin means the role can manage
  only its own division's users, and only when the same-role management
  privilege has been explicitly granted (see the next section).
- "Partial" access to Reports & Dashboards means the role sees its own
  division's reports and the cross-division views it needs for
  hand-offs, not the global views reserved for Superadmin and CEO.
- Finance's "partial" Tax Filings access reflects the operational link
  between customer invoicing and tax records; full ownership of tax
  filings still sits with the Tax & Insurance role.

## Same-role management rule

When a divisional manager is given the privilege to manage other users,
that privilege is restricted to their own division. A Sales manager who
creates or edits user accounts can only create or edit Sales accounts; a
Finance manager can only manage Finance accounts; an HRGA manager can
only manage HRGA accounts; and so on across every divisional role. Only
Superadmin and the CEO can create or edit accounts in any role, and only
they can move a user from one role to another. This rule prevents one
division from quietly enlarging another division's headcount or changing
another division's permissions without executive approval.

## How permission is enforced

Permission is checked in three places every time a user takes an action.
It is checked in the menu, so that a user only sees options they are
allowed to use; it is checked on the system server, which is the
authoritative gate that approves or rejects each request; and it is
checked in every database query, so that even an approved request only
returns or changes the records that user's role is allowed to touch. The
menu is for convenience and clarity, but it is not the rule. The rule is
the server-side check, backed by the database-level scope. Permission
decisions and the actions that follow them are written to the audit
trail; how those records are reviewed is described in
[business/audit-and-compliance.md](./audit-and-compliance.md).

<!-- drift-anchors:
  interlabs-crm-demo/docs/CTX_master_context.txt
  backend/migrations/002_rbac.sql
  backend/scripts/seed.js
  docs/business/system-overview.md
-->
