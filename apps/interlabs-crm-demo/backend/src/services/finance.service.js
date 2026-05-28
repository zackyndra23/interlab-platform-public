'use strict';

const db = require('../config/database');
const poService = require('./po.service');
const notificationService = require('./notification.service');
const { nextRecordNumber } = require('../utils/recordNumbers');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { listAttachmentsForEntity } = require('../utils/attachments');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// Finance module service layer.
//
// PO Customer          : auto-created by sales.service.submitSalesPo (hook
//                        `createPoCustomerFromSalesPo`). Read/update only via
//                        this module; its `current_po_status` mirror column is
//                        kept in sync by po.service.advanceStatus calling
//                        `syncPoCustomerForMasterPo`.
//
// Purchase Requisition : auto-created by sales.service.submitSalesPr (hook
//                        `createRequisitionFromSalesPr`). `processRequisition`
//                        requires po_out_number + po_out_date + attachment ids
//                        — the three trigger fields specified in MOD_finance.
//                        It advances the master PO Processed → Production via
//                        poService.advanceStatus and emits finance.pr.processed
//                        in addition to the stage template (finance.po.production).
//
// Invoice Manufacture  : Finance-initiated. On create with an invoice_number
//                        we mark Unpaid and emit finance.invoice_manufacture.registered.
//                        `recordPayment` sets Paid and emits
//                        finance.invoice_manufacture.paid. Payment does NOT
//                        advance the master PO.
//
// Invoice Customer     : draft auto-created by Technical BAST upload (hook
//                        `createInvoiceCustomerDraftFromBast`). `issueInvoiceCustomer`
//                        marks Processed, advances the master PO BAST → Invoice
//                        via poService.advanceStatus, and emits
//                        finance.invoice_customer.processed on top of the
//                        stage template (finance.po.invoice).

const FINANCE_PREFIXES = Object.freeze({
    PO_CUSTOMER:         'POC',
    PURCHASE_REQUISITION:'PRC',
    INVOICE_MANUFACTURE: 'INM',
    INVOICE_CUSTOMER:    'INC',
});

// ---------------------------------------------------------------------------
// SHARED LISTING / LOOKUP HELPERS
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

// Link uploaded file_attachments rows to a specific (module, entity). This is
// how the upload triggers verify "attachment present" — the client uploads
// once via file.service, then passes the resulting attachment ids back to the
// trigger endpoint where we rebind related_entity_id.
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

// ============================================================================
// PO CUSTOMER
// ============================================================================

async function listPoCustomers({ query, scopeUserId }) {
    return listRows({
        table: 'po_customer_records',
        search: query.search,
        searchColumn: 'po_customer_record_number',
        scopeUserId,
        extraFilters: query.workflow_status
            ? [{ sql: 'workflow_status = $X', value: query.workflow_status }]
            : [],
        query,
    });
}

async function getPoCustomer(id) {
    return requireRow('po_customer_records', id);
}

