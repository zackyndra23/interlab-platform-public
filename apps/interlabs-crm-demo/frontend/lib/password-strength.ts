/**
 * Password strength validation — mirrors backend rules in
 * backend/src/utils/password_strength.js.
 *
 * Returns an array of human-readable error messages (empty = strong enough).
 * Use for realtime UI feedback; backend re-validates on submit.
 */

const MIN_LENGTH = 12;

export function validatePasswordStrength(plaintext: string): string[] {
    const errors: string[] = [];
    if (typeof plaintext !== 'string') {
        errors.push('Password must be a string');
        return errors;
    }
    if (plaintext.length < MIN_LENGTH) {
        errors.push(`Password must be at least ${MIN_LENGTH} characters`);
    }
    if (!/[A-Z]/.test(plaintext)) errors.push('Password must contain at least one uppercase letter');
    if (!/[a-z]/.test(plaintext)) errors.push('Password must contain at least one lowercase letter');
    if (!/\d/.test(plaintext)) errors.push('Password must contain at least one digit');
    if (!/[^A-Za-z0-9]/.test(plaintext)) errors.push('Password must contain at least one symbol');
    return errors;
}

export function isPasswordStrong(plaintext: string): boolean {
    return validatePasswordStrength(plaintext).length === 0;
}

export const PASSWORD_RULES = [
    'At least 12 characters',
    'At least 1 uppercase letter',
    'At least 1 lowercase letter',
    'At least 1 digit',
    'At least 1 symbol',
];

/** Realtime per-rule checklist used in password change/reset forms. */
export const PASSWORD_CHECKS: Array<{ label: string; test: (pw: string) => boolean }> = [
    { label: 'At least 12 characters',      test: (pw) => pw.length >= 12 },
    { label: 'At least 1 uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
    { label: 'At least 1 lowercase letter', test: (pw) => /[a-z]/.test(pw) },
    { label: 'At least 1 digit',            test: (pw) => /\d/.test(pw) },
    { label: 'At least 1 symbol',           test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];
