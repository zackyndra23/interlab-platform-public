'use strict';

// Working-day math (Mon–Fri). Holiday lists can be layered later; the interface
// below is stable so callers never need to change. Saturday = 6, Sunday = 0.

function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
}

function startOfNextWorkingDay(date) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    while (isWeekend(next)) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
}

/**
 * Add `days` working days to `from` (Date). Returns a new Date.
 *
 * Semantics: preserves the original time-of-day, advances the calendar forward
 * skipping weekends. `days = 0` returns the input unchanged (but normalized
 * to the same timestamp).
 */
function addWorkingDays(from, days) {
    if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
        throw new TypeError('addWorkingDays: from must be a valid Date');
    }
    if (!Number.isInteger(days) || days < 0) {
        throw new RangeError('addWorkingDays: days must be a non-negative integer');
    }
    let result = new Date(from.getTime());
    let remaining = days;
    while (remaining > 0) {
        result.setUTCDate(result.getUTCDate() + 1);
        if (!isWeekend(result)) remaining -= 1;
    }
    return result;
}

function isOverdue(dueAt, now = new Date()) {
    if (dueAt === null || dueAt === undefined) return false;
    const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
    if (Number.isNaN(due.getTime())) return false;
    return due.getTime() < now.getTime();
}

function workingDaysBetween(start, end) {
    if (!(start instanceof Date) || !(end instanceof Date)) {
        throw new TypeError('workingDaysBetween: both args must be Date');
    }
    if (end <= start) return 0;
    let count = 0;
    const cursor = new Date(start.getTime());
    cursor.setUTCHours(0, 0, 0, 0);
    const stop = new Date(end.getTime());
    stop.setUTCHours(0, 0, 0, 0);
    while (cursor < stop) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        if (!isWeekend(cursor)) count += 1;
    }
    return count;
}

module.exports = {
    addWorkingDays,
    isOverdue,
    isWeekend,
    startOfNextWorkingDay,
    workingDaysBetween,
};
