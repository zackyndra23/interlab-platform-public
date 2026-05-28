---
audience: stakeholder
reading_time: 8 min
last_reviewed: 2026-04-27
---

# System Overview

## What this system is

This platform is the internal CRM, ERP, and Realtime Operations Hub for PT.
Interlab Sentra Solutions Indonesia. It is a single, role-aware workspace
that ties together Sales pipeline management, logistics, finance, technical
service delivery, HR and legal compliance, and tax operations. Every
division's daily work is captured in one connected record so that a single
customer order can be followed from the first quotation through to the final
customer invoice without leaving the system.

The business locale is Indonesian. Indonesian Rupiah (IDR) is the primary
currency, with USD and EUR available in finance forms, Indonesian tax
codes and letter formats apply, and operating dates use the Asia/Jakarta
timezone. Internal deadlines and SLA tracking count working days only,
skipping weekends.

The system is not a generic CRUD tool. It enforces an 11-stage Purchase
Order lifecycle that crosses five divisions, runs scheduled SLA monitoring
with automatic escalation, delivers real-time chat and notifications, keeps
a full audit trail for every workflow change, and stores all attachments
privately in object storage that is reachable only through short-lived
secure links.

## Who uses it

- **Superadmin** — the system owner; has unrestricted access to every
  module, every record, and every configuration, and is the only role that
  can manage users in any other role.
- **CEO** — has full visibility equivalent to Superadmin and receives
  escalation notifications whenever an SLA is breached anywhere in the
  business.
- **Sales** — owns customer relationships, quotations, sales forecasts, and
  the first two stages of every Purchase Order (Registered and Processed).
- **Admin & Log** — owns shipping and logistics, including airway bills,
  customs handling, arrival confirmation, and final delivery to the
  customer site.
- **Finance** — owns money-side activities: production financing, vendor
  Purchase Requisitions, manufacture invoices, and the customer invoices
  that close out each Purchase Order.
- **Technical** — owns post-arrival service work, including inspection and
  QC, installation at the customer site, preventive maintenance, sparepart
  records, and the BAST (handover) document that signals work completion.
- **HRGA / Legal** — owns company legal documents, employee letters, and
  compliance monitoring with 90-day and 30-day expiry reminders.
- **Tax & Insurance** — owns Indonesian tax operational records, tracking
  monthly tax periods, payment receipts, and the reporting artefacts the
  business is legally required to keep.

## Core flow: the Purchase Order lifecycle

The Purchase Order (PO) is the single record that binds the divisions
together. Each PO walks through 11 sequential stages, and every stage is
owned by exactly one division. A stage transition is never silent: each
hand-off writes to the PO status history, fires the matching notification
(if its template is enabled), and updates the live PO status that is
visible in the global PO Tracking page. SLA timers and reminders for these
stages are described in
[business/sla-policies.md](./sla-policies.md).

**Sales: Registered then Processed.** Sales creates the PO record from a
confirmed customer order, which sets the stage to Registered. Once Sales
has reviewed and confirmed the order details, the stage advances to
Processed. Each Sales stage has a 2-working-day deadline; missing it flags
the PO as overdue and notifies Superadmin, CEO, Admin & Log, and Finance
so the delay can be addressed.

**Finance: Production.** Finance opens its Purchase Requisition for the
matching vendor part. When Finance uploads the vendor PO Out and its date,
the PO automatically advances to Production, which signals that the goods
are being produced or sourced.

**Admin & Log: Shipped, Customs, Arrived.** Once goods are in transit,
Admin & Log records the airway bill (AWB). Entering the AWB number moves
the PO to Shipped; entering the transit date moves it to Customs; entering
the arrival date moves it to Arrived. These three transitions are
automated by AWB field writes rather than manual stage clicks.

**Technical: Inspected.** When the goods land, Technical runs incoming
inspection and QC. Completing inspection moves the PO to Inspected and
clears the goods to be delivered to the customer.

**Admin & Log: Delivery.** Admin & Log issues a Delivery Order (DO) once
Technical signals "Ready to Deliver". Recording the DO number moves the PO
to Delivery. If Admin & Log does not respond to the Ready-to-Deliver
signal within 2 working days, a reminder is sent.

**Technical: Installation then BAST.** Technical installs the goods on the
customer site and records completion. After installation, Technical
uploads the BAST (handover document signed by the customer), moving the PO
to BAST.

