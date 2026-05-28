'use strict';
// invitation.service.test.js
// Tests for invitation.service.js — Tasks 2.4, 2.5, 2.6, 2.7.
// Uses vitest globals (describe/it/expect/beforeAll/afterAll).

const { pool } = require('../helpers/db');
const svc = require('../../src/services/invitation.service');

let ceoId;

beforeAll(async () => {
    const u = await pool.query(`SELECT id FROM users WHERE role = 'ceo' LIMIT 1`);
    ceoId = u.rows[0]?.id;
});

afterAll(async () => {
    if (ceoId) {
        await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'invite-test-%@test.local'`);
    }
});

// ============================================================================
// Task 2.4 — create
// ============================================================================

describe('invitation.service.create', () => {
    it('Superadmin/CEO can create an invitation; returns plaintext token + password once', async () => {
        if (!ceoId) return;
        const r = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'invite-test-1@test.local',
            roleKey: 'sales',
        });
        expect(r.invitationId).toBeDefined();
        expect(r.activationToken).toMatch(/^[0-9a-f]{64}$/);
        expect(r.initialPassword).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/);

        // DB stores hashes only — never plaintext
        const row = await pool.query(
            `SELECT activation_token_hash, initial_password_hash, status, expires_at
               FROM user_invitations WHERE id = $1`,
            [r.invitationId],
        );
        expect(row.rows[0].activation_token_hash).not.toBe(r.activationToken);
        expect(row.rows[0].initial_password_hash).toMatch(/^\$argon2id\$/);
        expect(row.rows[0].status).toBe('pending');
        expect(new Date(row.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('queues an invitation email in email_queue when invitation_pending template is enabled', async () => {
        if (!ceoId) return;
        // Ensure invitation_pending template is enabled (seed.js should have done this).
        // We update if needed so the test is self-contained.
        await pool.query(`
            UPDATE notification_templates
               SET status = 'enabled',
                   subject = COALESCE(NULLIF(subject, ''), 'Interlab Portal Invitation'),
                   body    = COALESCE(NULLIF(body, ''), 'Role: {{role}} — activate at {{activation_url}} — expires {{expires_at}}')
             WHERE template_key = 'invitation_pending'`);

        const emailBefore = await pool.query(
            `SELECT count(*) AS c FROM email_queue WHERE to_address = 'invite-email-queue@test.local'`,
        );
        const countBefore = Number(emailBefore.rows[0].c);

        await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'invite-email-queue@test.local',
            roleKey: 'sales',
        });

        const emailAfter = await pool.query(
            `SELECT to_address, subject FROM email_queue WHERE to_address = 'invite-email-queue@test.local' ORDER BY created_at DESC LIMIT 1`,
        );
        // The template subject should have been written to email_queue.
        expect(Number(emailAfter.rowCount)).toBeGreaterThan(countBefore);
        // Cleanup
        await pool.query(`DELETE FROM email_queue WHERE to_address = 'invite-email-queue@test.local'`);
        await pool.query(`DELETE FROM user_invitations WHERE email = 'invite-email-queue@test.local'`);
    });

    it('rejects invitation for non-invitable role (e.g. ceo, superadmin)', async () => {
        if (!ceoId) return;
        await expect(svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'invite-test-2@test.local',
            roleKey: 'ceo',
        })).rejects.toThrow();
    });

    it('blocks double-invite while a pending row exists for same email', async () => {
        if (!ceoId) return;
        await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'invite-test-3@test.local',
            roleKey: 'finance',
        });
        await expect(svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'invite-test-3@test.local',
            roleKey: 'finance',
        })).rejects.toThrow(/pending/i);
    });

    it('non-superadmin/non-ceo without invite_user capability is forbidden', async () => {
        // Pick a sales staff user (lowest rank level)
        const s = await pool.query(`
            SELECT u.id FROM users u JOIN role_levels rl ON rl.id = u.level_id
             WHERE u.role = 'sales' AND rl.level_rank = 1 LIMIT 1`);
        const staffId = s.rows[0]?.id;
        if (!staffId) return;
        await expect(svc.create({
            actor: { id: staffId, role: 'sales' },
            email: 'invite-test-4@test.local',
            roleKey: 'sales',
        })).rejects.toThrow(/forbidden|cannot invite/i);
    });
});

// ============================================================================
// Task 2.5 — accept
// ============================================================================

describe('invitation.service.accept', () => {
    let token;

    beforeAll(async () => {
        if (!ceoId) return;
        const r = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'accept-test@test.local',
            roleKey: 'sales',
        });
        token = r.activationToken;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM users WHERE email = 'accept-test@test.local'`);
        await pool.query(`DELETE FROM user_invitations WHERE email = 'accept-test@test.local'`);
        await pool.query(`DELETE FROM user_invitations WHERE email = 'accept-expired@test.local'`);
    });

    it('accept creates the user with must_change_password=true', async () => {
        if (!token) return;
        const r = await svc.accept({ token, displayName: 'Test Sales User' });
        expect(r.userId).toBeDefined();
        const u = await pool.query(
            `SELECT must_change_password, account_status FROM users WHERE id = $1`,
            [r.userId],
        );
        expect(u.rows[0].must_change_password).toBe(true);
        expect(u.rows[0].account_status).toBe('active');
    });

    it('accept marks invitation status=accepted with accepted_at set', async () => {
        if (!token) return;
        const { hashToken } = require('../../src/utils/invitation_token');
        const inv = await pool.query(
            `SELECT status, accepted_at FROM user_invitations WHERE activation_token_hash = $1`,
            [hashToken(token)],
        );
        expect(inv.rows[0].status).toBe('accepted');
        expect(inv.rows[0].accepted_at).not.toBeNull();
    });

    it('accept rejects unknown token', async () => {
        await expect(svc.accept({ token: 'a'.repeat(64), displayName: 'x' })).rejects.toThrow();
    });

    it('accept rejects already-accepted token (one-shot)', async () => {
        if (!token) return;
        await expect(svc.accept({ token, displayName: 'x' })).rejects.toThrow();
    });

    it('accept rejects expired token (and marks it expired in DB)', async () => {
        if (!ceoId) return;
        const r = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'accept-expired@test.local',
            roleKey: 'sales',
        });
        await pool.query(
            `UPDATE user_invitations SET expires_at = now() - interval '1 hour' WHERE id = $1`,
            [r.invitationId],
        );
        await expect(
            svc.accept({ token: r.activationToken, displayName: 'x' }),
        ).rejects.toThrow(/expired|not found/i);
        // Verify it was marked expired in DB
        const check = await pool.query(
            `SELECT status FROM user_invitations WHERE id = $1`,
            [r.invitationId],
        );
        expect(check.rows[0].status).toBe('expired');
    });
});

