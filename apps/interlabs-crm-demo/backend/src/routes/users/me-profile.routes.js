'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/profile.validators');
const svc = require('../../services/user_profile.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// GET /api/users/me/profile
//   Returns the calling user's identity fields.
router.get('/', async (req, res, next) => {
    try {
        res.json(success(await svc.getProfile(req.user.id)));
    } catch (e) {
        next(e);
    }
});

// PATCH /api/users/me/profile
//   Updates first_name, last_name, email, phone.
router.patch(
    '/',
    validate({ body: v.updateProfile }),
    async (req, res, next) => {
        try {
            const updated = await svc.updateProfile({ userId: req.user.id, ...req.body });
            res.json(success(updated));
        } catch (e) {
            next(e);
        }
    },
);

module.exports = router;
