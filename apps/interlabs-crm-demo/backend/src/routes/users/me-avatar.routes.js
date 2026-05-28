'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const Joi = require('joi');
const { validate } = require('../../middleware/validator.middleware');
const svc = require('../../services/avatar.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// POST /api/users/me/avatar/presign
//   returns { uploadUrl, objectKey, expiresIn }
router.post('/presign', async (req, res, next) => {
  try {
    const r = await svc.presignUpload({ userId: req.user.id });
    res.json(success(r));
  } catch (e) { next(e); }
});

// POST /api/users/me/avatar/commit
//   body: { rawObjectKey }
//   returns { fileId, objectKey, thumbKey }
router.post('/commit',
  validate({ body: Joi.object({ rawObjectKey: Joi.string().min(10).max(500).required() }) }),
  async (req, res, next) => {
    try {
      const r = await svc.commit({ userId: req.user.id, rawObjectKey: req.body.rawObjectKey });
      res.json(success(r));
    } catch (e) { next(e); }
  });

// GET /api/users/:id/avatar
//   returns { url, fallback, expiresIn }
//   public-ish: any authenticated user can view another user's avatar URL
//
//   :id is validated as a UUID before the handler runs so a garbage string
//   (e.g. "non-uuid") returns 400 instead of a 500 from Postgres trying to
//   cast an invalid value to uuid.
const idRouter = express.Router();
idRouter.use(authMiddleware);
idRouter.get('/:id/avatar',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }) }),
  async (req, res, next) => {
    try {
      const r = await svc.presignGet({ userId: req.params.id });
      res.json(success(r));
    } catch (e) { next(e); }
  });

module.exports = { router, idRouter };
