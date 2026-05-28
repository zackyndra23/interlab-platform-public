'use strict';
// Pure, side-effect-free helpers for the dummy seeder (unit-testable).
const PALETTE = { installation: 0.40, supply: 0.30, service: 0.30 };

function planTypeDistribution(total) {
    const out = [];
    for (const [type, frac] of Object.entries(PALETTE)) {
        for (let i = 0; i < Math.round(total * frac); i++) out.push(type);
    }
    while (out.length < total) out.push('installation');
    return out.slice(0, total);
}

function formatRecordNumber(prefix, year, seq) {
    return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// Termin pattern per type (amounts sum exactly to total; last absorbs rounding).
function terminPlanFor(poType, total) {
    const mk = (parts) => {
        let acc = 0;
        return parts.map(([label, pct], i) => {
            const amount = i === parts.length - 1
                ? total - acc
                : Math.round(total * pct);
            acc += amount;
            return { label, amount, sequence: i + 1 };
        });
    };
    if (poType === 'installation') return mk([['DP', 0.4], ['Pelunasan', 0.6]]);
    return mk([['Full', 1]]); // supply/service: single termin by default
}

// One backdated entry per stage from path[0] up to and including targetStage.
function buildTimeline(path, targetStage, startDate) {
    const end = path.indexOf(targetStage);
    const stages = path.slice(0, end + 1);
    const stepMs = 5 * 24 * 60 * 60 * 1000; // ~5 days between stages
    return stages.map((status, i) => ({
        status,
        at: new Date(startDate.getTime() + i * stepMs),
    }));
}

// Returns an array of length max(n, values.length) where every value appears >=1
// (first one-of-each, then round-robin to fill). Guarantees no status bucket is 0.
function spreadStatuses(values, n) {
  const out = [...values];
  let i = 0;
  while (out.length < n) { out.push(values[i % values.length]); i++; }
  return out;
}

// Enumerate 1:1 DM role-pairs: superadmin + ceo paired with EVERY other role,
// plus cross-department workflow pairs. Returns [[roleA, roleB], ...] (deduped, no self-pairs).
function buildDmPlan(roles) {
  const pairs = [], seen = new Set();
  const add = (a, b) => { if (a === b) return; const k = [a, b].sort().join('|'); if (seen.has(k)) return; seen.add(k); pairs.push([a, b]); };
  for (const r of roles) { add('superadmin', r); add('ceo', r); }
  for (const [a, b] of [['sales','admin_log'],['admin_log','technical'],['technical','finance'],['finance','tax_insurance'],['sales','finance'],['hrga','admin_log']]) add(a, b);
  return pairs;
}

module.exports = { planTypeDistribution, formatRecordNumber, terminPlanFor, buildTimeline, PALETTE, spreadStatuses, buildDmPlan };
