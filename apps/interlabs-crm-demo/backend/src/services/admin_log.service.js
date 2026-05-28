'use strict';

const db = require('../config/database');
const poService = require('./po.service');
const notificationService = require('./notification.service');
const { nextRecordNumber, ADMIN_LOG_PREFIXES } = require('../utils/recordNumbers');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { listAttachmentsForEntity } = require('../utils/attachments');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// Admin & Log module service layer.
//
// Owns PO lifecycle stages Shipped, Customs, Arrived, and Delivery. Each
// stage transition is driven by a write to a trigger field on an AWB
// (Shipped/Customs/Arrived) or DO (Delivery) record:
//
//   AWB form trigger fields (MOD_admin_log §FORM 1 STATUS AUTOMATION):
//     awb_tracking_number null → present  →  awb status Registered,
//                                            master PO → Shipped,
//                                            emit admin_log.awb.shipped
//     transit_date        null → present  →  awb status Processed,
//                                            master PO → Customs,
//                                            emit admin_log.awb.customs
//     arrival_date        null → present  →  awb status Arrived,
//                                            master PO → Arrived,
//                                            emit admin_log.awb.arrived
//
//   DO form trigger fields (MOD_admin_log §FORM 2 STATUS AUTOMATION):
//     delivery_order_number null → present  →  do status Registered,
//                                              master PO → Delivery,
//                                              emit admin_log.do.registered
//     customer_arrival_date null → present  →  do status Arrived,
//                                              master PO stage unchanged,
//                                              emit admin_log.do.arrived
//
// Triggers are firmly (null/empty) → (present) — updates that only change
// non-trigger fields do NOT fire the automation. The service checks this
// transition state using a FOR UPDATE lock on the row inside a transaction,
// so concurrent writes cannot double-fire.
//
// advanceStatus() on po.service is idempotent (returns the row unchanged
// if the requested status equals the current one), so a second AWB/DO
// record that tries to push the PO back to a previous stage simply
// no-ops. Forward-only motion is enforced by po.service itself.
//
// Ready-to-Deliver dependency (MOD_admin_log §DEPENDENCY): when Technical
// sets installation_records.ready_to_deliver='Yes', Admin & Log must
// respond within 2 working days. acknowledgeReadyToDeliver() flips
// admin_log_response_status pending → acknowledged/dispatched and, when a
// delivery_method is supplied, persists it. A reminder is emitted by the
// sla_ready_to_deliver_monitor background job (jobs/slaReadyToDeliver.job.js)
// once the 2-working-day window lapses.

// ---------------------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------------------

async function listRows({
    table,
    selectColumns = '*',
    search,
    searchColumn,
    scopeUserId,
    extraFilters = [],
    orderBy = 'created_at DESC',
    query,
}) {
    const { page, limit, offset } = parsePagination(query);
    const clauses = ['deleted_at IS NULL'];
    const params = [];

    if (search && searchColumn) {
        params.push(`%${search}%`);
        clauses.push(`${searchColumn} ILIKE $${params.length}`);
    }
    if (scopeUserId) {
        params.push(scopeUserId);
        clauses.push(`created_by = $${params.length}`);
    }
    for (const filter of extraFilters) {
        params.push(filter.value);
        clauses.push(filter.sql.replace('$X', `$${params.length}`));
    }
    const where = clauses.join(' AND ');

    const countRes = await db.query(
        `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT ${selectColumns}
           FROM ${table}
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function requireRow(table, id, runner = db) {
    const { rows } = await runner.query(
        `SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
        [id],
    );
    if (rows.length === 0) throw new NotFoundError(`${table} row ${id} not found`);
    return rows[0];
}

