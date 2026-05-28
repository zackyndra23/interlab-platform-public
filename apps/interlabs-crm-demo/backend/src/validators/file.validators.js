'use strict';

const Joi = require('joi');

// Validates the multipart text fields accompanying an upload. The file
// itself is handled by multer, not Joi — multer runs before the validator
// so req.body already contains the parsed text fields.
const fileUploadBody = Joi.object({
    related_module:       Joi.string().max(200).required(),
    related_entity_id:    Joi.string().uuid().allow('', null),
    // Optional: link file to a po_document_types row so that the post-insert
    // hook in file.service can trigger PO stage advances (e.g. AWB → Shipped).
    po_document_type_id:  Joi.string().uuid().allow(null),
}).unknown(false);

const fileIdParam = Joi.object({
    id: Joi.string().uuid().required(),
});

module.exports = {
    fileUploadBody,
    fileIdParam,
};
