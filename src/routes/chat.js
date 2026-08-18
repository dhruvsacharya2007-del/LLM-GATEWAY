'use strict';

const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const validateBody = require('../middleware/validate');
const { chatCompletionSchema } = require('../schemas/chatCompletion');
const { resolveProvider } = require('../providers');
const { createError } = require('../lib/httpErrors');

const router = express.Router();


router.post(
  '/v1/chat/completions',
  apiKeyAuth,
  validateBody(chatCompletionSchema),
  asyncHandler(async (req, res) => {
    if (req.body.stream === true) {
      throw createError(501, 'Streaming is not supported yet (arrives Day 3). Set "stream": false.', {
        code: 'not_implemented',
      });
    }

    const provider = resolveProvider(req);
    const result = await provider.chatCompletion(req.body, { headers: req.headers });

    res.setHeader('x-llm-provider', provider.name);
    res.json(result);
  })
);

module.exports = router;