async function updatePoCustomer(id, data, actor) {
    await requireRow('po_customer_records', id);
    const { rows } = await db.query(
        `UPDATE po_customer_records SET
            po_customer_number     = COALESCE($2, po_customer_number),
            customer_id            = COALESCE($3, customer_id),
            version                = COALESCE($4, version),
            order_date             = COALESCE($5, order_date),
            quotation_reference_id = COALESCE($6, quotation_reference_id),
            payment_term_condition = COALESCE($7, payment_term_condition),
            delivery_term          = COALESCE($8, delivery_term),
            term_of_payment        = COALESCE($9, term_of_payment),
            warranty               = COALESCE($10, warranty),
            penalty_clause         = COALESCE($11, penalty_clause),
            bill_to                = COALESCE($12, bill_to),
            ship_to                = COALESCE($13, ship_to),
            currency               = COALESCE($14, currency),
            item_list              = COALESCE($15::jsonb, item_list),
            subtotal               = COALESCE($16, subtotal),
            tax_percent            = COALESCE($17, tax_percent),
            tax_amount             = COALESCE($18, tax_amount),
            total_amount           = COALESCE($19, total_amount),
            notes                  = COALESCE($20, notes),
            updated_by             = $21,
            updated_at             = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.po_customer_number, data.customer_id, data.version,
            data.order_date, data.quotation_reference_id,
            data.payment_term_condition, data.delivery_term, data.term_of_payment,
            data.warranty, data.penalty_clause, data.bill_to, data.ship_to,
            data.currency,
            data.item_list == null ? null : JSON.stringify(data.item_list),
            data.subtotal, data.tax_percent, data.tax_amount, data.total_amount,
            data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

/**
 * Hook called by sales.service.submitSalesPo INSIDE the same transaction.
 * Creates the PO Customer mirror with current_po_status='Registered' and
 * workflow_status='registered'; no notification is fired separately — the
 * Sales PO submission already emits sales.po.registered.
 */
async function createPoCustomerFromSalesPo(client, { salesPoRow, masterPo, actor }) {
    if (!client) throw new Error('createPoCustomerFromSalesPo requires transactional client');

    const recordNumber = await nextRecordNumber(
        client, 'po_customer_records', 'po_customer_record_number',
        FINANCE_PREFIXES.PO_CUSTOMER,
    );

    // Map fields 1:1 from the Sales PO form, then let Finance edit later.
    const { rows } = await client.query(
        `INSERT INTO po_customer_records
           (po_customer_record_number, po_customer_number,
            related_sales_po_id, related_po_id, customer_id,
            order_date, quotation_reference_id,
            payment_term_condition, delivery_term,
            currency, item_list, subtotal, tax_amount, total_amount,
            notes, current_po_status, workflow_status,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,
                 $16,'registered',$17,$17)
         RETURNING *`,
        [
            recordNumber, salesPoRow.po_number,
            salesPoRow.id, masterPo.id, salesPoRow.customer_id,
            salesPoRow.order_date, salesPoRow.related_quotation_id,
            salesPoRow.payment_terms, salesPoRow.delivery_terms,
            salesPoRow.currency, JSON.stringify(salesPoRow.item_list || []),
            salesPoRow.subtotal, salesPoRow.tax_amount, salesPoRow.total_amount,
            salesPoRow.notes, masterPo.current_status,
            actor.id,
        ],
    );
    return rows[0];
}

async function deletePoCustomer(id, actor) {
    const existing = await requireRow('po_customer_records', id);
    if (existing.workflow_status !== 'registered') {
        throw new ConflictError(
            `Cannot delete PO Customer ${existing.po_customer_record_number} in state '${existing.workflow_status}'`,
        );
    }
    await db.query(
        `UPDATE po_customer_records SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// PURCHASE REQUISITION
// ============================================================================

async function listRequisitions({ query, scopeUserId }) {
    return listRows({
        table: 'purchase_requisitions',
        search: query.search,
        searchColumn: 'pr_record_number',
        scopeUserId,
        extraFilters: query.current_pr_status
            ? [{ sql: 'current_pr_status = $X', value: query.current_pr_status }]
            : [],
        query,
    });
}

async function getRequisition(id) {
    return requireRow('purchase_requisitions', id);
}

async function updateRequisition(id, data, actor) {
    const existing = await requireRow('purchase_requisitions', id);
    if (existing.current_pr_status === 'Processed') {
        throw new ConflictError(
            'Processed Purchase Requisitions are immutable; open a corrective record',
        );
    }
    const { rows } = await db.query(
        `UPDATE purchase_requisitions SET
            related_po_customer_id       = COALESCE($2, related_po_customer_id),
            customer_id                  = COALESCE($3, customer_id),
            supplier_or_manufacturer     = COALESCE($4, supplier_or_manufacturer),
            manufacturer_contact_person  = COALESCE($5, manufacturer_contact_person),
            manufacturer_email           = COALESCE($6, manufacturer_email),
            pr_number                    = COALESCE($7, pr_number),
            pr_date                      = COALESCE($8, pr_date),
            currency                     = COALESCE($9, currency),
            item_list                    = COALESCE($10::jsonb, item_list),
            incoterm                     = COALESCE($11, incoterm),
            delivery_time                = COALESCE($12, delivery_time),
            payment_term                 = COALESCE($13, payment_term),
            shipping_address             = COALESCE($14, shipping_address),
            notes                        = COALESCE($15, notes),
            updated_by                   = $16,
            updated_at                   = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.related_po_customer_id, data.customer_id,
            data.supplier_or_manufacturer, data.manufacturer_contact_person,
            data.manufacturer_email, data.pr_number, data.pr_date, data.currency,
            data.item_list == null ? null : JSON.stringify(data.item_list),
            data.incoterm, data.delivery_time, data.payment_term,
            data.shipping_address, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

/**
 * Hook called by sales.service.submitSalesPr. Creates the Finance-side
 * purchase_requisitions row at Registered and emits finance.pr.registered.
 */
async function createRequisitionFromSalesPr(client, { salesPrRow, masterPoId, relatedPoCustomerId, actor }) {
    if (!client) throw new Error('createRequisitionFromSalesPr requires transactional client');

    const recordNumber = await nextRecordNumber(
        client, 'purchase_requisitions', 'pr_record_number',
        FINANCE_PREFIXES.PURCHASE_REQUISITION,
    );

    const { rows } = await client.query(
        `INSERT INTO purchase_requisitions
           (pr_record_number, related_sales_pr_id, related_po_id,
            related_po_customer_id, customer_id,
            supplier_or_manufacturer, manufacturer_contact_person, manufacturer_email,
            pr_number, pr_date, currency, item_list,
            incoterm, delivery_time, payment_term, shipping_address, notes,
            current_pr_status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                 $13,$14,$15,$16,$17,'Registered',$18,$18)
         RETURNING *`,
        [
            recordNumber, salesPrRow.id, masterPoId, relatedPoCustomerId,
            salesPrRow.customer_id,
            salesPrRow.supplier_or_manufacturer, salesPrRow.manufacturer_contact,
            salesPrRow.manufacturer_email,
            salesPrRow.pr_record_number, salesPrRow.pr_date, salesPrRow.currency,
            JSON.stringify(salesPrRow.item_list || []),
            salesPrRow.incoterm, salesPrRow.delivery_time, salesPrRow.payment_terms,
            salesPrRow.shipping_address, salesPrRow.notes,
            actor.id,
        ],
    );
    const requisition = rows[0];

    await notificationService.emit(client, {
        templateKey: 'finance.pr.registered',
        title: `Purchase Requisition ${requisition.pr_record_number} registered`,
        message: `Sales PR ${salesPrRow.pr_record_number} copied to Finance as ${requisition.pr_record_number}.`,
        module: 'finance',
        entityType: 'purchase_requisitions',
        entityId: requisition.id,
        senderUserId: actor.id,
        extraRoles: ['finance'],
    });

    return requisition;
}

/**
 * Process a Purchase Requisition.
 *
 * Trigger conditions (per MOD_finance §FORM 2): po_out_number + po_out_date +
 * po_out_attachment. When all three land we:
 *   1. Persist po_out_number + po_out_date on the PR and bind the attachments.
 *   2. current_pr_status Registered → Processed.
 *   3. Advance master PO Processed → Production. advanceStatus writes the
 *      history row, tracking event, and emits STATUS_TEMPLATE.Production
 *      (finance.po.production). po.service.advanceStatus also syncs
 *      po_customer_records via syncPoCustomerForMasterPo.
 *   4. Emit finance.pr.processed (distinct from the Production-stage template).
 */
async function processRequisition(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM purchase_requisitions
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`purchase_requisitions ${id} not found`);
        }
        const pr = lockRows[0];

        if (pr.current_pr_status === 'Processed') {
            throw new ConflictError(`Purchase Requisition ${pr.pr_record_number} already Processed`);
        }
        if (!pr.related_po_id) {
            throw new BadRequestError(
                `Purchase Requisition ${pr.pr_record_number} has no related master PO`,
            );
        }

        await attachFilesToEntity(
            c, input.attachment_ids, 'finance.purchase_requisitions', pr.id,
        );

        const { rows: updatedRows } = await c.query(
            `UPDATE purchase_requisitions SET
                po_out_number     = $2,
                po_out_date       = $3,
                current_pr_status = 'Processed',
                updated_by        = $4,
                updated_at        = now()
              WHERE id = $1
              RETURNING *`,
            [id, input.po_out_number, input.po_out_date, actor.id],
        );
        const requisition = updatedRows[0];

        const masterPo = await poService.advanceStatus(c, {
            poId: pr.related_po_id,
            newStatus: 'Production',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: input.note || `PO Out ${input.po_out_number} issued to manufacturer`,
        });

        await notificationService.emit(c, {
            templateKey: 'finance.pr.processed',
            title: `Purchase Requisition ${requisition.pr_record_number} processed`,
            message: `Finance issued PO Out ${input.po_out_number} for PR ${requisition.pr_record_number}.`,
            module: 'finance',
            entityType: 'purchase_requisitions',
            entityId: requisition.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'sales', 'superadmin', 'ceo'],
        });

        return { requisition, masterPo };
    });
}

async function deleteRequisition(id, actor) {
    const existing = await requireRow('purchase_requisitions', id);
    if (existing.current_pr_status === 'Processed') {
        throw new ConflictError(
            'Cannot delete a Processed Purchase Requisition; corrective record required',
        );
    }
    await db.query(
        `UPDATE purchase_requisitions SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// INVOICE MANUFACTURE
// ============================================================================

async function listInvoiceManufactures({ query, scopeUserId }) {
    return listRows({
        table: 'invoice_manufactures',
        search: query.search,
        searchColumn: 'invoice_manufacture_record_number',
        scopeUserId,
        extraFilters: query.payment_status
            ? [{ sql: 'payment_status = $X', value: query.payment_status }]
            : [],
        query,
    });
}

async function getInvoiceManufacture(id) {
    const row = await requireRow('invoice_manufactures', id);
    row.attachments = await listAttachmentsForEntity('finance.invoice_manufactures', id);
    return row;
}

async function createInvoiceManufacture(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'invoice_manufactures', 'invoice_manufacture_record_number',
            FINANCE_PREFIXES.INVOICE_MANUFACTURE,
        );

        const { rows } = await c.query(
            `INSERT INTO invoice_manufactures
               (invoice_manufacture_record_number, related_pr_id, related_po_out_number,
                related_po_id, supplier_or_manufacturer,
                invoice_number, invoice_date, due_date, payment_terms,
                preferred_shipping, incoterm, currency, exchange_rate,
                item_list, untaxed_amount, vat_percent, vat_amount, total_amount,
                bank_name, iban_or_account_number, bic_swift,
                transaction_reference, notes, payment_status,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
                     $15,$16,$17,$18,$19,$20,$21,$22,$23,'Unpaid',$24,$24)
             RETURNING *`,
            [
                recordNumber, data.related_pr_id, data.related_po_out_number,
                data.related_po_id, data.supplier_or_manufacturer,
                data.invoice_number, data.invoice_date, data.due_date, data.payment_terms,
                data.preferred_shipping, data.incoterm, data.currency || 'IDR',
                data.exchange_rate,
                JSON.stringify(data.item_list || []),
                data.untaxed_amount, data.vat_percent, data.vat_amount, data.total_amount,
                data.bank_name, data.iban_or_account_number, data.bic_swift,
                data.transaction_reference, data.notes,
                actor.id,
            ],
        );
        const invoice = rows[0];

        // Per MOD_finance §FORM 3 Trigger 1: emit "registered" as soon as an
        // invoice_number is captured. If the row was created without one, the
        // trigger fires on the first update that fills invoice_number.
        if (invoice.invoice_number) {
            await notificationService.emit(c, {
                templateKey: 'finance.invoice_manufacture.registered',
                title: `Invoice Manufacture ${invoice.invoice_manufacture_record_number} registered`,
                message: `Supplier invoice ${invoice.invoice_number} captured (Unpaid).`,
                module: 'finance',
                entityType: 'invoice_manufactures',
                entityId: invoice.id,
                senderUserId: actor.id,
                extraRoles: ['finance'],
            });
        }
        return invoice;
    });
}

async function updateInvoiceManufacture(id, data, actor) {
    return db.withTransaction(async (c) => {
        const existing = await requireRow('invoice_manufactures', id, c);
        if (existing.payment_status === 'Paid') {
            throw new ConflictError(
                'Paid Invoice Manufacture records are immutable',
            );
        }

        const { rows } = await c.query(
            `UPDATE invoice_manufactures SET
                related_pr_id             = COALESCE($2, related_pr_id),
                related_po_out_number     = COALESCE($3, related_po_out_number),
                related_po_id             = COALESCE($4, related_po_id),
                supplier_or_manufacturer  = COALESCE($5, supplier_or_manufacturer),
                invoice_number            = COALESCE($6, invoice_number),
                invoice_date              = COALESCE($7, invoice_date),
                due_date                  = COALESCE($8, due_date),
                payment_terms             = COALESCE($9, payment_terms),
                preferred_shipping        = COALESCE($10, preferred_shipping),
                incoterm                  = COALESCE($11, incoterm),
                currency                  = COALESCE($12, currency),
                exchange_rate             = COALESCE($13, exchange_rate),
                item_list                 = COALESCE($14::jsonb, item_list),
                untaxed_amount            = COALESCE($15, untaxed_amount),
                vat_percent               = COALESCE($16, vat_percent),
                vat_amount                = COALESCE($17, vat_amount),
                total_amount              = COALESCE($18, total_amount),
                bank_name                 = COALESCE($19, bank_name),
                iban_or_account_number    = COALESCE($20, iban_or_account_number),
                bic_swift                 = COALESCE($21, bic_swift),
                transaction_reference     = COALESCE($22, transaction_reference),
                notes                     = COALESCE($23, notes),
                updated_by                = $24,
                updated_at                = now()
              WHERE id = $1 AND deleted_at IS NULL
              RETURNING *`,
            [
                id, data.related_pr_id, data.related_po_out_number, data.related_po_id,
                data.supplier_or_manufacturer,
                data.invoice_number, data.invoice_date, data.due_date, data.payment_terms,
                data.preferred_shipping, data.incoterm, data.currency, data.exchange_rate,
                data.item_list == null ? null : JSON.stringify(data.item_list),
                data.untaxed_amount, data.vat_percent, data.vat_amount, data.total_amount,
                data.bank_name, data.iban_or_account_number, data.bic_swift,
                data.transaction_reference, data.notes,
                actor.id,
            ],
        );
        const invoice = rows[0];

        // Fire the "registered" trigger on the transition null/empty → present.
        const didFillInvoiceNumber =
            !existing.invoice_number && invoice.invoice_number;
        if (didFillInvoiceNumber) {
            await notificationService.emit(c, {
                templateKey: 'finance.invoice_manufacture.registered',
                title: `Invoice Manufacture ${invoice.invoice_manufacture_record_number} registered`,
                message: `Supplier invoice ${invoice.invoice_number} captured (Unpaid).`,
                module: 'finance',
                entityType: 'invoice_manufactures',
                entityId: invoice.id,
                senderUserId: actor.id,
                extraRoles: ['finance'],
            });
        }
        return invoice;
    });
}

/**
 * Record payment of a manufacturer invoice.
 *
 * Trigger (per MOD_finance §FORM 3 Trigger 2): payment_date entered AND
 * payment_attachment uploaded. Sets payment_status=Paid, emits
 * finance.invoice_manufacture.paid. Master PO stage is NOT advanced — payment
 * alone doesn't move the customer-facing lifecycle.
 */
async function recordInvoiceManufacturePayment(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM invoice_manufactures
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`invoice_manufactures ${id} not found`);
        }
        const invoice = lockRows[0];

        if (invoice.payment_status === 'Paid') {
            throw new ConflictError(`Invoice ${invoice.invoice_manufacture_record_number} already Paid`);
        }
        if (!invoice.invoice_number) {
            throw new BadRequestError(
                `Invoice ${invoice.invoice_manufacture_record_number} has no invoice_number; register it first`,
            );
        }

        await attachFilesToEntity(
            c, input.attachment_ids, 'finance.invoice_manufactures', invoice.id,
        );

        const { rows } = await c.query(
            `UPDATE invoice_manufactures SET
                payment_date          = $2,
                payment_amount        = $3,
                transaction_reference = COALESCE($4, transaction_reference),
                payment_status        = 'Paid',
                updated_by            = $5,
                updated_at            = now()
              WHERE id = $1
              RETURNING *`,
            [
                id, input.payment_date, input.payment_amount,
                input.transaction_reference, actor.id,
            ],
        );
        const updated = rows[0];

        await notificationService.emit(c, {
            templateKey: 'finance.invoice_manufacture.paid',
            title: `Invoice Manufacture ${updated.invoice_manufacture_record_number} paid`,
            message: input.note
                || `Payment of ${updated.payment_amount} ${updated.currency} recorded on ${input.payment_date}.`,
            module: 'finance',
            entityType: 'invoice_manufactures',
            entityId: updated.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'superadmin', 'ceo'],
        });

        return updated;
    });
}