// Link uploaded file_attachments rows to a specific (module, entity). Mirrors
// finance.service.attachFilesToEntity so multi-file upload triggers behave
// identically across modules.
async function attachFilesToEntity(client, attachmentIds, relatedModule, entityId) {
    if (!attachmentIds || attachmentIds.length === 0) return 0;
    const { rowCount } = await client.query(
        `UPDATE file_attachments
            SET related_module    = $1,
                related_entity_id = $2
          WHERE id = ANY($3::uuid[])
            AND deleted_at IS NULL`,
        [relatedModule, entityId, attachmentIds],
    );
    if (rowCount !== attachmentIds.length) {
        throw new BadRequestError(
            `Expected ${attachmentIds.length} attachments to bind; only ${rowCount} matched`,
        );
    }
    return rowCount;
}

// Denormalized po_number lookup for the `related_po_number` column on AWB and
// DO rows. Kept denormalized for listing performance; master po_number is
// immutable once a PO is initialized, so the snapshot stays correct.
async function lookupPoNumber(client, poId) {
    const { rows } = await client.query(
        `SELECT po_number FROM purchase_orders
          WHERE id = $1 AND deleted_at IS NULL`,
        [poId],
    );
    if (rows.length === 0) {
        throw new BadRequestError(`purchase_orders ${poId} not found or deleted`);
    }
    return rows[0].po_number;
}

