'use strict';
// invitation.service.js — F1 Invitation System (Plan 2)
//
// Manages the full lifecycle of user invitations:
//   create    — Superadmin/CEO/manager issues an invite token + initial password
//   accept    — Atomically onboards the invitee, creates the user row
//   revoke    — Cancels a pending invitation
//   resend    — Revokes old + issues fresh token/password
//   list      — Superadmin/CEO see all; manager sees own invitations

const db = require('../config/database');
const { ForbiddenError, ValidationError, ConflictError } = require('../utils/errors');
const { generateToken, hashToken } = require('../utils/invitation_token');
const { generatePassphrase, hashPassword } = require('../utils/initial_password');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVITABLE_ROLES = ['sales', 'admin_log', 'finance', 'technical', 'hrga', 'tax_insurance'];
const TOKEN_EXPIRY_HOURS = 48;

// ---------------------------------------------------------------------------
// Email queue helper
// ---------------------------------------------------------------------------

/**
 * Write a row to email_queue for the invitation_pending template.
 * Only runs when the template exists and is enabled — a disabled template
 * suppresses all delivery for that event (architectural invariant).
 *
 * Called after a new invitation INSERT (both create and resend paths).
 * Fire-and-forget from the caller; errors are caught and logged so the
 * invitation is never rolled back due to an email queue failure.
 *
 * @param {object} p
 * @param {string} p.email          - invitee email address
 * @param {string} p.roleKey        - target role key
 * @param {string} p.token          - plaintext activation token (64-char hex)
 * @param {Date}   p.expiresAt      - expiry timestamp
 */
async function queueInvitationEmail({ email, roleKey, token, expiresAt }) {
    try {
        const baseUrl = process.env.APP_BASE_URL || 'https://app.interlab-portal.com';
        const activationUrl = `${baseUrl}/activate/${token}`;

        const tplRes = await db.query(
            `SELECT subject, body, sender_id
               FROM notification_templates
              WHERE template_key = 'invitation_pending'
                AND status = 'enabled'
              LIMIT 1`,
        );

        if (!tplRes.rowCount) return; // template disabled or missing — suppress
        const { subject, body, sender_id: senderId } = tplRes.rows[0];
        if (!subject || !body) return; // template not configured — suppress

        const filledBody = body
            .replace(/\{\{role\}\}/g, roleKey)
            .replace(/\{\{activation_url\}\}/g, activationUrl)
            .replace(/\{\{expires_at\}\}/g, expiresAt.toISOString());

        await db.query(
            `INSERT INTO email_queue (to_address, subject, body_html, sender_id)
             VALUES ($1, $2, $3, $4)`,
            [email, subject, filledBody, senderId],
        );
    } catch (err) {
        // Email queue failure must never abort the invitation creation.
        // eslint-disable-next-line no-console
        console.error('[invitation] queueInvitationEmail error', err && err.message ? err.message : err);
    }
}

// ---------------------------------------------------------------------------
// Authority helpers
// ---------------------------------------------------------------------------

/**
 * Throws ForbiddenError unless actor may invite a user with targetRoleKey.
 * - Superadmin / CEO: always allowed.
 * - Others: must have invite_user (or full_access) capability on admin_rbac
 *   AND can only invite into their own role.
 */
async function authorizeInvite(actor, targetRoleKey) {
    if (actor.role === 'superadmin' || actor.role === 'ceo') return;
    const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
    if (!caps.has('invite_user') && !caps.has('full_access')) {
        throw new ForbiddenError('cannot invite users: missing invite_user capability');
    }
    if (targetRoleKey !== actor.role) {
        throw new ForbiddenError('Manager can invite only within their own role');
    }
}

/**
 * Throws ForbiddenError unless actor may manage (revoke/resend) an invitation.
 * - Superadmin / CEO: always allowed.
 * - Others: must have invite_user capability AND invitation is in their role AND
 *   they are the original inviter.
 */
