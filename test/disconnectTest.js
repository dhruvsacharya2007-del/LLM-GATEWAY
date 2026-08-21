'use strict';


const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const API_KEY = process.env.GATEWAY_API_KEY || 'test-key';

async function main() {
  const controller = new AbortController();
  const t = setTimeout(() => {
    console.log('[test] aborting client after 300ms (simulated disconnect)');
    controller.abort();
  }, 300);

  try {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${API_KEY}`,
        'x-mock-mode': 'slow', 
      },
      body: JSON.stringify({
        model: 'mock-model',
        stream: true,
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      }),
    });

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      process.stdout.write(dec.decode(value, { stream: true }));
    }
  } catch (err) {
    if (err.name === 'AbortError') console.log('\n[test] client aborted as expected');
    else console.error('[test] unexpected error', err);
  } finally {
    clearTimeout(t);
  }
}

main();