// Append a row to awb_status_history / delivery_order_status_history. The
// master PO receives its own entry via po.service.advanceStatus; this local
// history is an AWB/DO-scoped audit trail that records every automation step.
async function writeAwbHistory(client, { awbId, statusCode, actor, note, attachmentUrl = null }) {
    await client.query(
        `INSERT INTO awb_status_history
           (awb_id, status_code, updated_by_user_id, updated_by_role, note, attachment_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [awbId, statusCode, actor.id, actor.role, note, attachmentUrl],
    );
}

async function writeDoHistory(client, { doId, statusCode, actor, note, attachmentUrl = null }) {
    await client.query(
        `INSERT INTO delivery_order_status_history
           (do_id, status_code, updated_by_user_id, updated_by_role, note, attachment_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [doId, statusCode, actor.id, actor.role, note, attachmentUrl],
    );
}

// ============================================================================
// AIRWAY BILL (AWB)
// ============================================================================

async function listAwb({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.current_awb_status) {
        extraFilters.push({
            sql: 'current_awb_status = $X',
            value: query.current_awb_status,
        });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    return listRows({
        table: 'awb_records',
        search: query.search,
        searchColumn: 'awb_record_number',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getAwb(id) {
    const row = await requireRow('awb_records', id);
    row.attachments = await listAttachmentsForEntity('admin_log.awb_records', id);
    return row;
}

// Run the trigger-field automation for an AWB row. Given `before` (pre-write
// row snapshot, or null for newly-created rows) and `after` (post-write row),
// determine which trigger fields just became populated and advance the
// master PO accordingly. Each write is a separate poService.advanceStatus
// call so all four invariants are enforced per transition.
async function runAwbAutomation(client, { before, after, actor, note = null }) {
    const becamePresent = (field) =>
        !(before && before[field]) && Boolean(after[field]);

    // The fields are independent; the spec allows them to land in the same
    // save. We replay them in their natural PO-lifecycle order so that each
    // advanceStatus progression is forward-only (the po.service guard
    // otherwise would reject out-of-order transitions).
    const transitions = [];
    if (becamePresent('awb_tracking_number')) {
        transitions.push({
            newStatus: 'Shipped',
            awbStatus: 'Registered',
            statusCode: 'SHIPPED',
            template: 'admin_log.awb.shipped',
            eventNote: note || `AWB tracking number ${after.awb_tracking_number} entered`,
        });
    }
    if (becamePresent('transit_date')) {
        transitions.push({
            newStatus: 'Customs',
            awbStatus: 'Processed',
            statusCode: 'CUSTOMS',
            template: 'admin_log.awb.customs',
            eventNote: note || `Transit date ${after.transit_date} recorded`,
        });
    }
    if (becamePresent('arrival_date')) {
        transitions.push({
            newStatus: 'Arrived',
            awbStatus: 'Arrived',
            statusCode: 'ARRIVED',
            template: 'admin_log.awb.arrived',
            eventNote: note || `Arrival date ${after.arrival_date} recorded`,
        });
    }

    if (transitions.length === 0) return { transitioned: [] };

    let latestAwbStatus = after.current_awb_status;
    for (const t of transitions) {
        // 1. Flip the local AWB status (enum on awb_records).
        await client.query(
            `UPDATE awb_records
                SET current_awb_status = $1,
                    updated_by         = $2,
                    updated_at         = now()
              WHERE id = $3`,
            [t.awbStatus, actor.id, after.id],
        );
        latestAwbStatus = t.awbStatus;

        // 2. AWB-scoped history row (separate from purchase_order_status_history).
        await writeAwbHistory(client, {
            awbId: after.id,
            statusCode: t.statusCode,
            actor,
            note: t.eventNote,
        });

        // 3. Advance master PO. advanceStatus writes
        //    purchase_order_status_history + tracking event, syncs the
        //    po_customer mirror, and fires STATUS_TEMPLATE (admin_log.po.*).
        await poService.advanceStatus(client, {
            poId: after.related_po_id,
            newStatus: t.newStatus,
            actorUserId: actor.id,
            actorRole: actor.role,
            note: t.eventNote,
        });

        // 4. Emit the AWB-scoped notification (admin_log.awb.*). Recipients
        //    per MOD_admin_log §[ADMIN & LOG NOTIFICATION EVENTS]: Finance,
        //    Technical, Superadmin, CEO. The template row (when present)
        //    overrides this default via recipient_roles_json.
        await notificationService.emit(client, {
            templateKey: t.template,
            title: `AWB ${after.awb_record_number} → ${t.awbStatus}`,
            message: t.eventNote,
            module: 'admin_log',
            entityType: 'awb_records',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'technical', 'superadmin', 'ceo'],
        });
    }

    return { transitioned: transitions.map((t) => t.newStatus), latestAwbStatus };
}

async function createAwb(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'awb_records', 'awb_record_number', ADMIN_LOG_PREFIXES.AWB,
        );

        const relatedPoNumber = data.related_po_number
            || await lookupPoNumber(c, data.related_po_id);

        const { rows } = await c.query(
            `INSERT INTO awb_records
               (awb_record_number, related_po_id, related_po_number, customer_id,
                supplier_or_manufacturer, forwarder_or_courier, awb_tracking_number,
                shipment_method, origin_country, transit_country_or_hub, destination,
                despatch_date, transit_date, arrival_date,
                current_awb_status, weight_kg, package_count, description_of_goods,
                incoterm, notes, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                     $12,$13,$14,'Registered',$15,$16,$17,$18,$19,$20,$20)
             RETURNING *`,
            [
                recordNumber, data.related_po_id, relatedPoNumber, data.customer_id,
                data.supplier_or_manufacturer, data.forwarder_or_courier,
                data.awb_tracking_number,
                data.shipment_method, data.origin_country,
                data.transit_country_or_hub, data.destination,
                data.despatch_date, data.transit_date, data.arrival_date,
                data.weight_kg, data.package_count, data.description_of_goods,
                data.incoterm, data.notes, actor.id,
            ],
        );
        const awb = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(c, data.attachment_ids, 'admin_log.awb_records', awb.id);
        }

        // Trigger automation for every field populated on the initial write.
        // `before` is null to signal "nothing was present" so becamePresent
        // returns true for every provided trigger field.
        const { latestAwbStatus } = await runAwbAutomation(c, {
            before: null,
            after: awb,
            actor,
        });

        if (latestAwbStatus && latestAwbStatus !== awb.current_awb_status) {
            awb.current_awb_status = latestAwbStatus;
        }
        return awb;
    });
}

