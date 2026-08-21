'use strict';

const { SSEAccumulator } = require('../lib/sseAccumulator');


function writeChunk(res, buf) {
  return new Promise((resolve) => {
    if (res.writableEnded || res.destroyed) return resolve(false);
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    const flushed = res.write(buf, (err) => { if (err) done(false); });
    if (flushed) done(true);
    else res.once('drain', () => done(true));
  });
}


async function streamProxy({
  req, res, upstream, abortUpstream, onComplete,
  logger, metrics,
  idleTimeoutMs = 30000, maxBytes = 2 * 1024 * 1024,
}) {
  const reqId = (req && req.id) || '-';
  metrics && metrics.streamStarted && metrics.streamStarted();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // defeat nginx/proxy buffering
  if (res.flushHeaders) res.flushHeaders();

  const decoder = new TextDecoder('utf-8');
  const acc = new SSEAccumulator({ maxBytes });


  let clientGone = false;
  let idleTimedOut = false;
  let upstreamError = null;


  const onClose = () => {
    if (!res.writableEnded) {
      clientGone = true;
      logger && logger.warn && logger.warn({ reqId }, 'client disconnected mid-stream; aborting upstream');
      try { abortUpstream(); } catch (_) {}
    }
  };
  res.on('close', onClose);

 
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      logger && logger.error && logger.error({ reqId, idleTimeoutMs }, 'upstream idle timeout; aborting');
      try { abortUpstream(); } catch (_) {}
    }, idleTimeoutMs);
  };

  const reader = upstream.body.getReader();
  armIdle();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      armIdle();

   
      const ok = await writeChunk(res, Buffer.from(value));
      if (!ok) { clientGone = true; break; }

      try {
        acc.push(decoder.decode(value, { stream: true }));
      } catch (err) {
        logger && logger.error && logger.error({ reqId, err: String(err) }, 'accumulator push failed (client unaffected)');
      }
    }
    acc.push(decoder.decode()); 
    acc.end();
  } catch (err) {
 
    if (!clientGone && !idleTimedOut) {
      upstreamError = err;
      logger && logger.error && logger.error({ reqId, err: String(err) }, 'upstream stream read error');
    }
  } finally {
    clearTimeout(idleTimer);
    res.off('close', onClose);
    try { reader.releaseLock(); } catch (_) {}
  }

  
  if (clientGone) {
    if (!res.writableEnded) res.end();
    metrics && metrics.streamDisconnect && metrics.streamDisconnect();
    return { ok: false, reason: 'client_disconnect' };
  }

  if (idleTimedOut || upstreamError) {
    if (!res.writableEnded) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: { message: 'upstream stream failed', type: 'gateway_upstream_error' },
        })}\n\n`);
      } catch (_) {}
      res.end();
    }
    metrics && metrics.streamUpstreamError && metrics.streamUpstreamError();
    return { ok: false, reason: idleTimedOut ? 'idle_timeout' : 'upstream_error' };
  }

  if (!res.writableEnded) res.end(); 

 
  const assembled = acc.result();
  if (!assembled) {
    logger && logger.warn && logger.warn({ reqId, reason: acc.reason() }, 'stream complete but not cacheable');
    metrics && metrics.streamNoncacheable && metrics.streamNoncacheable();
    return { ok: true, cached: false, reason: acc.reason() };
  }

 
  try {
    if (onComplete) await onComplete(assembled);
  } catch (err) {
    logger && logger.error && logger.error({ reqId, err: String(err) }, 'onComplete hook failed post-delivery');
  }

  metrics && metrics.streamCompleted && metrics.streamCompleted();
  return { ok: true, cached: true, assembled };
}

module.exports = { streamProxy };