async function deleteInvoiceManufacture(id, actor) {
    const existing = await requireRow('invoice_manufactures', id);
    if (existing.payment_status === 'Paid') {
        throw new ConflictError('Paid Invoice Manufacture records cannot be deleted');
    }
    await db.query(
        `UPDATE invoice_manufactures SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// INVOICE CUSTOMER
// ============================================================================

async function listInvoiceCustomers({ query, scopeUserId }) {
    return listRows({
        table: 'invoice_customers',
        search: query.search,
        searchColumn: 'invoice_customer_record_number',
        scopeUserId,
        extraFilters: query.invoice_status
            ? [{ sql: 'invoice_status = $X', value: query.invoice_status }]
            : [],
        query,
    });
}

async function getInvoiceCustomer(id) {
    return requireRow('invoice_customers', id);
}

async function updateInvoiceCustomer(id, data, actor) {
    const existing = await requireRow('invoice_customers', id);
    if (existing.invoice_status === 'Processed') {
        throw new ConflictError(
            'Processed customer invoices are immutable; open a corrective record',
        );
    }

    const { rows } = await db.query(
        `UPDATE invoice_customers SET
            related_po_customer_id  = COALESCE($2, related_po_customer_id),
            related_bast_id         = COALESCE($3, related_bast_id),
            related_do_id           = COALESCE($4, related_do_id),
            related_po_id           = COALESCE($5, related_po_id),
            customer_id             = COALESCE($6, customer_id),
            invoice_date            = COALESCE($7, invoice_date),
            customer_order_number   = COALESCE($8, customer_order_number),
            order_date              = COALESCE($9, order_date),
            currency                = COALESCE($10, currency),
            shipping_method         = COALESCE($11, shipping_method),
            item_list               = COALESCE($12::jsonb, item_list),
            subtotal                = COALESCE($13, subtotal),
            discount_amount         = COALESCE($14, discount_amount),
            tax_base                = COALESCE($15, tax_base),
            vat_percent             = COALESCE($16, vat_percent),
            vat_amount              = COALESCE($17, vat_amount),
            total_amount            = COALESCE($18, total_amount),
            billing_account_info    = COALESCE($19, billing_account_info),
            payment_due_date        = COALESCE($20, payment_due_date),
            notes                   = COALESCE($21, notes),
            updated_by              = $22,
            updated_at              = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.related_po_customer_id, data.related_bast_id, data.related_do_id,
            data.related_po_id, data.customer_id,
            data.invoice_date, data.customer_order_number, data.order_date,
            data.currency, data.shipping_method,
            data.item_list == null ? null : JSON.stringify(data.item_list),
            data.subtotal, data.discount_amount, data.tax_base,
            data.vat_percent, data.vat_amount, data.total_amount,
            data.billing_account_info, data.payment_due_date, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

/**
 * Hook called by Technical BAST upload (future Technical module) INSIDE
 * the same transaction. Creates the Invoice Customer draft at Registered
 * and emits finance.invoice_customer.registered.
 *
 * Expected input payload:
 *   { bastRow, deliveryOrderRow?, masterPoId, poCustomerId, customerId, actor }
 * Any monetary fields are left blank — Finance fills them on /upload-invoice.
 */
async function createInvoiceCustomerDraftFromBast(client, {
    bastRow, deliveryOrderRow = null, masterPoId, poCustomerId,
    customerId, actor,
}) {
    if (!client) throw new Error('createInvoiceCustomerDraftFromBast requires transactional client');

    const recordNumber = await nextRecordNumber(
        client, 'invoice_customers', 'invoice_customer_record_number',
        FINANCE_PREFIXES.INVOICE_CUSTOMER,
    );

    const { rows } = await client.query(
        `INSERT INTO invoice_customers
           (invoice_customer_record_number, related_po_customer_id,
            related_bast_id, related_do_id, related_po_id, customer_id,
            currency, item_list, invoice_status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'Registered',$9,$9)
         RETURNING *`,
        [
            recordNumber, poCustomerId,
            bastRow?.id || null, deliveryOrderRow?.id || null, masterPoId, customerId,
            bastRow?.currency || 'IDR',
            JSON.stringify(bastRow?.item_list || []),
            actor.id,
        ],
    );
    const draft = rows[0];

    await notificationService.emit(client, {
        templateKey: 'finance.invoice_customer.registered',
        title: `Invoice Customer ${draft.invoice_customer_record_number} draft ready`,
        message: `Technical uploaded BAST; Finance invoice draft ${draft.invoice_customer_record_number} created.`,
        module: 'finance',
        entityType: 'invoice_customers',
        entityId: draft.id,
        senderUserId: actor.id,
        extraRoles: ['finance'],
    });

    return draft;
}

/**
 * Issue a customer invoice.
 *
 * Trigger (per MOD_finance §FORM 4): invoice_attachment uploaded +
 * invoice_number entered. When both land we:
 *   1. Persist invoice_number (+ optional invoice_date) and bind attachments.
 *   2. invoice_status Registered → Processed.
 *   3. Advance master PO → Invoice. advanceStatus emits STATUS_TEMPLATE.Invoice
 *      (finance.po.invoice) and syncs po_customer_records.
 *   4. Emit finance.invoice_customer.processed on top.
 */
async function issueInvoiceCustomer(id, input, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM invoice_customers
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`invoice_customers ${id} not found`);
        const invoice = lockRows[0];

        if (invoice.invoice_status === 'Processed') {
            throw new ConflictError(
                `Invoice Customer ${invoice.invoice_customer_record_number} already Processed`,
            );
        }
        if (!invoice.related_po_id) {
            throw new BadRequestError(
                `Invoice Customer ${invoice.invoice_customer_record_number} has no related master PO`,
            );
        }

        await attachFilesToEntity(
            c, input.attachment_ids, 'finance.invoice_customers', invoice.id,
        );

        const { rows: updRows } = await c.query(
            `UPDATE invoice_customers SET
                invoice_number  = $2,
                invoice_date    = COALESCE($3, invoice_date, now()::date),
                invoice_status  = 'Processed',
                updated_by      = $4,
                updated_at      = now()
              WHERE id = $1
              RETURNING *`,
            [id, input.invoice_number, input.invoice_date || null, actor.id],
        );
        const updated = updRows[0];

        const masterPo = await poService.advanceStatus(c, {
            poId: invoice.related_po_id,
            newStatus: 'Invoice',
            actorUserId: actor.id,
            actorRole: actor.role,
            note: input.note || `Customer invoice ${input.invoice_number} issued`,
        });

        await notificationService.emit(c, {
            templateKey: 'finance.invoice_customer.processed',
            title: `Invoice Customer ${updated.invoice_customer_record_number} processed`,
            message: `Customer invoice ${input.invoice_number} issued.`,
            module: 'finance',
            entityType: 'invoice_customers',
            entityId: updated.id,
            senderUserId: actor.id,
            extraRoles: ['finance', 'superadmin', 'ceo', 'sales'],
        });

        return { invoice: updated, masterPo };
    });
}

async function deleteInvoiceCustomer(id, actor) {
    const existing = await requireRow('invoice_customers', id);
    if (existing.invoice_status === 'Processed') {
        throw new ConflictError('Processed customer invoices cannot be deleted');
    }
    await db.query(
        `UPDATE invoice_customers SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

module.exports = {
    FINANCE_PREFIXES,

    // PO Customer
    listPoCustomers, getPoCustomer, updatePoCustomer,
    createPoCustomerFromSalesPo, deletePoCustomer,

    // Purchase Requisition
    listRequisitions, getRequisition, updateRequisition,
    createRequisitionFromSalesPr, processRequisition, deleteRequisition,

    // Invoice Manufacture
    listInvoiceManufactures, getInvoiceManufacture,
    createInvoiceManufacture, updateInvoiceManufacture,
    recordInvoiceManufacturePayment, deleteInvoiceManufacture,

    // Invoice Customer
    listInvoiceCustomers, getInvoiceCustomer, updateInvoiceCustomer,
    createInvoiceCustomerDraftFromBast, issueInvoiceCustomer,
    deleteInvoiceCustomer,
};
