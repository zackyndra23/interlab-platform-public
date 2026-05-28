'use strict';
const db = require('../config/database');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

async function userLevelRank(userId) {
  const r = await db.query(`
    SELECT rl.level_rank FROM users u JOIN role_levels rl ON rl.id = u.level_id
     WHERE u.id = $1`, [userId]);
  return r.rows[0]?.level_rank ?? 0;
}

async function userRole(userId) {
  const r = await db.query(`SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId]);
  return r.rows[0]?.role || null;
}

/**
 * Guards same-role user-management endpoints. The actor must:
 *   - Be authenticated (req.user)
 *   - OR be Superadmin/CEO (always allowed; bypass)
 *   - OR have role matching the target user's role AND a strictly-higher level_rank
 *
 * The target user is identified by req.params.id (UUID).
 */
async function sameRoleScopeGuard(req, _res, next) {
  try {
    if (!req.user) throw new UnauthorizedError('authenticated user required');
    if (req.user.role === 'superadmin' || req.user.role === 'ceo') return next();

    const targetUserId = req.params.id;
    if (!targetUserId) throw new ForbiddenError('missing target user id');

    const targetRole = await userRole(targetUserId);
    if (!targetRole) throw new ForbiddenError('target user not found');
    if (targetRole !== req.user.role) {
      throw new ForbiddenError('cross-role management not permitted');
    }

    const my = await userLevelRank(req.user.id);
    const their = await userLevelRank(targetUserId);
    if (their >= my) {
      throw new ForbiddenError('cannot manage same- or higher-rank user');
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { sameRoleScopeGuard };
