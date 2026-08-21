'use strict';


const express = require('express');

const app = express();
app.use(express.json({ limit: '2mb' }));

const ANSWER = 'The capital of France is Paris, a city on the Seine known for the Eiffel Tower.';

function chunkEvent({ id, created, model, delta, finish_reason = null }) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`;
}

app.post('/v1/chat/completions', async (req, res) => {
  const mode = String(req.headers['x-mock-mode'] || 'normal');
  const model = req.body.model || 'mock-model';
  const wantsStream = req.body.stream === true;
  const includeUsage = !!(req.body.stream_options && req.body.stream_options.include_usage);
  const id = 'chatcmpl-mock-' + Math.random().toString(36).slice(2, 10);
  const created = Math.floor(Date.now() / 1000);

  if (!wantsStream) {
    return res.json({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const words = ANSWER.split(' ');
  const delay = mode === 'slow' ? 500 : 15;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  res.write(chunkEvent({ id, created, model, delta: { role: 'assistant' } }));

  try {
    for (let i = 0; i < words.length; i++) {
      res.write(chunkEvent({ id, created, model, delta: { content: (i === 0 ? '' : ' ') + words[i] } }));
      await sleep(delay);

      if (mode === 'error' && i === 1) return res.destroy(new Error('mock upstream drop'));
      if (mode === 'truncate' && i === 1) return res.end(); 
    }

    const finish = mode === 'length' ? 'length' : 'stop'; 
    res.write(chunkEvent({ id, created, model, delta: {}, finish_reason: finish }));

    if (includeUsage) {
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created, model,
        choices: [], usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
      })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (_) {
    try { res.destroy(); } catch (__) {}
  }
});

const PORT = Number(process.env.MOCK_PORT || 8081);
app.listen(PORT, () => console.log(`[mock-provider] listening on :${PORT}`));