'use strict';
const L = require('../../scripts/seed-dummy/lib');
const po = require('../../src/services/po.service');

describe('seed-dummy.lib', () => {
  it('planTypeDistribution(100) → 40 installation / 30 supply / 30 service', () => {
    const d = L.planTypeDistribution(100);
    expect(d).toHaveLength(100);
    const c = d.reduce((a, t) => (a[t] = (a[t]||0)+1, a), {});
    expect(c).toEqual({ installation: 40, supply: 30, service: 30 });
  });

  it('formatRecordNumber zero-pads to PREFIX-YYYY-NNNNN', () => {
    expect(L.formatRecordNumber('PO', 2026, 42)).toBe('PO-2026-00042');
  });

  it('terminPlanFor(installation) → DP 40% + Pelunasan 60% summing to total', () => {
    const p = L.terminPlanFor('installation', 100_000_000);
    expect(p.map(t => t.label)).toEqual(['DP', 'Pelunasan']);
    expect(p.reduce((s, t) => s + t.amount, 0)).toBe(100_000_000);
    expect(p[0].amount).toBe(40_000_000);
  });

  it('terminPlanFor(supply) → single Full termin = total', () => {
    const p = L.terminPlanFor('supply', 50_000_000);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ label: 'Full', amount: 50_000_000 });
  });

  it('buildTimeline backdates one entry per stage up to the target, oldest first', () => {
    const path = po.pathFor('service'); // Registered,Processed,Inspected,BAST,Invoice
    const tl = L.buildTimeline(path, 'BAST', new Date('2026-01-01T00:00:00Z'));
    expect(tl.map(e => e.status)).toEqual(['Registered','Processed','Inspected','BAST']);
    for (let i = 1; i < tl.length; i++) {
      expect(tl[i].at.getTime()).toBeGreaterThan(tl[i-1].at.getTime());
    }
  });

  it('spreadStatuses guarantees >=1 of each value and length n', () => {
    const out = L.spreadStatuses(['a','b','c'], 7);
    expect(out).toHaveLength(7);
    for (const v of ['a','b','c']) expect(out.filter(x => x===v).length).toBeGreaterThanOrEqual(1);
  });
  it('spreadStatuses pads n up to values.length when n is too small', () => {
    expect(L.spreadStatuses(['a','b','c','d'], 2)).toHaveLength(4); // never drops a value
  });

  it('buildDmPlan pairs superadmin + ceo with every other role, no self-pairs', () => {
    const ROLES = ['superadmin','ceo','sales','admin_log','finance','technical','hrga','tax_insurance'];
    const plan = L.buildDmPlan(ROLES);
    const partnersOf = (role) => plan.filter(p => p.includes(role)).map(p => p.find(x => x !== role));
    expect(new Set(partnersOf('superadmin')).size).toBe(7);
    expect(new Set(partnersOf('ceo')).size).toBe(7);
    for (const [a, b] of plan) expect(a).not.toBe(b);
  });
});