async function updateAwb(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM awb_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`awb_records ${id} not found`);
        const before = lockRows[0];

        // If the caller changes related_po_id, refresh the denormalized
        // po_number snapshot. Trigger replay still operates on the final row.
        let nextPoNumber = data.related_po_number;
        if (data.related_po_id && data.related_po_id !== before.related_po_id) {
            nextPoNumber = await lookupPoNumber(c, data.related_po_id);
        }

        const { rows } = await c.query(
            `UPDATE awb_records SET
                related_po_id             = COALESCE($2, related_po_id),
                related_po_number         = COALESCE($3, related_po_number),
                customer_id               = COALESCE($4, customer_id),
                supplier_or_manufacturer  = COALESCE($5, supplier_or_manufacturer),
                forwarder_or_courier      = COALESCE($6, forwarder_or_courier),
                awb_tracking_number       = COALESCE($7, awb_tracking_number),
                shipment_method           = COALESCE($8, shipment_method),
                origin_country            = COALESCE($9, origin_country),
                transit_country_or_hub    = COALESCE($10, transit_country_or_hub),
                destination               = COALESCE($11, destination),
                despatch_date             = COALESCE($12, despatch_date),
                transit_date              = COALESCE($13, transit_date),
                arrival_date              = COALESCE($14, arrival_date),
                weight_kg                 = COALESCE($15, weight_kg),
                package_count             = COALESCE($16, package_count),
                description_of_goods      = COALESCE($17, description_of_goods),
                incoterm                  = COALESCE($18, incoterm),
                notes                     = COALESCE($19, notes),
                updated_by                = $20,
                updated_at                = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_po_id, nextPoNumber, data.customer_id,
                data.supplier_or_manufacturer, data.forwarder_or_courier,
                data.awb_tracking_number,
                data.shipment_method, data.origin_country,
                data.transit_country_or_hub, data.destination,
                data.despatch_date, data.transit_date, data.arrival_date,
                data.weight_kg, data.package_count, data.description_of_goods,
                data.incoterm, data.notes, actor.id,
            ],
        );
        const after = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(c, data.attachment_ids, 'admin_log.awb_records', after.id);
        }

        const { latestAwbStatus } = await runAwbAutomation(c, { before, after, actor });
        if (latestAwbStatus && latestAwbStatus !== after.current_awb_status) {
            after.current_awb_status = latestAwbStatus;
        }
        return after;
    });
}

async function deleteAwb(id, actor) {
    const existing = await requireRow('awb_records', id);
    // Once a trigger has fired, the master PO has advanced; soft-deleting the
    // AWB row would orphan that history. Block deletion in any non-initial
    // state. Callers must use a corrective record workflow instead.
    if (existing.current_awb_status !== 'Registered' || existing.awb_tracking_number) {
        throw new ConflictError(
            `AWB ${existing.awb_record_number} already drove PO automation; cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE awb_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

async function getAwbHistory(awbId) {
    await requireRow('awb_records', awbId);
    const { rows } = await db.query(
        `SELECT id, awb_id, status_code, updated_by_user_id, updated_by_role,
                note, attachment_url, created_at
           FROM awb_status_history
          WHERE awb_id = $1
          ORDER BY created_at ASC`,
        [awbId],
    );
    return rows;
}

// ============================================================================
// DELIVERY ORDER (DO)
// ============================================================================

async function listDeliveryOrders({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.current_do_status) {
        extraFilters.push({ sql: 'current_do_status = $X', value: query.current_do_status });
    }
    if (query.related_po_id) {
        extraFilters.push({ sql: 'related_po_id = $X', value: query.related_po_id });
    }
    return listRows({
        table: 'delivery_orders',
        search: query.search,
        searchColumn: 'do_record_number',
        scopeUserId,
        extraFilters,
        query,
    });
}

async function getDeliveryOrder(id) {
    return requireRow('delivery_orders', id);
}

// DO automation replay: same contract as runAwbAutomation, different
// triggers. Only delivery_order_number advances the master PO; the second
// trigger (customer_arrival_date) emits a notification + local history but
// leaves the PO stage at Delivery (per MOD_admin_log §FORM 2).
async function runDoAutomation(client, { before, after, actor, note = null }) {
    const becamePresent = (field) =>
        !(before && before[field]) && Boolean(after[field]);

    let latestStatus = after.current_do_status;

    if (becamePresent('delivery_order_number')) {
        await client.query(
            `UPDATE delivery_orders
                SET current_do_status = 'Registered',
                    updated_by        = $1,
                    updated_at        = now()
              WHERE id = $2`,
            [actor.id, after.id],
        );
        latestStatus = 'Registered';

        const eventNote = note
            || `DO number ${after.delivery_order_number} entered`;
        await writeDoHistory(client, {
            doId: after.id,
            statusCode: 'DELIVERY',
            actor,
            note: eventNote,
        });

        await poService.advanceStatus(client, {
            poId: after.related_po_id,
            newStatus: 'Delivery',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: eventNote,
        });

        await notificationService.emit(client, {
            templateKey: 'admin_log.do.registered',
            title: `DO ${after.do_record_number} registered`,
            message: eventNote,
            module: 'admin_log',
            entityType: 'delivery_orders',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'technical', 'superadmin', 'ceo'],
        });
    }

    if (becamePresent('customer_arrival_date')) {
        await client.query(
            `UPDATE delivery_orders
                SET current_do_status = 'Arrived',
                    updated_by        = $1,
                    updated_at        = now()
              WHERE id = $2`,
            [actor.id, after.id],
        );
        latestStatus = 'Arrived';

        const eventNote = note
            || `Customer arrival date ${after.customer_arrival_date} recorded`;
        // Informational DO-scoped history — master PO stage is not moved
        // because Delivery continues until Technical marks Installation.
        await writeDoHistory(client, {
            doId: after.id,
            statusCode: 'DO_ARRIVED',
            actor,
            note: eventNote,
        });

        await notificationService.emit(client, {
            templateKey: 'admin_log.do.arrived',
            title: `DO ${after.do_record_number} arrived`,
            message: eventNote,
            module: 'admin_log',
            entityType: 'delivery_orders',
            entityId: after.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'technical', 'superadmin', 'ceo'],
        });
    }

    return { latestStatus };
}