**Finance: Invoice.** The BAST upload triggers Finance to draft the
customer invoice. When Finance uploads the final Invoice Customer, the PO
advances to its terminal Invoice stage and the lifecycle is complete.

## How data is protected

**Three-layer access control.** Every role's reach is enforced in three
places: the menus and screens a user sees, the checks performed
when the user submits an action, and the per-record visibility rule
applied whenever the system reads or writes data. The same permission rule is checked at all three layers, so a user
who tampers with what is shown on screen cannot reach data their role is
not allowed to see. The full permission matrix lives in the database, not in code, so
permissions can be adjusted without a release. See
[business/audit-and-compliance.md](./audit-and-compliance.md) for how
these enforcement points are reviewed.

**Audit trail on every change.** Every workflow state change records who
made it, when it happened, what note or reason was attached, and which
attachment (if any) was uploaded with it. PO transitions, document
updates, user management actions, and permission edits are all written to
history tables. Records are soft-deleted rather than removed, so a
historical view of the business is always reconstructible.

**Private file storage.** Attachments live in private object storage
buckets that have no public read access. Whenever a user previews
or downloads a file, the system issues a single-use secure link that
expires in 15 minutes for downloads and 5 minutes for uploads. The
file's metadata is always written to the database alongside the bytes,
so permission is verified against the system's records, not against
the storage itself.

## Glossary

### Glossary: PO

PO stands for Purchase Order, the central work record in the system. A PO
captures a confirmed customer order and walks through an 11-stage
lifecycle that crosses Sales, Finance, Admin & Log, and Technical. Every
PO carries its number, current status, customer, due date, and full
status history, and is searchable from the global PO Tracking page.

### Glossary: PR

PR stands for Purchase Request, the Sales-side request that asks the
business to source or produce items needed for a customer order. Sales
creates a PR alongside its sales forms; once Finance acts on it, the PR
flows into the corresponding Finance Purchase Requisition workstream. PR
status changes emit their own notification events.

### Glossary: PR PO-Out

PR PO-Out is the vendor-facing Purchase Order document that Finance
uploads against an open Purchase Requisition. Uploading the PO-Out file
and its date is the trigger that advances the matching customer PO to the
Production stage. It is the official confirmation that production or
external sourcing has started.

### Glossary: Quotation

A Quotation is the Sales-issued price proposal sent to a prospective
customer before a PO is created. It captures line items, currency, and
validity, and serves as the basis for the customer's eventual order.
Quotations are managed in the Sales module and are linked to the customer
record they belong to.

### Glossary: HPP

HPP stands for Harga Pokok Penjualan, the Indonesian term for Cost of
Goods Sold. In the Sales module, HPP records capture the underlying cost
calculation that backs a Quotation or PO, so Sales can quote price
correctly and Finance has a reference for margin. HPP entries are
role-scoped to Sales and roles with global visibility.

### Glossary: BAST

BAST stands for Berita Acara Serah Terima, the Indonesian handover
document that confirms the customer has accepted installed goods or
completed work. Technical uploads the BAST after installation, which
advances the PO to its BAST stage and triggers Finance to draft the final
customer invoice. A signed BAST is the legal proof of delivery on the
customer side.

### Glossary: AWB

AWB stands for Airway Bill, the shipping document used by Admin & Log to
track goods in transit. Recording the AWB number on a PO automatically
moves it to Shipped; entering the transit date moves it to Customs; and
entering the arrival date moves it to Arrived. These three automations are
the core of the Admin & Log shipping workflow.

### Glossary: DO

DO stands for Delivery Order, the document Admin & Log issues to send
goods from the warehouse to the customer site. Recording the DO number on
a PO moves it to the Delivery stage. The DO is created in response to a
Technical "Ready to Deliver" signal, with a 2-working-day response SLA.

### Glossary: Masa Pajak

Masa Pajak is the Indonesian term for "tax period", typically a calendar
month. The Tax & Insurance module records every payment and report
against a specific Masa Pajak so that PPh 21, PPh 25, and PPN obligations
can be reconciled month by month. Forms expose Masa Pajak as a month
picker.

### Glossary: SPT

