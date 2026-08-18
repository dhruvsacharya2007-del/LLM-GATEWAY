'use strict';

const { z } = require('zod');


const messageSchema = z
  .object({
    role: z.string().min(1),
    content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
  })
  .passthrough();

const chatCompletionSchema = z
  .object({
    model: z.string().min(1).optional(), 
    messages: z.array(messageSchema).min(1),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
  })
  .passthrough();

module.exports = { chatCompletionSchema };