async function createDeliveryOrder(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'delivery_orders', 'do_record_number', ADMIN_LOG_PREFIXES.DELIVERY,
        );
        const relatedPoNumber = data.related_po_number
            || await lookupPoNumber(c, data.related_po_id);

        const { rows } = await c.query(
            `INSERT INTO delivery_orders
               (do_record_number, related_po_id, related_po_number, customer_id,
                delivery_order_number, delivery_date, shipping_method,
                courier_or_expedition_vendor, dispatch_from,
                delivery_address, invoicing_address, item_list,
                technical_inspection_reference_date, customer_arrival_date,
                current_do_status, remarks, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                     $13,$14,'Registered',$15,$16,$16)
             RETURNING *`,
            [
                recordNumber, data.related_po_id, relatedPoNumber, data.customer_id,
                data.delivery_order_number, data.delivery_date, data.shipping_method,
                data.courier_or_expedition_vendor, data.dispatch_from,
                data.delivery_address, data.invoicing_address,
                JSON.stringify(data.item_list || []),
                data.technical_inspection_reference_date, data.customer_arrival_date,
                data.remarks, actor.id,
            ],
        );
        const deliveryOrder = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'admin_log.delivery_orders', deliveryOrder.id,
            );
        }

        const { latestStatus } = await runDoAutomation(c, {
            before: null,
            after: deliveryOrder,
            actor,
        });
        if (latestStatus && latestStatus !== deliveryOrder.current_do_status) {
            deliveryOrder.current_do_status = latestStatus;
        }
        return deliveryOrder;
    });
}

