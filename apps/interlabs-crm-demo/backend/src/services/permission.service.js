'use strict';
// permission.service.js — F2 Permission Resolver
//
// Implements the 5-step deterministic permission formula.  Tasks 1.6–1.9 fill
// in steps incrementally:
//
//   Step 1 — Bypass:      superadmin / ceo receive ALL_CAPABILITY_KEYS instantly.
//   Step 2 — Template:    load role_permissions rows whose level_rank ≤ user's
//                         level_rank (within-role inheritance).
//   Step 3 — Grants:      per-user user_capability_overrides with type='grant'.
//   Step 4 — Cross-dept:  cross_dept_grants for the feature (any role key).
//   Step 5 — Deny:        user_capability_overrides with type='deny' remove caps.
//
// Redis cache stores the full {[featureKey]: [cap_keys...]} map per user.
// Cache is best-effort: Redis unavailable → uncached result returned silently.
// TTL is controlled by env.redis.ttlSeconds (PERMISSION_CACHE_TTL, default 300).
//
// Tasks 1.7–1.9 will extend the body of resolveCapabilities; this file is
// structured so those extensions are drop-in additions after the bypass branch.

const db  = require('../config/database');
const { getRedis, isAvailable } = require('../config/redis');
const env = require('../config/env');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical list of capability keys that exist in capability_definitions.
 * Hardcoded to match the seeded rows; if the seed and this list diverge that
 * is a seed/plan inconsistency to flag, not a service bug.
 */
const ALL_CAPABILITY_KEYS = [
    'view_own',
    'view_global',
    'create',
    'edit',
    'delete',
    'write',
    'export',
    'approve',
    'full_access',
    'invite_user',
    'advance_stage',
    'reject_stage',
    'admin_override_stage',
    'manage_notifications',
];

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const cacheKey = (userId) => `perm:user:${userId}`;

/**
 * Load the cached permission map for a user.
 * Returns the parsed object (featureKey → string[]) or null on miss / error.
 */