SPT stands for Surat Pemberitahuan, the Indonesian periodic tax return
filed with the tax authority. Tax & Insurance records the SPT alongside
its supporting payment artefacts (SSP, billing code, NTPN, NTB) for each
relevant Masa Pajak. A complete SPT record is required evidence for tax
audit and compliance review.

### Glossary: NPWP

NPWP stands for Nomor Pokok Wajib Pajak, the Indonesian taxpayer
identification number. NPWP is recorded on the company itself for HRGA
legal compliance and on customers and counterparties wherever tax
reporting requires it. NPWP documents are tracked by HRGA for expiry and
re-issuance.

### Glossary: BPJS

BPJS is the Indonesian national social security scheme, covering both
health (BPJS Kesehatan) and employment (BPJS Ketenagakerjaan). HRGA
maintains the company's BPJS registration documents and tracks any
expiry or renewal deadlines. BPJS records sit alongside the other
legalitas documents in the HRGA archive.

### Glossary: KEMNAKER

KEMNAKER refers to documents and registrations issued by the Indonesian
Ministry of Manpower (Kementerian Ketenagakerjaan). HRGA tracks any
KEMNAKER-issued certificates relevant to the company, including
their expiry dates. They are monitored under the same 90-day and 30-day
expiry reminder rules as the other compliance documents.

### Glossary: Domisili

Domisili refers to the company's Surat Keterangan Domisili, the
Indonesian local-government letter that certifies the registered business
address. HRGA stores the Domisili document and watches its expiry so that
renewal can be initiated before lapsing. It is one of the core legalitas
items tracked in the HRGA module.

### Glossary: Superadmin

Superadmin is the system-developer role with unrestricted access to every
module, every record, every audit log, and every configuration. Superadmin
can create, edit, and delete users in any role, manage all permission
matrices, and toggle any notification template. There are typically only
one or two Superadmin accounts in the live system.

### Glossary: CEO

CEO is the executive role with full read visibility equivalent to
Superadmin. The CEO can view the complete PO lifecycle and history,
manage role groups, and manage email templates. CEO automatically
receives escalation notifications for every SLA breach in the business.

### Glossary: Sales

Sales is the customer-facing division responsible for forecasts,
quotations, HPP, customer records, Purchase Requests, and the first two
stages of every PO (Registered and Processed). Sales triggers the PO
lifecycle and is held to a 2-working-day SLA on each of its stages. Sales
managers can manage other Sales users when granted that capability.

### Glossary: Admin & Log

Admin & Log is the logistics division responsible for AWB, Delivery
Orders, and operational petty cash. It owns the Shipped, Customs, Arrived,
and Delivery stages of the PO lifecycle, three of which are automated by
field writes on the AWB record. Admin & Log must also respond within 2
working days when Technical signals Ready to Deliver.

### Glossary: Finance

Finance is the money-side division responsible for PO Customer records,
Purchase Requisitions, Invoice Manufacture, and Invoice Customer. It owns
the Production and Invoice stages of the PO lifecycle and is the role
that closes out every PO with a customer invoice. Finance also processes
manufacture billing and payment.

### Glossary: Technical

Technical is the service-delivery division responsible for Job Orders,
Inspection and QC, Installation, Preventive Maintenance, Spareparts, and
BAST documents. It owns the Inspected, Installation, and BAST stages of
the PO lifecycle. Technical also tracks 30-day PO due-date reminders and
hands off to Admin & Log via the Ready-to-Deliver signal.

### Glossary: HRGA

HRGA stands for Human Resources and General Affairs (combined with Legal
in this system). HRGA manages company legalitas documents (Akta, NIB,
NPWP, BPJS, KEMNAKER, Domisili and similar),
company letters such as Surat Edaran and Surat Keterangan Karyawan, and
the compliance archive. HRGA enforces 90-day and 30-day expiry reminders
on every monitored document.

### Glossary: Tax & Insurance

Tax & Insurance is the compliance division responsible for the company's
Indonesian tax operational records. It supports PPh 21, PPh 25, and PPN
obligations, and tracks supporting artefacts including SSP, billing code,
NTPN, NTB, SPT, Masa Pajak, and Tahun Pajak. Every record carries a full
audit trail to satisfy tax-audit requirements.

<!-- drift-anchors:
  interlabs-crm-demo/docs/CTX_master_context.txt
  interlabs-crm-demo/docs/CTX_architecture.txt
  CLAUDE.md
-->
