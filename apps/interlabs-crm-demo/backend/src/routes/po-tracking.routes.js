'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const db = require('../config/database');
const { success, error } = require('../utils/response');
const { buildMeta } = require('../utils/pagination');
router.use(authMiddleware);

const PO_COLS = `p.id, p.po_number, p.current_status, p.customer_id, cu.company_name AS customer_name,
  p.created_by_user_id, p.created_by_role, p.due_at, p.overdue_at, p.overdue_reason, p.escalation_sent_at, p.created_at, p.updated_at`;
const HIST_COLS = `h.id, h.po_id, h.po_number, h.status_code, h.status_label, h.updated_by_user_id, h.updated_by_role,
  u.display_name AS updated_by_name, h.note, h.reason_if_delayed, h.attachment_url, h.created_at`;

router.get('/',
  validate({ query: Joi.object({ search: Joi.string().allow('').optional(), status: Joi.string().optional(),
             page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(25) }) }),
  async (req, res, next) => {
    try {
      const page = Number(req.query.page)||1, limit = Number(req.query.limit)||25, offset = (page-1)*limit;
      const where = ['p.deleted_at IS NULL']; const params = [];
      if (req.query.search) { params.push(`%${req.query.search}%`); where.push(`p.po_number ILIKE $${params.length}`); }
      if (req.query.status) { params.push(req.query.status); where.push(`p.current_status = $${params.length}`); }
      const total = (await db.query(`SELECT count(*)::int n FROM purchase_orders p WHERE ${where.join(' AND ')}`, params)).rows[0].n;
      params.push(limit); params.push(offset);
      const r = await db.query(`SELECT ${PO_COLS} FROM purchase_orders p LEFT JOIN customers cu ON cu.id=p.customer_id
        WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
      res.json(success(r.rows, buildMeta(total, page, limit)));
    } catch (e) { next(e); }
  });

router.get('/search',
  validate({ query: Joi.object({ po_number: Joi.string().required() }) }),
  async (req, res, next) => {
    try {
      const po = (await db.query(`SELECT ${PO_COLS} FROM purchase_orders p LEFT JOIN customers cu ON cu.id=p.customer_id
        WHERE p.po_number=$1 AND p.deleted_at IS NULL`, [req.query.po_number])).rows[0];
      if (!po) return res.status(404).json(error('PO not found', 'not_found'));
      const history = (await db.query(`SELECT ${HIST_COLS} FROM purchase_order_status_history h
        LEFT JOIN users u ON u.id=h.updated_by_user_id WHERE h.po_id=$1 ORDER BY h.created_at DESC LIMIT 3`, [po.id])).rows;
      res.json(success({ po, history }));
    } catch (e) { next(e); }
  });

router.get('/:id/history',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  async (req, res, next) => {
    try {
      const r = await db.query(`SELECT ${HIST_COLS} FROM purchase_order_status_history h
        LEFT JOIN users u ON u.id=h.updated_by_user_id WHERE h.po_id=$1 ORDER BY h.created_at ASC`, [req.params.id]);
      res.json(success(r.rows));
    } catch (e) { next(e); }
  });

module.exports = router;