async function authorizeManage(actor, invitationRow) {
    if (actor.role === 'superadmin' || actor.role === 'ceo') return;
    const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
    if (!caps.has('invite_user') && !caps.has('full_access')) {
        throw new ForbiddenError('cannot manage invitations: missing invite_user capability');
    }
    if (invitationRow.role_key !== actor.role) {
        throw new ForbiddenError('cannot manage cross-role invitation');
    }
    if (invitationRow.invited_by_user_id !== actor.id) {
        throw new ForbiddenError('only the original inviter can manage this invitation');
    }
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

/**
 * Resolve actor email for activity logging.
 * Routes populate actor.email (from req.user); direct service calls may not.
 */
async function resolveActorEmail(actor) {
    if (actor.email) return actor.email;
    try {
        const r = await db.query(`SELECT email FROM users WHERE id = $1`, [actor.id]);
        return r.rows[0]?.email || 'system@internal';
    } catch {
        return 'system@internal';
    }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * Issue a new invitation.
 *
 * @param {object} params
 * @param {{ id: string, role: string, email?: string }} params.actor
 * @param {string} params.email - target email address
 * @param {string} params.roleKey - one of INVITABLE_ROLES
 * @param {string|null} [params.levelId]
 * @returns {Promise<{ invitationId, activationToken, initialPassword, expiresAt }>}
 *   Plaintext token + password are returned ONCE and never stored.
 */
async function create({ actor, email, roleKey, levelId = null }) {
    if (!INVITABLE_ROLES.includes(roleKey)) {
        throw new ValidationError(`role '${roleKey}' is not invitable`);
    }
    await authorizeInvite(actor, roleKey);

    // Friendly error before hitting the DB constraint.
    const existing = await db.query(
        `SELECT id FROM user_invitations WHERE lower(email) = lower($1) AND status = 'pending'`,
        [email],
    );
    if (existing.rowCount) {
        throw new ConflictError('a pending invitation for this email already exists');
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const passphrase = generatePassphrase();
    const passwordHash = await hashPassword(passphrase);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    const r = await db.query(
        `INSERT INTO user_invitations
           (email, role_key, level_id, invited_by_user_id, inviter_role_key,
            activation_token_hash, initial_password_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [email, roleKey, levelId, actor.id, actor.role, tokenHash, passwordHash, expiresAt],
    );

    const invitationId = r.rows[0].id;

    // Fire-and-forget — never let logging break the mutation.
    resolveActorEmail(actor).then((actorEmail) => {
        activityLog.record({
            userId: actor.id,
            userEmail: actorEmail,
            userRole: actor.role,
            action: 'invitation.created',
            resourceType: 'user_invitations',
            resourceId: invitationId,
            detail: { email, roleKey, levelId },
        });
    }).catch(() => { /* intentionally swallowed */ });

    // Queue the invitation email via email_queue so the email worker picks
    // it up asynchronously. We write directly to email_queue (bypassing the
    // dashboard notification layer) because the invitee doesn't have a user
    // row yet and therefore has no user_id to fan-out to. We only do this
    // when the invitation_pending template is enabled — a disabled template
    // suppresses all delivery for that event.
    await queueInvitationEmail({ email, roleKey, token, expiresAt });

    return {
        invitationId,
        activationToken: token,
        initialPassword: passphrase,
        expiresAt: expiresAt.toISOString(),
    };
}

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------

/**
 * Accept an invitation: verify token, create user, mark invitation accepted.
 * Atomic via SELECT FOR UPDATE transaction.
 *
 * @param {object} params
 * @param {string} params.token - 64-char hex plaintext token
 * @param {string} [params.displayName]
 * @returns {Promise<{ userId: string, mustChangePassword: true }>}
 */
async function accept({ token, displayName }) {
    if (!token || typeof token !== 'string' || token.length !== 64) {
        throw new ValidationError('invalid token');
    }
    const tokenHash = hashToken(token);

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const inv = await client.query(
            `SELECT id, email, role_key, level_id, initial_password_hash, status, expires_at
               FROM user_invitations
              WHERE activation_token_hash = $1
              FOR UPDATE`,
            [tokenHash],
        );

        if (!inv.rowCount) {
            throw new ValidationError('invitation not found');
        }

        const row = inv.rows[0];

        if (row.status !== 'pending') {
            throw new ValidationError('invitation no longer valid');
        }

        if (new Date(row.expires_at) < new Date()) {
            await client.query(
                `UPDATE user_invitations SET status = 'expired', updated_at = now() WHERE id = $1`,
                [row.id],
            );
            await client.query('COMMIT');
            throw new ValidationError('invitation expired');
        }

        // Create the user with must_change_password=true.
        // backup_password_hash is seeded equal to password_hash ($2 reused) so a
        // future "reset to backup" restores the invitation-generated password.
        const userIns = await client.query(
            `INSERT INTO users
               (email, password_hash, backup_password_hash, role, level_id, display_name, account_status, must_change_password)
             VALUES ($1, $2, $2, $3, $4, $5, 'active', true)
             RETURNING id`,
            [row.email, row.initial_password_hash, row.role_key, row.level_id, displayName || row.email],
        );

        await client.query(
            `UPDATE user_invitations
                SET status = 'accepted', accepted_at = now(), updated_at = now()
              WHERE id = $1`,
            [row.id],
        );

        await client.query('COMMIT');

        // Fire-and-forget logging.
        activityLog.record({
            userId: userIns.rows[0].id,
            userEmail: row.email,
            userRole: row.role_key,
            action: 'invitation.accepted',
            resourceType: 'user_invitations',
            resourceId: row.id,
            detail: { invitedAs: row.role_key },
        }).catch(() => { /* intentionally swallowed */ });

        return { userId: userIns.rows[0].id, mustChangePassword: true };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------

/**
 * Revoke a pending invitation.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.invitationId
 * @param {string|null} [params.reason]
 * @returns {Promise<{ ok: true }>}
 */
async function revoke({ actor, invitationId, reason = null }) {
    const cur = await db.query(`SELECT * FROM user_invitations WHERE id = $1`, [invitationId]);
    if (!cur.rowCount) throw new ValidationError('invitation not found');

    await authorizeManage(actor, cur.rows[0]);

    if (cur.rows[0].status !== 'pending') {
        throw new ValidationError(`cannot revoke invitation with status '${cur.rows[0].status}'`);
    }

    await db.query(
        `UPDATE user_invitations
            SET status = 'revoked',
                revoked_at = now(),
                revoked_by_user_id = $2,
                revoke_reason = $3,
                updated_at = now()
          WHERE id = $1`,
        [invitationId, actor.id, reason],
    );

    resolveActorEmail(actor).then((actorEmail) => {
        activityLog.record({
            userId: actor.id,
            userEmail: actorEmail,
            userRole: actor.role,
            action: 'invitation.revoked',
            resourceType: 'user_invitations',
            resourceId: invitationId,
            detail: { reason },
        });
    }).catch(() => { /* intentionally swallowed */ });

    return { ok: true };
}

// ---------------------------------------------------------------------------
// resend
// ---------------------------------------------------------------------------

/**
 * Resend an invitation: revoke the current pending one and issue a fresh token.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string} params.invitationId - the existing pending invitation ID
 * @returns {Promise<{ invitationId, activationToken, initialPassword, expiresAt }>}
 */
async function resend({ actor, invitationId }) {
    const cur = await db.query(`SELECT * FROM user_invitations WHERE id = $1`, [invitationId]);
    if (!cur.rowCount) throw new ValidationError('invitation not found');

    await authorizeManage(actor, cur.rows[0]);

    if (cur.rows[0].status !== 'pending') {
        throw new ValidationError(`cannot resend invitation with status '${cur.rows[0].status}'`);
    }

    // Revoke old first.
    await db.query(
        `UPDATE user_invitations
            SET status = 'revoked',
                revoked_at = now(),
                revoked_by_user_id = $2,
                revoke_reason = 'resend',
                updated_at = now()
          WHERE id = $1`,
        [invitationId, actor.id],
    );

    // Create fresh invitation reusing email/role/level.
    const fresh = await create({
        actor,
        email: cur.rows[0].email,
        roleKey: cur.rows[0].role_key,
        levelId: cur.rows[0].level_id,
    });

    resolveActorEmail(actor).then((actorEmail) => {
        activityLog.record({
            userId: actor.id,
            userEmail: actorEmail,
            userRole: actor.role,
            action: 'invitation.resent',
            resourceType: 'user_invitations',
            resourceId: fresh.invitationId,
            detail: { previousInvitationId: invitationId },
        });
    }).catch(() => { /* intentionally swallowed */ });

    return fresh;
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * List invitations.
 * Superadmin/CEO see all; other actors see only their own (invited_by_user_id = actor.id).
 * Optional status filter. Capped at 200 rows.
 *
 * @param {object} params
 * @param {{ id: string, role: string }} params.actor
 * @param {string|null} [params.status]
 * @returns {Promise<object[]>}
 */
async function list({ actor, status = null }) {
    const isPrivileged = actor.role === 'superadmin' || actor.role === 'ceo';
    const conditions = [];
    const params = [];

    if (!isPrivileged) {
        params.push(actor.id);
        conditions.push(`invited_by_user_id = $${params.length}`);
    }
    if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await db.query(
        `SELECT id, email, role_key, level_id, status, invited_by_user_id, inviter_role_key,
                expires_at, accepted_at, revoked_at, revoke_reason, created_at
           FROM user_invitations
           ${whereClause}
          ORDER BY created_at DESC
          LIMIT 200`,
        params,
    );
    return r.rows;
}

module.exports = {
    INVITABLE_ROLES,
    TOKEN_EXPIRY_HOURS,
    create,
    accept,
    revoke,
    resend,
    list,
};
