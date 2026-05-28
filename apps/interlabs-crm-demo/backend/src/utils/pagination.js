'use strict';

const ALLOWED_PAGE_SIZES = [25, 50, 75, 100];

function parsePagination(query) {
    const rawPage = Number.parseInt(query.page, 10);
    const rawLimit = Number.parseInt(query.limit, 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    let limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25;
    if (!ALLOWED_PAGE_SIZES.includes(limit)) {
        limit = ALLOWED_PAGE_SIZES.reduce((best, candidate) =>
            Math.abs(candidate - limit) < Math.abs(best - limit) ? candidate : best,
        ALLOWED_PAGE_SIZES[0]);
    }

    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

function buildMeta(total, page, limit) {
    return {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
}

module.exports = { parsePagination, buildMeta, ALLOWED_PAGE_SIZES };
