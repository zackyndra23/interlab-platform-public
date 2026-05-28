---
audience: stakeholder
reading_time: 6 min
last_reviewed: 2026-04-27
---

# SLA Policies

## What an SLA means in this system

An SLA (service-level agreement) is a promise about how quickly something
will get done after a specific event happens in the business. The system
watches for those events the moment they are recorded — a new
**[PO](./system-overview.md#glossary-po)** arriving in Sales, the
**[Technical](./system-overview.md#glossary-technical)** team marking
equipment as Ready to Deliver, a legal document approaching its expiry,
or a tax period closing — and starts an internal countdown against the
deadline that is policy for that event. If the deadline passes without
the responsible team taking action, the system automatically sends a
reminder to the team that owes the work and escalates upward to
leadership so nothing slips silently. SLA timers are measured in working
days, with weekends excluded — see the [working-day rule](#working-day-rule)
for the exact behaviour and the gap around Indonesian public holidays.

## SLA catalogue

The table below lists every SLA the system enforces today. Each row
states who owns the deadline, how long they have, what happens when it
is missed, and how often the system checks for breaches.

| SLA name | Who owns it | Deadline | What happens when missed | How it is checked |
|---|---|---|---|---|
| Sales 2-working-day PO response | **[Sales](./system-overview.md#glossary-sales)** | 2 working days from PO entering the Registered stage, and another 2 working days from PO entering the Processed stage | Reminder to Sales; escalation to **[Superadmin](./system-overview.md#glossary-superadmin)**, **[CEO](./system-overview.md#glossary-ceo)**, **[Admin & Log](./system-overview.md#glossary-admin--log)**, and **[Finance](./system-overview.md#glossary-finance)**; the next Sales interaction must record a reason and supporting attachment (specced; the automated check is pending implementation) | Specced as continuous monitoring; not yet wired to a scheduled check |
| Technical Ready-to-Deliver 2-working-day Admin & Log response | **[Admin & Log](./system-overview.md#glossary-admin--log)** | 2 working days from the moment Technical signals Ready to Deliver on an installation or sparepart record | Reminder to Admin & Log; escalation to Superadmin, CEO, the Admin & Log lead, and Finance | Every hour, on the hour |
| Technical 30-day PO due-date reminder | **[Technical](./system-overview.md#glossary-technical)** | 30 calendar days before the PO's recorded due date | Reminder to the assigned engineer and the Technical team for that Job Order | Every weekday morning at 08:00 (Asia/Jakarta) |
| HRGA 90-day expiry notice | **[HRGA / Legal](./system-overview.md#glossary-hrga)** | When the document's expiry date is 90 days away | Reminder to HRGA so renewal can begin on time | Every weekday morning at 08:00 (Asia/Jakarta) |
| HRGA 30-day expiry notice | HRGA / Legal | When the document's expiry date is 30 days away | Higher-urgency reminder to HRGA, with the document flagged on the HRGA dashboard | Every weekday morning at 08:00 (Asia/Jakarta) |
| HRGA expired-document alert | HRGA / Legal | The day the document's expiry date passes | Document marked expired; alert to HRGA, Superadmin, and CEO | Every weekday morning at 08:00 (Asia/Jakarta) |
| Tax monthly compliance check — missing required record | **[Tax & Insurance](./system-overview.md#glossary-tax--insurance)** | Whenever a closed **[Masa Pajak](./system-overview.md#glossary-masa-pajak)** is found with no record for one of the required tax types (PPh 21, PPh 25, or PPN) | Alert to Tax & Insurance, Superadmin, and CEO so the missing filing can be created | First day of each month at 08:00 (Asia/Jakarta) |
| Tax monthly compliance check — unpaid closed Masa Pajak | Tax & Insurance | Any tax record still marked Unpaid after its Masa Pajak has closed | Reminder to Tax & Insurance and the record's person-in-charge; copy to Superadmin and CEO | First day of each month at 08:00 (Asia/Jakarta) |
| Tax monthly compliance check — **[SPT](./system-overview.md#glossary-spt)** not filed | Tax & Insurance | Any record with an SPT obligation that has no filing date once its Masa Pajak has closed | Reminder to Tax & Insurance and the record's person-in-charge; copy to Superadmin and CEO | First day of each month at 08:00 (Asia/Jakarta) |

A note on the first row. The Sales 2-working-day response policy is
specified as a hard rule across both early stages of the PO lifecycle,
and the underlying timestamps for it (the per-stage internal deadlines)
are already captured on every Sales PO and Sales Purchase Request. The
automated scan that fires the breach reminder is not yet wired up. Until
it is, dashboards still show overdue items, but there is no scheduled
job that pushes a notification or escalation. This gap is tracked and
will be closed in a future iteration.

## Escalation paths

Each SLA has an explicit list of recipients so the right people see a
breach without flooding everyone. The patterns below describe who is
notified at each step.

The Sales 2-working-day PO response is owned by Sales. When a stage
deadline passes, the breach reminder is delivered to the Sales user
working the record, and an escalation copy goes to Superadmin, CEO,
Admin & Log, and Finance — the four parties who depend on Sales moving
the PO forward. The Sales user is also forced to record a reason and
attach supporting evidence the next time they touch the record.

The Technical Ready-to-Deliver response is owned by Admin & Log. The
moment Technical marks an installation or sparepart record as Ready to
Deliver, a 2-working-day clock starts on Admin & Log. If the clock runs
out before Admin & Log acknowledges or dispatches, the system sends one
overdue notification to Admin & Log and escalates the same alert to
Superadmin and CEO. Finance is informed because the Delivery and Invoice
stages depend on this hand-off completing on time. The reminder fires
once per signal — re-toggling Ready to Deliver later restarts the clock
cleanly.

The Technical 30-day PO due-date reminder stays inside Technical. When
the system flags a Job Order whose PO due date is 30 days away, the
reminder is delivered to the engineer assigned to the Job Order, the
support team members on that Job Order, and the Technical role group so
the team has shared visibility. There is no upward escalation at this
stage — the reminder is a heads-up, not a breach.

The HRGA expiry tiers all stay inside HRGA at first. The 90-day and
30-day notices are reminders to the HRGA team only; they are
informational so renewal work can begin on time. Once a document
actually expires, the alert escalates out of HRGA: Superadmin and CEO
are added to the recipient list because an expired legal document is a
compliance risk for the company.

The Tax monthly compliance checks all share one escalation pattern. For
every breach class — missing required record, unpaid closed Masa Pajak,
or **[SPT](./system-overview.md#glossary-spt)** not filed — the alert
goes to the Tax & Insurance role group, with Superadmin and CEO copied
in so leadership has direct visibility on tax-compliance gaps. For the
unpaid and SPT-not-filed cases the record's person-in-charge is also
notified directly so the named owner cannot miss it.

In every case the rules above describe the system's default behaviour.
Superadmin and CEO can mute or re-enable any individual notification
from the notification template settings, but they cannot redirect a
breach away from the responsible team — ownership of the SLA stays with
the role that owns the work.

## Working-day rule

Every SLA timer in this system is measured in working days. The
implementation treats Saturdays and Sundays as non-working days and
skips them when counting elapsed time and when computing future
deadlines. So a 2-working-day deadline that starts on a Friday afternoon
falls due on the following Tuesday afternoon, not over the weekend.

The system does not currently maintain a list of Indonesian public
holidays. That means a national holiday falling on a Monday through
Friday is treated as a normal working day for the purposes of SLA
timers. In practice this can cause a reminder or escalation to fire on
an observed public holiday, even though no one is in the office to act
on it. Recipients should treat such a notification as something to pick
up on the next true working day rather than as a real breach.

The clock for a working-day timer starts at the exact moment the
triggering event is recorded, not at the start of that day. The
deadline preserves the same time of day, two working days later.

A holiday-aware version of this calculation is on the roadmap. When it
is added, the same SLA rules described above will continue to apply
without changing — only the underlying day-counting will skip official
public holidays in addition to weekends. Until then, the safe assumption
is that the system counts every weekday as a working day.

<!-- drift-anchors:
  interlabs-crm-demo/docs/MOD_sales.txt
  interlabs-crm-demo/docs/MOD_admin_log.txt
  interlabs-crm-demo/docs/MOD_finance.txt
  interlabs-crm-demo/docs/MOD_technical.txt
  interlabs-crm-demo/docs/MOD_hrga.txt
  interlabs-crm-demo/docs/MOD_tax_insurance.txt
  docs/business/system-overview.md
-->