async function loadFromCache(userId) {
    if (!isAvailable()) return null;
    try {
        const raw = await getRedis().get(cacheKey(userId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Persist the updated permission map for a user.
 * Silently drops errors (best-effort).
 */
async function saveToCache(userId, payload) {
    if (!isAvailable()) return;
    try {
        await getRedis().set(
            cacheKey(userId),
            JSON.stringify(payload),
            'EX',
            env.redis.ttlSeconds,
        );
    } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Fetch user row + level_rank from the DB.
 * Returns { id, role, level_id, level_rank } or null.
 */
async function getUserContext(userId) {
    const r = await db.query(
        `SELECT u.id, u.role, u.level_id,
                rl.level_rank
           FROM users u
           LEFT JOIN role_levels rl ON rl.id = u.level_id
          WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [userId],
    );
    return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the effective capabilities for `userId` on `featureKey`.
 *
 * Returns a Set<string> of capability keys.  An empty set means "no access".
 *
 * Cache strategy: the full per-user map is cached under `perm:user:{userId}`.
 * A cache hit for a specific featureKey returns immediately; a miss resolves
 * fresh and merges the result back into the cached map before saving.
 *
 * @param {string} userId     - UUID of the user
 * @param {string} featureKey - e.g. 'sales_po', 'dashboard'
 * @returns {Promise<Set<string>>}
 */
async function resolveCapabilities(userId, featureKey) {
    // -------------------------------------------------------------------------
    // Cache lookup
    // -------------------------------------------------------------------------
    const cached = await loadFromCache(userId);
    if (cached?.[featureKey]) return new Set(cached[featureKey]);

    // -------------------------------------------------------------------------
    // Load user context
    // -------------------------------------------------------------------------
    const ctx = await getUserContext(userId);
    if (!ctx) return new Set();

    // -------------------------------------------------------------------------
    // Step 1 — Bypass: superadmin / ceo get everything
    // -------------------------------------------------------------------------
    if (ctx.role === 'superadmin' || ctx.role === 'ceo') {
        const caps = new Set(ALL_CAPABILITY_KEYS);
        await saveToCache(userId, { ...(cached || {}), [featureKey]: [...caps] });
        return caps;
    }

    // -------------------------------------------------------------------------
    // Step 2 — Template + within-role inheritance
    //
    // Collect capability keys from role_permissions rows where:
    //   - rp.role_id matches the user's role
    //   - rp.level_id points at a role_level whose rank ≤ user's own level_rank
    //   - rp.feature_id matches the requested feature
    //
    // This union implements "managers inherit staff permissions" without
    // duplicating rows in the DB.
    // -------------------------------------------------------------------------
    const tplRes = await db.query(
        `SELECT DISTINCT c.capability_key
           FROM role_permissions rp
           JOIN role_levels rl          ON rl.id  = rp.level_id
           JOIN feature_definitions f   ON f.id   = rp.feature_id
           JOIN capability_definitions c ON c.id  = rp.capability_id
           JOIN users u                 ON u.id   = $1
           JOIN role_levels url         ON url.id = u.level_id
          WHERE rp.role_id = (SELECT id FROM roles WHERE role_key = $2)
            AND rl.level_rank <= url.level_rank
            AND f.feature_key = $3`,
        [userId, ctx.role, featureKey],
    );
    const result = new Set(tplRes.rows.map((r) => r.capability_key));

    // -------------------------------------------------------------------------
    // Step 3 — Per-user GRANT overrides
    // -------------------------------------------------------------------------
    const grantRes = await db.query(
        `SELECT c.capability_key
           FROM user_capability_overrides o
           JOIN feature_definitions f   ON f.id = o.feature_id
           JOIN capability_definitions c ON c.id = o.capability_id
          WHERE o.user_id = $1
            AND f.feature_key = $2
            AND o.override_type = 'grant'
            AND o.revoked_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())`,
        [userId, featureKey],
    );
    for (const r of grantRes.rows) result.add(r.capability_key);

    // -------------------------------------------------------------------------
    // Step 4 — Cross-department GRANT overrides
    // -------------------------------------------------------------------------
    const cdRes = await db.query(
        `SELECT c.capability_key
           FROM cross_dept_grants g
           JOIN feature_definitions f   ON f.id = g.feature_id
           JOIN capability_definitions c ON c.id = g.capability_id
          WHERE g.grantee_user_id = $1
            AND f.feature_key = $2
            AND g.revoked_at IS NULL
            AND (g.expires_at IS NULL OR g.expires_at > now())`,
        [userId, featureKey],
    );
    for (const r of cdRes.rows) result.add(r.capability_key);

    // -------------------------------------------------------------------------
    // Step 5 — Per-user DENY overrides (applied LAST — deny wins over all)
    // -------------------------------------------------------------------------
    const denyRes = await db.query(
        `SELECT c.capability_key
           FROM user_capability_overrides o
           JOIN feature_definitions f   ON f.id = o.feature_id
           JOIN capability_definitions c ON c.id = o.capability_id
          WHERE o.user_id = $1
            AND f.feature_key = $2
            AND o.override_type = 'deny'
            AND o.revoked_at IS NULL
            AND (o.expires_at IS NULL OR o.expires_at > now())`,
        [userId, featureKey],
    );
    for (const r of denyRes.rows) result.delete(r.capability_key);

    // Persist result into cache (merge into existing map).
    await saveToCache(userId, { ...(cached || {}), [featureKey]: [...result] });
    return result;
}

/**
 * Resolve the data-scope visibility level for `userId` on `featureKey`.
 *
 * Returns { scope, granted_target_roles } where:
 *   - scope: 'own' | 'team' | 'role' | 'global' — derived from the user's
 *     role_levels.data_scope_default.  Superadmin/CEO bypass directly to
 *     'global'.
 *   - granted_target_roles: string[] — role keys from active cross_dept_grants
 *     for the given feature, allowing the caller to expand a WHERE clause to
 *     include records owned by those roles.
 *
 * @param {string} userId     - UUID of the user
 * @param {string} featureKey - e.g. 'sales_po', 'dashboard'
 * @returns {Promise<{ scope: string, granted_target_roles: string[] }>}
 */
async function resolveDataScope(userId, featureKey) {
    const ctx = await getUserContext(userId);
    if (!ctx) return { scope: 'own', granted_target_roles: [] };

    // Superadmin / CEO bypass — full global visibility.
    if (ctx.role === 'superadmin' || ctx.role === 'ceo') {
        return { scope: 'global', granted_target_roles: [] };
    }

    // Derive scope from the role_level default.
    const lvl = await db.query(
        `SELECT data_scope_default FROM role_levels WHERE id = $1`,
        [ctx.level_id],
    );
    const scope = lvl.rows[0]?.data_scope_default || 'own';

    // Collect target roles from active cross-department grants for this feature.
    const cd = await db.query(
        `SELECT DISTINCT g.target_role_key
           FROM cross_dept_grants g
           JOIN feature_definitions f ON f.id = g.feature_id
          WHERE g.grantee_user_id = $1
            AND f.feature_key     = $2
            AND g.revoked_at IS NULL
            AND (g.expires_at IS NULL OR g.expires_at > now())`,
        [userId, featureKey],
    );

    return {
        scope,
        granted_target_roles: cd.rows.map((r) => r.target_role_key),
    };
}

/**
 * Remove the cached permission map for a specific user.
 * Best-effort: silently no-ops when Redis is unavailable.
 *
 * @param {string} userId - UUID of the user
 */
async function invalidateUserCache(userId) {
    if (!isAvailable()) return;
    try { await getRedis().del(cacheKey(userId)); } catch { /* best-effort */ }
}

/**
 * Remove all cached permission maps (perm:user:* keys).
 * Best-effort: silently no-ops when Redis is unavailable.
 */
async function invalidateAll() {
    if (!isAvailable()) return;
    try {
        const r = getRedis();
        const keys = await r.keys('perm:user:*');
        if (keys.length) await r.del(...keys);
    } catch { /* best-effort */ }
}

module.exports = { resolveCapabilities, resolveDataScope, ALL_CAPABILITY_KEYS, invalidateUserCache, invalidateAll };