async function updateDeliveryOrder(id, data, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM delivery_orders
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`delivery_orders ${id} not found`);
        const before = lockRows[0];

        let nextPoNumber = data.related_po_number;
        if (data.related_po_id && data.related_po_id !== before.related_po_id) {
            nextPoNumber = await lookupPoNumber(c, data.related_po_id);
        }

        const { rows } = await c.query(
            `UPDATE delivery_orders SET
                related_po_id                       = COALESCE($2, related_po_id),
                related_po_number                   = COALESCE($3, related_po_number),
                customer_id                         = COALESCE($4, customer_id),
                delivery_order_number               = COALESCE($5, delivery_order_number),
                delivery_date                       = COALESCE($6, delivery_date),
                shipping_method                     = COALESCE($7, shipping_method),
                courier_or_expedition_vendor        = COALESCE($8, courier_or_expedition_vendor),
                dispatch_from                       = COALESCE($9, dispatch_from),
                delivery_address                    = COALESCE($10, delivery_address),
                invoicing_address                   = COALESCE($11, invoicing_address),
                item_list                           = COALESCE($12::jsonb, item_list),
                technical_inspection_reference_date = COALESCE($13, technical_inspection_reference_date),
                customer_arrival_date               = COALESCE($14, customer_arrival_date),
                remarks                             = COALESCE($15, remarks),
                updated_by                          = $16,
                updated_at                          = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_po_id, nextPoNumber, data.customer_id,
                data.delivery_order_number, data.delivery_date, data.shipping_method,
                data.courier_or_expedition_vendor, data.dispatch_from,
                data.delivery_address, data.invoicing_address,
                data.item_list === undefined ? null : JSON.stringify(data.item_list),
                data.technical_inspection_reference_date, data.customer_arrival_date,
                data.remarks, actor.id,
            ],
        );
        const after = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'admin_log.delivery_orders', after.id,
            );
        }

        const { latestStatus } = await runDoAutomation(c, { before, after, actor });
        if (latestStatus && latestStatus !== after.current_do_status) {
            after.current_do_status = latestStatus;
        }
        return after;
    });
}

async function deleteDeliveryOrder(id, actor) {
    const existing = await requireRow('delivery_orders', id);
    if (existing.current_do_status !== 'Registered' || existing.delivery_order_number) {
        throw new ConflictError(
            `Delivery Order ${existing.do_record_number} already drove PO automation; cannot be deleted`,
        );
    }
    await db.query(
        `UPDATE delivery_orders SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

async function getDeliveryOrderHistory(doId) {
    await requireRow('delivery_orders', doId);
    const { rows } = await db.query(
        `SELECT id, do_id, status_code, updated_by_user_id, updated_by_role,
                note, attachment_url, created_at
           FROM delivery_order_status_history
          WHERE do_id = $1
          ORDER BY created_at ASC`,
        [doId],
    );
    return rows;
}

// ============================================================================
// OPERATIONAL (Petty Cash)
// ============================================================================

// Workflow: draft → submitted → reviewed. No PO stage impact; reporting_month
// is the primary grouping dimension for the Admin & Log dashboard widget.

async function listOperational({ query, scopeUserId }) {
    const extraFilters = [];
    if (query.workflow_status) {
        extraFilters.push({ sql: 'workflow_status = $X', value: query.workflow_status });
    }
    if (query.expense_status) {
        extraFilters.push({ sql: 'expense_status = $X', value: query.expense_status });
    }
    if (query.expense_category) {
        extraFilters.push({ sql: 'expense_category = $X', value: query.expense_category });
    }
    if (query.reporting_month) {
        extraFilters.push({ sql: 'reporting_month = $X', value: query.reporting_month });
    }
    return listRows({
        table: 'admin_operational_records',
        search: query.search,
        searchColumn: 'operational_record_number',
        scopeUserId,
        extraFilters,
        orderBy: 'reporting_month DESC, created_at DESC',
        query,
    });
}

async function getOperational(id) {
    return requireRow('admin_operational_records', id);
}

async function createOperational(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'admin_operational_records', 'operational_record_number',
            ADMIN_LOG_PREFIXES.OPERATIONAL,
        );

        const { rows } = await c.query(
            `INSERT INTO admin_operational_records
               (operational_record_number, reporting_month, department,
                expense_category, expense_subcategory, transaction_date,
                period_start, period_end, vendor_or_payee, related_po_id,
                description, currency, amount, payment_method, expense_status,
                workflow_status, notes, created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                     $11,$12,$13,$14,$15,'draft',$16,$17,$17)
             RETURNING *`,
            [
                recordNumber, data.reporting_month, data.department,
                data.expense_category, data.expense_subcategory, data.transaction_date,
                data.period_start, data.period_end, data.vendor_or_payee, data.related_po_id,
                data.description, data.currency || 'IDR', data.amount,
                data.payment_method, data.expense_status || 'Pending',
                data.notes, actor.id,
            ],
        );
        const op = rows[0];

        if (data.attachment_ids && data.attachment_ids.length > 0) {
            await attachFilesToEntity(
                c, data.attachment_ids, 'admin_log.operational_records', op.id,
            );
        }

        return op;
    });
}