// ============================================================================
// Task 2.6 — revoke + resend
// ============================================================================

describe('invitation.service.revoke', () => {
    let invId;

    beforeAll(async () => {
        if (!ceoId) return;
        const r = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'revoke-test@test.local',
            roleKey: 'sales',
        });
        invId = r.invitationId;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM user_invitations WHERE email = 'revoke-test@test.local'`);
    });

    it('revoke marks status=revoked + records reason', async () => {
        if (!invId || !ceoId) return;
        await svc.revoke({ actor: { id: ceoId, role: 'ceo' }, invitationId: invId, reason: 'wrong email' });
        const r = await pool.query(
            `SELECT status, revoked_at, revoke_reason FROM user_invitations WHERE id = $1`,
            [invId],
        );
        expect(r.rows[0].status).toBe('revoked');
        expect(r.rows[0].revoked_at).not.toBeNull();
        expect(r.rows[0].revoke_reason).toBe('wrong email');
    });
});

describe('invitation.service.resend', () => {
    let invId;

    beforeAll(async () => {
        if (!ceoId) return;
        const r = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            email: 'resend-test@test.local',
            roleKey: 'sales',
        });
        invId = r.invitationId;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM user_invitations WHERE email = 'resend-test@test.local'`);
    });

    it('resend creates a fresh invitation, revokes the old one', async () => {
        if (!invId || !ceoId) return;
        const r = await svc.resend({ actor: { id: ceoId, role: 'ceo' }, invitationId: invId });
        expect(r.invitationId).not.toBe(invId);
        expect(r.activationToken).toMatch(/^[0-9a-f]{64}$/);

        const oldStatus = await pool.query(
            `SELECT status FROM user_invitations WHERE id = $1`,
            [invId],
        );
        expect(oldStatus.rows[0].status).toBe('revoked');

        const newStatus = await pool.query(
            `SELECT status FROM user_invitations WHERE id = $1`,
            [r.invitationId],
        );
        expect(newStatus.rows[0].status).toBe('pending');
    });
});

// ============================================================================
// Task 2.7 — list
// ============================================================================

describe('invitation.service.list', () => {
    it('returns invitations with status filter; superadmin/ceo see all', async () => {
        if (!ceoId) return;
        const all = await svc.list({ actor: { id: ceoId, role: 'ceo' } });
        expect(Array.isArray(all)).toBe(true);
        const pending = await svc.list({ actor: { id: ceoId, role: 'ceo' }, status: 'pending' });
        expect(pending.every((x) => x.status === 'pending')).toBe(true);
    });
});
