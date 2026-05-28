'use strict';

function success(data, meta) {
    const payload = { success: true, data };
    if (meta !== undefined) payload.meta = meta;
    return payload;
}

function error(message, code) {
    const payload = { success: false, error: message };
    if (code !== undefined) payload.code = code;
    return payload;
}

module.exports = { success, error };