async function updateOperational(id, data, actor) {
    const existing = await requireRow('admin_operational_records', id);
    if (existing.workflow_status === 'reviewed') {
        throw new ConflictError(
            'Reviewed operational records are immutable; open a corrective record',
        );
    }
    const { rows } = await db.query(
        `UPDATE admin_operational_records SET
            reporting_month      = COALESCE($2, reporting_month),
            department           = COALESCE($3, department),
            expense_category     = COALESCE($4, expense_category),
            expense_subcategory  = COALESCE($5, expense_subcategory),
            transaction_date     = COALESCE($6, transaction_date),
            period_start         = COALESCE($7, period_start),
            period_end           = COALESCE($8, period_end),
            vendor_or_payee      = COALESCE($9, vendor_or_payee),
            related_po_id        = COALESCE($10, related_po_id),
            description          = COALESCE($11, description),
            currency             = COALESCE($12, currency),
            amount               = COALESCE($13, amount),
            payment_method       = COALESCE($14, payment_method),
            expense_status       = COALESCE($15, expense_status),
            notes                = COALESCE($16, notes),
            updated_by           = $17,
            updated_at           = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.reporting_month, data.department,
            data.expense_category, data.expense_subcategory, data.transaction_date,
            data.period_start, data.period_end, data.vendor_or_payee, data.related_po_id,
            data.description, data.currency, data.amount,
            data.payment_method, data.expense_status, data.notes, actor.id,
        ],
    );
    return rows[0];
}

async function transitionOperational(id, target, actor) {
    const allowed = ['submitted', 'reviewed'];
    if (!allowed.includes(target)) {
        throw new BadRequestError(`Invalid operational workflow_status: ${target}`);
    }
    const existing = await requireRow('admin_operational_records', id);
    // Forward-only transitions: draft → submitted → reviewed.
    const order = { draft: 0, submitted: 1, reviewed: 2 };
    if (order[target] <= order[existing.workflow_status]) {
        throw new ConflictError(
            `Cannot move operational record ${existing.operational_record_number} from `
            + `'${existing.workflow_status}' to '${target}'`,
        );
    }
    const { rows } = await db.query(
        `UPDATE admin_operational_records SET
            workflow_status = $2,
            updated_by      = $3,
            updated_at      = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id, target, actor.id],
    );
    return rows[0];
}

