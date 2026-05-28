'use strict';
const po = require('../../src/services/po.service');
const { pool } = require('../helpers/db');

describe('po.service per-type paths', () => {
  it('pathFor returns the service subsequence', () => {
    expect(po.pathFor('service')).toEqual(['Registered','Processed','Inspected','BAST','Invoice']);
  });
  it('pathFor falls back to the full 11-stage path for unknown/installation', () => {
    expect(po.pathFor('installation')).toHaveLength(11);
    expect(po.pathFor(undefined)).toHaveLength(11);
  });
  it('assertOnPath rejects an off-path stage for service (Production)', () => {
    expect(() => po.assertOnPath('service','Processed','Production')).toThrow(/not on the service path/i);
  });
  it('assertOnPath rejects backward motion', () => {
    expect(() => po.assertOnPath('supply','Arrived','Processed')).toThrow(/back to/i);
  });
  it('assertOnPath allows a valid forward step on the supply path', () => {
    expect(() => po.assertOnPath('supply','Arrived','Inspected')).not.toThrow();
  });

  it('advanceStatus rejects advancing a service PO into Production', async () => {
    const u = await pool.query(`SELECT id, role FROM users WHERE role='sales' AND deleted_at IS NULL LIMIT 1`);
    const actor = u.rows[0];
    const ins = await pool.query(
      `INSERT INTO purchase_orders (po_number, po_type, current_status)
       VALUES ('PO-TYPE-TEST-SVC-1','service','Processed') RETURNING id`);
    const poId = ins.rows[0].id;
    await expect(po.advanceStatus(null, {
      poId, newStatus: 'Production', actorUserId: actor.id, actorRole: actor.role,
    })).rejects.toThrow(/not on the service path/i);
    await pool.query(`DELETE FROM purchase_orders WHERE id=$1`, [poId]);
  });
});
