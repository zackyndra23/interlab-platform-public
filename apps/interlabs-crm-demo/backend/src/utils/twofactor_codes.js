'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // omit 0/O/1/I/L for clarity
const CODE_LEN = 10;
const CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

function generateCode() {
    const out = [];
    for (let i = 0; i < CODE_LEN; i++) {
        out.push(ALPHABET[crypto.randomInt(0, ALPHABET.length)]);
    }
    return out.join('');
}

/** Returns plaintexts AND hashes. Plaintexts shown to user once. */
async function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < CODE_COUNT; i++) codes.push(generateCode());
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
    return { codes, hashes };
}

/** Verifies plaintext against array of bcrypt hashes. Returns the index of
 * the matching hash, or -1 if none match. Caller must remove that hash from
 * the user's stored list to consume the code. */
async function verifyAndFindIndex(plaintext, hashes) {
    if (!plaintext || !Array.isArray(hashes)) return -1;
    for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(plaintext, hashes[i])) return i;
    }
    return -1;
}

module.exports = { generateBackupCodes, verifyAndFindIndex, CODE_COUNT, CODE_LEN };
