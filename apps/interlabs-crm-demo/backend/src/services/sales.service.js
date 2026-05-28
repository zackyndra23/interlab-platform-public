'use strict';

const db = require('../config/database');
const poService = require('./po.service');
const financeService = require('./finance.service');
const { nextRecordNumber, SALES_PREFIXES } = require('../utils/recordNumbers');
const { addWorkingDays } = require('../utils/workingDays');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { listAttachmentsForEntity } = require('../utils/attachments');
const {
    NotFoundError, BadRequestError, ConflictError,
} = require('../utils/errors');

// Every Sales form carries the same SLA instrumentation per MOD_sales.txt:
//   workflow_status, current_step, step_due_at, step_status, last_progress_at
// When a form moves to 'submitted' (or a sub-state that resets progress), the
// service recomputes step_due_at = now + 2 working days and writes
// last_progress_at = now. The sla_sales_form_monitor background job flips
// step_status → 'overdue' when step_due_at passes without progress.

const SALES_FORM_SLA_DAYS = 2;

function computeStepDueAt(anchor = new Date(), days = SALES_FORM_SLA_DAYS) {
    return addWorkingDays(new Date(anchor.getTime()), days);
}

// Shared listing helper — applies LIKE filter on a search column, role-owned
// scoping (view_own = created_by = userId), pagination, and soft-delete hide.
async function listRows({
    table,
    selectColumns = '*',
    search,
    searchColumn,
    scopeUserId,       // null = view_global
    extraFilters = [], // [{ sql: 'status = $X', value }]
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
    const countRes = await db.query(`SELECT count(*)::int AS c FROM ${table} WHERE ${where}`, params);
    const total = countRes.rows[0].c;

    params.push(limit);
    params.push(offset);
    const sql = `
        SELECT ${selectColumns}
          FROM ${table}
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await db.query(sql, params);

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

// ============================================================================
// CUSTOMERS
// ============================================================================

async function listCustomers({ query, scopeUserId }) {
    return listRows({
        table: 'customers',
        search: query.search,
        searchColumn: 'company_name',
        scopeUserId,
        extraFilters: query.status
            ? [{ sql: 'customer_status = $X', value: query.status }]
            : [],
        query,
    });
}

async function getCustomer(id) {
    return requireRow('customers', id);
}

async function createCustomer(data, actor) {
    return db.withTransaction(async (c) => {
        const recordNumber = await nextRecordNumber(
            c, 'customers', 'customer_record_number', SALES_PREFIXES.CUSTOMER,
        );
        const { rows } = await c.query(
            `INSERT INTO customers
               (customer_record_number, company_name, trade_name, address, city,
                country, phone, email, website, npwp,
                pic_name, pic_phone, pic_email, customer_status, notes,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
             RETURNING *`,
            [
                recordNumber, data.company_name, data.trade_name, data.address, data.city,
                data.country, data.phone, data.email, data.website, data.npwp,
                data.pic_name, data.pic_phone, data.pic_email,
                data.customer_status || 'Active', data.notes,
                actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateCustomer(id, data, actor) {
    await requireRow('customers', id);
    const { rows } = await db.query(
        `UPDATE customers SET
            company_name     = COALESCE($2, company_name),
            trade_name       = COALESCE($3, trade_name),
            address          = COALESCE($4, address),
            city             = COALESCE($5, city),
            country          = COALESCE($6, country),
            phone            = COALESCE($7, phone),
            email            = COALESCE($8, email),
            website          = COALESCE($9, website),
            npwp             = COALESCE($10, npwp),
            pic_name         = COALESCE($11, pic_name),
            pic_phone        = COALESCE($12, pic_phone),
            pic_email        = COALESCE($13, pic_email),
            customer_status  = COALESCE($14, customer_status),
            notes            = COALESCE($15, notes),
            updated_by       = $16,
            updated_at       = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.company_name, data.trade_name, data.address, data.city,
            data.country, data.phone, data.email, data.website, data.npwp,
            data.pic_name, data.pic_phone, data.pic_email, data.customer_status, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

async function deleteCustomer(id, actor) {
    await requireRow('customers', id);
    await db.query(
        `UPDATE customers SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// SALES FORECASTS
// ============================================================================

async function listForecasts({ query, scopeUserId }) {
    return listRows({
        table: 'sales_forecasts',
        search: query.search,
        searchColumn: 'product_or_service_name',
        scopeUserId,
        extraFilters: query.stage ? [{ sql: 'stage = $X', value: query.stage }] : [],
        query,
    });
}

async function getForecast(id) {
    return requireRow('sales_forecasts', id);
}

async function createForecast(data, actor) {
    return db.withTransaction(async (c) => {
        const rn = await nextRecordNumber(
            c, 'sales_forecasts', 'forecast_record_number', SALES_PREFIXES.FORECAST,
        );
        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `INSERT INTO sales_forecasts
               (forecast_record_number, customer_id, product_or_service_name, description,
                forecast_period_start, forecast_period_end, currency, estimated_value,
                probability_percent, stage, expected_close_date, pic_user_id, notes,
                workflow_status, current_step, step_due_at, step_status, last_progress_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                     $14,$15,$16,'on_track',now(),$17,$17)
             RETURNING *`,
            [
                rn, data.customer_id, data.product_or_service_name, data.description,
                data.forecast_period_start, data.forecast_period_end,
                data.currency || 'IDR', data.estimated_value, data.probability_percent,
                data.stage || 'Prospect', data.expected_close_date, data.pic_user_id, data.notes,
                data.workflow_status || 'draft', data.current_step || 'draft', stepDueAt,
                actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateForecast(id, data, actor) {
    await requireRow('sales_forecasts', id);
    const { rows } = await db.query(
        `UPDATE sales_forecasts SET
            customer_id              = COALESCE($2, customer_id),
            product_or_service_name  = COALESCE($3, product_or_service_name),
            description              = COALESCE($4, description),
            forecast_period_start    = COALESCE($5, forecast_period_start),
            forecast_period_end      = COALESCE($6, forecast_period_end),
            currency                 = COALESCE($7, currency),
            estimated_value          = COALESCE($8, estimated_value),
            probability_percent      = COALESCE($9, probability_percent),
            stage                    = COALESCE($10, stage),
            expected_close_date      = COALESCE($11, expected_close_date),
            pic_user_id              = COALESCE($12, pic_user_id),
            notes                    = COALESCE($13, notes),
            updated_by               = $14,
            updated_at               = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.customer_id, data.product_or_service_name, data.description,
            data.forecast_period_start, data.forecast_period_end,
            data.currency, data.estimated_value, data.probability_percent,
            data.stage, data.expected_close_date, data.pic_user_id, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

async function submitForecast(id, actor) {
    await requireRow('sales_forecasts', id);
    const stepDueAt = computeStepDueAt();
    const { rows } = await db.query(
        `UPDATE sales_forecasts SET
            workflow_status   = 'submitted',
            current_step      = 'submitted',
            step_due_at       = $2,
            step_status       = 'on_track',
            last_progress_at  = now(),
            updated_by        = $3,
            updated_at        = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id, stepDueAt, actor.id],
    );
    return rows[0];
}

async function deleteForecast(id, actor) {
    await requireRow('sales_forecasts', id);
    await db.query(
        `UPDATE sales_forecasts SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// QUOTATIONS
// ============================================================================

async function listQuotations({ query, scopeUserId }) {
    return listRows({
        table: 'quotations',
        search: query.search,
        searchColumn: 'quotation_number',
        scopeUserId,
        extraFilters: query.workflow_status
            ? [{ sql: 'workflow_status = $X', value: query.workflow_status }]
            : [],
        query,
    });
}

async function getQuotation(id) {
    return requireRow('quotations', id);
}

async function createQuotation(data, actor) {
    return db.withTransaction(async (c) => {
        const rn = await nextRecordNumber(
            c, 'quotations', 'quotation_record_number', SALES_PREFIXES.QUOTATION,
        );
        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `INSERT INTO quotations
               (quotation_record_number, quotation_number, customer_id, related_forecast_id,
                quotation_date, validity_date, currency, item_list,
                subtotal, discount_percent, discount_amount, tax_percent, tax_amount,
                total_amount, payment_terms, delivery_terms, warranty_terms, notes,
                workflow_status, current_step, step_due_at, step_status, last_progress_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,
                     $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                     $19,$20,$21,'on_track',now(),$22,$22)
             RETURNING *`,
            [
                rn, data.quotation_number, data.customer_id, data.related_forecast_id,
                data.quotation_date, data.validity_date,
                data.currency || 'IDR', JSON.stringify(data.item_list || []),
                data.subtotal, data.discount_percent, data.discount_amount,
                data.tax_percent, data.tax_amount, data.total_amount,
                data.payment_terms, data.delivery_terms, data.warranty_terms, data.notes,
                data.workflow_status || 'draft', data.current_step || 'draft', stepDueAt,
                actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateQuotation(id, data, actor) {
    await requireRow('quotations', id);
    const { rows } = await db.query(
        `UPDATE quotations SET
            quotation_number    = COALESCE($2, quotation_number),
            customer_id         = COALESCE($3, customer_id),
            related_forecast_id = COALESCE($4, related_forecast_id),
            quotation_date      = COALESCE($5, quotation_date),
            validity_date       = COALESCE($6, validity_date),
            currency            = COALESCE($7, currency),
            item_list           = COALESCE($8::jsonb, item_list),
            subtotal            = COALESCE($9, subtotal),
            discount_percent    = COALESCE($10, discount_percent),
            discount_amount     = COALESCE($11, discount_amount),
            tax_percent         = COALESCE($12, tax_percent),
            tax_amount          = COALESCE($13, tax_amount),
            total_amount        = COALESCE($14, total_amount),
            payment_terms       = COALESCE($15, payment_terms),
            delivery_terms      = COALESCE($16, delivery_terms),
            warranty_terms      = COALESCE($17, warranty_terms),
            notes               = COALESCE($18, notes),
            updated_by          = $19,
            updated_at          = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.quotation_number, data.customer_id, data.related_forecast_id,
            data.quotation_date, data.validity_date, data.currency,
            data.item_list === undefined ? null : JSON.stringify(data.item_list),
            data.subtotal, data.discount_percent, data.discount_amount,
            data.tax_percent, data.tax_amount, data.total_amount,
            data.payment_terms, data.delivery_terms, data.warranty_terms, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

async function transitionQuotation(id, target, actor) {
    const allowed = ['submitted', 'revised', 'accepted', 'rejected'];
    if (!allowed.includes(target)) {
        throw new BadRequestError(`Invalid quotation workflow_status: ${target}`);
    }
    await requireRow('quotations', id);
    const stepDueAt = computeStepDueAt();
    const { rows } = await db.query(
        `UPDATE quotations SET
            workflow_status   = $2,
            current_step      = $2,
            step_due_at       = $3,
            step_status       = 'on_track',
            last_progress_at  = now(),
            updated_by        = $4,
            updated_at        = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id, target, stepDueAt, actor.id],
    );
    return rows[0];
}

async function deleteQuotation(id, actor) {
    await requireRow('quotations', id);
    await db.query(
        `UPDATE quotations SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// HARGA POKOK PENJUALAN (HPP)
// ============================================================================

async function listHpp({ query, scopeUserId }) {
    return listRows({
        table: 'harga_pokok_penjualan',
        search: query.search,
        searchColumn: 'hpp_record_number',
        scopeUserId,
        extraFilters: query.workflow_status
            ? [{ sql: 'workflow_status = $X', value: query.workflow_status }]
            : [],
        query,
    });
}

async function getHpp(id) {
    return requireRow('harga_pokok_penjualan', id);
}

async function createHpp(data, actor) {
    return db.withTransaction(async (c) => {
        const rn = await nextRecordNumber(
            c, 'harga_pokok_penjualan', 'hpp_record_number', SALES_PREFIXES.HPP,
        );
        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `INSERT INTO harga_pokok_penjualan
               (hpp_record_number, customer_id, related_quotation_id, hpp_date, currency,
                item_list, total_cost, total_selling_price, gross_margin_total, notes,
                workflow_status, current_step, step_due_at, step_status, last_progress_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,
                     $11,$12,$13,'on_track',now(),$14,$14)
             RETURNING *`,
            [
                rn, data.customer_id, data.related_quotation_id, data.hpp_date,
                data.currency || 'IDR', JSON.stringify(data.item_list || []),
                data.total_cost, data.total_selling_price, data.gross_margin_total, data.notes,
                data.workflow_status || 'draft', data.current_step || 'draft', stepDueAt,
                actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateHpp(id, data, actor) {
    await requireRow('harga_pokok_penjualan', id);
    const { rows } = await db.query(
        `UPDATE harga_pokok_penjualan SET
            customer_id          = COALESCE($2, customer_id),
            related_quotation_id = COALESCE($3, related_quotation_id),
            hpp_date             = COALESCE($4, hpp_date),
            currency             = COALESCE($5, currency),
            item_list            = COALESCE($6::jsonb, item_list),
            total_cost           = COALESCE($7, total_cost),
            total_selling_price  = COALESCE($8, total_selling_price),
            gross_margin_total   = COALESCE($9, gross_margin_total),
            notes                = COALESCE($10, notes),
            updated_by           = $11,
            updated_at           = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.customer_id, data.related_quotation_id, data.hpp_date, data.currency,
            data.item_list === undefined ? null : JSON.stringify(data.item_list),
            data.total_cost, data.total_selling_price, data.gross_margin_total, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

async function transitionHpp(id, target, actor) {
    const allowed = ['submitted', 'approved'];
    if (!allowed.includes(target)) {
        throw new BadRequestError(`Invalid HPP workflow_status: ${target}`);
    }
    await requireRow('harga_pokok_penjualan', id);
    const stepDueAt = computeStepDueAt();
    const { rows } = await db.query(
        `UPDATE harga_pokok_penjualan SET
            workflow_status   = $2,
            current_step      = $2,
            step_due_at       = $3,
            step_status       = 'on_track',
            last_progress_at  = now(),
            updated_by        = $4,
            updated_at        = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [id, target, stepDueAt, actor.id],
    );
    return rows[0];
}

async function deleteHpp(id, actor) {
    await requireRow('harga_pokok_penjualan', id);
    await db.query(
        `UPDATE harga_pokok_penjualan SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// SALES PURCHASE ORDER
//   draft → submitted (creates master PO, status=Registered)
//         → processed (advances master PO to Processed)
//   overdue handled by SLA monitor job + submitOverdueReason()
// ============================================================================

async function listSalesPo({ query, scopeUserId }) {
    return listRows({
        table: 'sales_purchase_orders',
        search: query.search,
        searchColumn: 'po_record_number',
        scopeUserId,
        extraFilters: query.workflow_status
            ? [{ sql: 'workflow_status = $X', value: query.workflow_status }]
            : [],
        query,
    });
}

async function getSalesPo(id) {
    const row = await requireRow('sales_purchase_orders', id);
    row.attachments = await listAttachmentsForEntity('sales.purchase_orders', id);
    return row;
}

async function createSalesPo(data, actor) {
    return db.withTransaction(async (c) => {
        const rn = await nextRecordNumber(
            c, 'sales_purchase_orders', 'po_record_number', SALES_PREFIXES.PO,
        );
        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `INSERT INTO sales_purchase_orders
               (po_record_number, po_number, customer_id, related_quotation_id,
                order_date, delivery_deadline, currency, payment_terms, delivery_terms,
                item_list, subtotal, tax_amount, total_amount, notes,
                workflow_status, current_step, step_due_at, step_status, last_progress_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                     $10::jsonb,$11,$12,$13,$14,
                     'draft',$15,$16,'on_track',now(),$17,$17)
             RETURNING *`,
            [
                rn, data.po_number, data.customer_id, data.related_quotation_id,
                data.order_date, data.delivery_deadline,
                data.currency || 'IDR', data.payment_terms, data.delivery_terms,
                JSON.stringify(data.item_list || []), data.subtotal, data.tax_amount,
                data.total_amount, data.notes,
                data.current_step || 'draft', stepDueAt, actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateSalesPo(id, data, actor) {
    const existing = await requireRow('sales_purchase_orders', id);
    if (existing.workflow_status === 'processed') {
        throw new ConflictError('Processed Sales POs are immutable; open a corrective record.');
    }
    const { rows } = await db.query(
        `UPDATE sales_purchase_orders SET
            po_number            = COALESCE($2, po_number),
            customer_id          = COALESCE($3, customer_id),
            related_quotation_id = COALESCE($4, related_quotation_id),
            order_date           = COALESCE($5, order_date),
            delivery_deadline    = COALESCE($6, delivery_deadline),
            currency             = COALESCE($7, currency),
            payment_terms        = COALESCE($8, payment_terms),
            delivery_terms       = COALESCE($9, delivery_terms),
            item_list            = COALESCE($10::jsonb, item_list),
            subtotal             = COALESCE($11, subtotal),
            tax_amount           = COALESCE($12, tax_amount),
            total_amount         = COALESCE($13, total_amount),
            notes                = COALESCE($14, notes),
            updated_by           = $15,
            updated_at           = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.po_number, data.customer_id, data.related_quotation_id,
            data.order_date, data.delivery_deadline, data.currency,
            data.payment_terms, data.delivery_terms,
            data.item_list === undefined ? null : JSON.stringify(data.item_list),
            data.subtotal, data.tax_amount, data.total_amount, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

/**
 * Submit a Sales PO — the first write that initializes the master PO lifecycle.
 *
 * Steps (all in a single DB transaction):
 *   1. Lock the draft row (FOR UPDATE).
 *   2. Resolve the master po_number: prefer the customer-supplied po_number;
 *      fall back to po_record_number if absent.
 *   3. poService.initializeFromSales() — writes purchase_orders (status=Registered),
 *      purchase_order_status_history, purchase_order_tracking_events, and
 *      emits sales.po.registered.
 *   4. Back-fill sales_purchase_orders.po_id + reset SLA window (step_due_at =
 *      now + 2 working days) and flip workflow_status → 'submitted'.
 */
async function submitSalesPo(id, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM sales_purchase_orders
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`sales_purchase_orders ${id} not found`);
        const row = lockRows[0];

        if (row.workflow_status !== 'draft' && row.workflow_status !== 'overdue') {
            throw new ConflictError(
                `Sales PO ${row.po_record_number} cannot be submitted from state '${row.workflow_status}'`,
            );
        }

        const masterPoNumber = row.po_number || row.po_record_number;

        const masterPo = await poService.initializeFromSales(c, {
            poNumber:    masterPoNumber,
            customerId:  row.customer_id,
            dueAt:       row.delivery_deadline,
            actorUserId: actor.id,
            actorRole:   actor.role,
            note:        `Sales PO ${row.po_record_number} submitted`,
        });

        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `UPDATE sales_purchase_orders SET
                po_number         = $2,
                po_id             = $3,
                workflow_status   = 'submitted',
                current_step      = 'Registered',
                step_due_at       = $4,
                step_status       = 'on_track',
                last_progress_at  = now(),
                updated_by        = $5,
                updated_at        = now()
              WHERE id = $1
              RETURNING *`,
            [id, masterPoNumber, masterPo.id, stepDueAt, actor.id],
        );

        // Finance-side mirror per MOD_finance §FORM 1: PO Customer is
        // auto-created on Sales PO submission at workflow_status='registered'.
        const poCustomer = await financeService.createPoCustomerFromSalesPo(c, {
            salesPoRow: rows[0], masterPo, actor,
        });

        return { salesPo: rows[0], masterPo, poCustomer };
    });
}

/**
 * Mark a submitted Sales PO as Processed. Advances the master PO to Processed
 * (which fires sales.po.processed via po.service) and resets the SLA window.
 */
async function processSalesPo(id, actor, { note = null } = {}) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM sales_purchase_orders
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) throw new NotFoundError(`sales_purchase_orders ${id} not found`);
        const row = lockRows[0];

        if (row.workflow_status !== 'submitted' && row.workflow_status !== 'overdue') {
            throw new ConflictError(
                `Sales PO ${row.po_record_number} cannot be processed from state '${row.workflow_status}'`,
            );
        }
        if (!row.po_id) {
            throw new BadRequestError(
                `Sales PO ${row.po_record_number} has no master PO; submit it first`,
            );
        }

        const masterPo = await poService.advanceStatus(c, {
            poId: row.po_id,
            newStatus: 'Processed',
            actorUserId: actor.id,
            actorRole: actor.role,
            note,
        });

        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `UPDATE sales_purchase_orders SET
                workflow_status   = 'processed',
                current_step      = 'Processed',
                step_due_at       = $2,
                step_status       = 'on_track',
                last_progress_at  = now(),
                updated_by        = $3,
                updated_at        = now()
              WHERE id = $1
              RETURNING *`,
            [id, stepDueAt, actor.id],
        );
        return { salesPo: rows[0], masterPo };
    });
}

/**
 * Submit the overdue_reason (and optional attachment) a user enters when
 * returning to an overdue Sales PO. Writes the reason to BOTH the sales form
 * row and the master PO, flips step_status back to on_track for the running
 * stage, and emits sales.po.delay_justified.
 */
async function submitOverdueReason(id, { reason, attachmentId = null }, actor) {
    if (!reason) throw new BadRequestError('overdue_reason is required');

    return db.withTransaction(async (c) => {
        const row = await requireRow('sales_purchase_orders', id, c);
        const { rows } = await c.query(
            `UPDATE sales_purchase_orders SET
                overdue_reason        = $2,
                overdue_attachment_id = COALESCE($3, overdue_attachment_id),
                step_status           = 'on_track',
                last_progress_at      = now(),
                updated_by            = $4,
                updated_at            = now()
              WHERE id = $1
              RETURNING *`,
            [id, reason, attachmentId, actor.id],
        );

        if (row.po_id) {
            await poService.flagOverdue(c, {
                poId: row.po_id,
                reason,
                attachmentId,
                actorUserId: actor.id,
                actorRole: actor.role,
                templateKey: 'sales.po.delay_justified',
                title: `PO ${row.po_number || row.po_record_number} delay justified`,
            });
        }

        return rows[0];
    });
}

async function deleteSalesPo(id, actor) {
    const existing = await requireRow('sales_purchase_orders', id);
    if (existing.po_id) {
        throw new ConflictError(
            'Sales PO already initialized master PO lifecycle; cannot be deleted',
        );
    }
    await db.query(
        `UPDATE sales_purchase_orders SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

// ============================================================================
// PURCHASE REQUEST (Sales-Initiated)
//   On submit → creates corresponding purchase_requisitions row in Finance
//   (status=Registered) and emits sales.pr.submitted → Finance.
// ============================================================================

async function listSalesPr({ query, scopeUserId }) {
    return listRows({
        table: 'purchase_requests_sales',
        search: query.search,
        searchColumn: 'pr_record_number',
        scopeUserId,
        extraFilters: query.workflow_status
            ? [{ sql: 'workflow_status = $X', value: query.workflow_status }]
            : [],
        query,
    });
}

async function getSalesPr(id) {
    return requireRow('purchase_requests_sales', id);
}

async function createSalesPr(data, actor) {
    return db.withTransaction(async (c) => {
        const rn = await nextRecordNumber(
            c, 'purchase_requests_sales', 'pr_record_number', SALES_PREFIXES.PR,
        );
        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `INSERT INTO purchase_requests_sales
               (pr_record_number, related_po_id, customer_id,
                supplier_or_manufacturer, manufacturer_contact, manufacturer_email,
                pr_date, currency, item_list, incoterm, delivery_time,
                payment_terms, shipping_address, notes,
                workflow_status, current_step, step_due_at, step_status, last_progress_at,
                created_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,
                     'draft',$15,$16,'on_track',now(),$17,$17)
             RETURNING *`,
            [
                rn, data.related_po_id, data.customer_id,
                data.supplier_or_manufacturer, data.manufacturer_contact, data.manufacturer_email,
                data.pr_date, data.currency || 'IDR', JSON.stringify(data.item_list || []),
                data.incoterm, data.delivery_time, data.payment_terms, data.shipping_address,
                data.notes, data.current_step || 'draft', stepDueAt, actor.id,
            ],
        );
        return rows[0];
    });
}

async function updateSalesPr(id, data, actor) {
    const existing = await requireRow('purchase_requests_sales', id);
    if (existing.workflow_status === 'copied_to_finance') {
        throw new ConflictError(
            'PR has been copied to Finance and is immutable from Sales side',
        );
    }
    const { rows } = await db.query(
        `UPDATE purchase_requests_sales SET
            related_po_id              = COALESCE($2, related_po_id),
            customer_id                = COALESCE($3, customer_id),
            supplier_or_manufacturer   = COALESCE($4, supplier_or_manufacturer),
            manufacturer_contact       = COALESCE($5, manufacturer_contact),
            manufacturer_email         = COALESCE($6, manufacturer_email),
            pr_date                    = COALESCE($7, pr_date),
            currency                   = COALESCE($8, currency),
            item_list                  = COALESCE($9::jsonb, item_list),
            incoterm                   = COALESCE($10, incoterm),
            delivery_time              = COALESCE($11, delivery_time),
            payment_terms              = COALESCE($12, payment_terms),
            shipping_address           = COALESCE($13, shipping_address),
            notes                      = COALESCE($14, notes),
            updated_by                 = $15,
            updated_at                 = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *`,
        [
            id, data.related_po_id, data.customer_id,
            data.supplier_or_manufacturer, data.manufacturer_contact, data.manufacturer_email,
            data.pr_date, data.currency,
            data.item_list === undefined ? null : JSON.stringify(data.item_list),
            data.incoterm, data.delivery_time, data.payment_terms, data.shipping_address, data.notes,
            actor.id,
        ],
    );
    return rows[0];
}

/**
 * Submit the Sales PR → copy to Finance.
 *   1. Resolve the related master purchase_orders.id and po_customer_records.id
 *      via sales_purchase_orders.po_id (if the Sales PO has already been submitted).
 *   2. Delegate Finance-side row creation to financeService.createRequisitionFromSalesPr,
 *      which generates the PRC record number, inserts purchase_requisitions at
 *      current_pr_status='Registered', and emits finance.pr.registered.
 *   3. Flip the Sales PR to workflow_status='copied_to_finance' + reset SLA.
 */
async function submitSalesPr(id, actor) {
    return db.withTransaction(async (c) => {
        const { rows: lockRows } = await c.query(
            `SELECT * FROM purchase_requests_sales
              WHERE id = $1 AND deleted_at IS NULL
              FOR UPDATE`,
            [id],
        );
        if (lockRows.length === 0) {
            throw new NotFoundError(`purchase_requests_sales ${id} not found`);
        }
        const pr = lockRows[0];

        if (pr.workflow_status !== 'draft' && pr.workflow_status !== 'submitted') {
            throw new ConflictError(
                `Sales PR ${pr.pr_record_number} cannot be re-submitted from '${pr.workflow_status}'`,
            );
        }

        // Resolve master PO + Finance PO Customer (both exist only if the
        // related sales PO has already been submitted).
        let relatedMasterPoId = null;
        let relatedPoCustomerId = null;
        if (pr.related_po_id) {
            const { rows } = await c.query(
                `SELECT sp.po_id            AS master_po_id,
                        poc.id              AS po_customer_id
                   FROM sales_purchase_orders sp
                   LEFT JOIN po_customer_records poc
                          ON poc.related_sales_po_id = sp.id
                         AND poc.deleted_at IS NULL
                  WHERE sp.id = $1`,
                [pr.related_po_id],
            );
            relatedMasterPoId = rows[0]?.master_po_id || null;
            relatedPoCustomerId = rows[0]?.po_customer_id || null;
        }

        const financeRequisition = await financeService.createRequisitionFromSalesPr(c, {
            salesPrRow: pr,
            masterPoId: relatedMasterPoId,
            relatedPoCustomerId,
            actor,
        });

        const stepDueAt = computeStepDueAt();
        const { rows } = await c.query(
            `UPDATE purchase_requests_sales SET
                workflow_status   = 'copied_to_finance',
                current_step      = 'copied_to_finance',
                step_due_at       = $2,
                step_status       = 'on_track',
                last_progress_at  = now(),
                updated_by        = $3,
                updated_at        = now()
              WHERE id = $1
              RETURNING *`,
            [id, stepDueAt, actor.id],
        );

        return { salesPr: rows[0], financeRequisition };
    });
}

async function deleteSalesPr(id, actor) {
    const existing = await requireRow('purchase_requests_sales', id);
    if (existing.workflow_status === 'copied_to_finance') {
        throw new ConflictError('PR has been copied to Finance and cannot be deleted');
    }
    await db.query(
        `UPDATE purchase_requests_sales SET deleted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [id, actor.id],
    );
}

module.exports = {
    // utility
    computeStepDueAt,
    // customers
    listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
    // forecasts
    listForecasts, getForecast, createForecast, updateForecast,
    submitForecast, deleteForecast,
    // quotations
    listQuotations, getQuotation, createQuotation, updateQuotation,
    transitionQuotation, deleteQuotation,
    // HPP
    listHpp, getHpp, createHpp, updateHpp, transitionHpp, deleteHpp,
    // sales PO
    listSalesPo, getSalesPo, createSalesPo, updateSalesPo,
    submitSalesPo, processSalesPo, submitOverdueReason, deleteSalesPo,
    // sales PR
    listSalesPr, getSalesPr, createSalesPr, updateSalesPr,
    submitSalesPr, deleteSalesPr,
};
