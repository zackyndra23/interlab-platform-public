'use strict';
const db = require('../config/database');
const { resolveCapabilities, resolveDataScope } = require('../services/permission.service');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

function rbacGuard(featureKey, capabilityKey) {
  return async function rbacMiddleware(req, _res, next) {
    try {
      if (!req.user) throw new UnauthorizedError('Authenticated user required');

      // Backwards-compat: roleScope still attached for downstream services.
      const scopeRow = await db.query(`
        SELECT managed_role_scope, can_manage_same_role, feature_permission_scope
          FROM user_role_scope WHERE user_id = $1`, [req.user.id]);
      req.roleScope = scopeRow.rows[0] || {
        managed_role_scope: null,
        can_manage_same_role: false,
        feature_permission_scope: null,
      };

      const caps = await resolveCapabilities(req.user.id, featureKey);
      if (!caps.has(capabilityKey) && !caps.has('full_access')) {
        throw new ForbiddenError(
          `Role '${req.user.role}' lacks capability '${capabilityKey}' on '${featureKey}'`,
        );
      }

      // Attach resolved info for downstream handlers.
      req.capabilities = caps;
      req.dataScope = await resolveDataScope(req.user.id, featureKey);
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { rbacGuard };
