'use strict';

/**
 * Password strength rules — apply to all flows that set a NEW password:
 *   - change-password (auth profile)
 *   - reset-password (forgot-password flow)
 *   - 2FA disable (uses current_password — strength NOT checked, just verified)
 *
 * Rules per spec docs/superpowers/specs/2026-05-03-auth-features-design.md §2:
 *   - min 12 characters
 *   - ≥ 1 uppercase letter (A-Z)
 *   - ≥ 1 lowercase letter (a-z)
 *   - ≥ 1 digit (0-9)
 *   - ≥ 1 symbol (any non-alphanumeric ASCII)
 *
 * NOT enforced retroactively on existing accounts. Old passwords keep working
 * via auth.changePassword's argon2/bcrypt dual-verify until next change.
 */

const MIN_LENGTH = 12;
const UPPER = /[A-Z]/;
const LOWER = /[a-z]/;
const DIGIT = /\d/;
const SYMBOL = /[^A-Za-z0-9]/;

function validatePasswordStrength(plaintext) {
    const errors = [];
    if (typeof plaintext !== 'string') {
        errors.push('Password must be a string');
        return errors;
    }
    if (plaintext.length < MIN_LENGTH) {
        errors.push(`Password must be at least ${MIN_LENGTH} characters`);
    }
    if (!UPPER.test(plaintext)) errors.push('Password must contain at least one uppercase letter');
    if (!LOWER.test(plaintext)) errors.push('Password must contain at least one lowercase letter');
    if (!DIGIT.test(plaintext)) errors.push('Password must contain at least one digit');
    if (!SYMBOL.test(plaintext)) errors.push('Password must contain at least one symbol');
    return errors;
}

module.exports = { validatePasswordStrength, MIN_LENGTH };