async function deleteOperational(id, actor) {
    const existing = await requireRow('admin_operational_records', id);
    if (existing.workflow_status === 'reviewed') {
        throw new ConflictError('Reviewed operational records cannot be deleted');
    }
    await db.query(
        `UPDATE admin_operational_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// READY-TO-DELIVER RESPONSE  (MOD_admin_log §DEPENDENCY)
//
// Admin & Log-side endpoint to acknowledge / dispatch a Technical
// Ready-to-Deliver. When Technical sets installation_records.ready_to_deliver
// = 'Yes', the Admin & Log 2-working-day SLA clock starts running from
// installation_records.ready_to_deliver_at. The sla_ready_to_deliver_monitor
// background job emits admin_log.ready_to_deliver.overdue_response when the
// window elapses without response.
// ============================================================================

async function listReadyToDeliver({ query }) {
    const clauses = [
        'ir.deleted_at IS NULL',
        "ir.ready_to_deliver = 'Yes'",
    ];
    const params = [];
    if (query.admin_log_response_status) {
        params.push(query.admin_log_response_status);
        clauses.push(`ir.admin_log_response_status = $${params.length}`);
    } else {
        clauses.push("ir.admin_log_response_status = 'pending'");
    }
    const where = clauses.join(' AND ');

    const { page, limit, offset } = parsePagination(query);
    const countRes = await db.query(
        `SELECT count(*)::int AS c
           FROM installation_records ir
          WHERE ${where}`,
        params,
    );
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const { rows } = await db.query(
        `SELECT ir.id, ir.related_job_order_id, ir.related_po_id,
                ir.ready_to_deliver, ir.ready_to_deliver_at,
                ir.admin_log_response_status, ir.delivery_method,
                ir.workflow_phase, ir.created_at, ir.updated_at,
                tjo.technical_job_order_number, tjo.customer_id,
                tjo.product_or_equipment_name,
                po.po_number
           FROM installation_records ir
           LEFT JOIN technical_job_orders tjo ON tjo.id = ir.related_job_order_id
           LEFT JOIN purchase_orders po       ON po.id = ir.related_po_id
          WHERE ${where}
          ORDER BY ir.ready_to_deliver_at ASC NULLS LAST
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    return { rows, meta: buildMeta(total, page, limit) };
}

async function acknowledgeReadyToDeliver(installationId, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM installation_records
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [installationId],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`installation_records ${installationId} not found`);
        }
        const installation = lockRows[0];

        if (installation.ready_to_deliver !== 'Yes') {
            throw new ConflictError(
                `Installation ${installationId} is not marked Ready to Deliver`,
            );
        }
        if (installation.admin_log_response_status === 'dispatched') {
            throw new ConflictError('Ready-to-Deliver already dispatched');
        }

        const newStatus = input.response_status; // 'acknowledged' | 'dispatched'
        const { rows } = await c.query(
            `UPDATE installation_records SET
                admin_log_response_status = $2,
                delivery_method           = COALESCE($3, delivery_method),
                updated_by                = $4,
                updated_at                = now()
              WHERE id = $1
              RETURNING *`,
            [installationId, newStatus, input.delivery_method || null, actor.id],
        );
        const updated = rows[0];

        // Clear any outstanding SLA reminder state so the background job
        // doesn't re-fire if the tracker was previously flagged overdue.
        await c.query(
            `UPDATE sla_tracking
                SET overdue_at         = NULL,
                    escalation_sent_at = NULL
              WHERE entity_type = 'installation_records.ready_to_deliver'
                AND entity_id   = $1`,
            [installationId],
        );

        // Audit entry on the workflow_step_history generic log.
        await c.query(
            `INSERT INTO workflow_step_history
               (entity_type, entity_id, step_name, step_status, actor_user_id,
                actor_role, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                'installation_records', installationId,
                'ready_to_deliver_response', newStatus,
                actor.id, actor.role,
                input.note || null,
            ],
        );

        return updated;
    });
}

module.exports = {
    // AWB
    listAwb, getAwb, createAwb, updateAwb, deleteAwb, getAwbHistory,
    // DO
    listDeliveryOrders, getDeliveryOrder, createDeliveryOrder, updateDeliveryOrder,
    deleteDeliveryOrder, getDeliveryOrderHistory,
    // Operational
    listOperational, getOperational, createOperational, updateOperational,
    transitionOperational, deleteOperational,
    // Ready-to-Deliver
    listReadyToDeliver, acknowledgeReadyToDeliver,
    // test/helper hooks
    runAwbAutomation, runDoAutomation,
};
