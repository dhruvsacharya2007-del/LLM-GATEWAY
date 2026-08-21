'use strict';

class SSEAccumulator {
  constructor({ maxBytes = 2 * 1024 * 1024 } = {}) {
    this._buf = '';
    this._maxBytes = maxBytes;

    this.id = null;
    this.model = null;
    this.created = null;
    this.role = null;
    this.content = '';
    this.finishReason = null;
    this.usage = null;

    this._sawDone = false;
    this._parseError = false;
    this._hasToolCalls = false;
    this._overflow = false;
  }

  
  push(text) {
    if (!text) return;
    
    this._buf += text.replace(/\r/g, '');

    let idx;
    while ((idx = this._buf.indexOf('\n\n')) !== -1) {
      const rawEvent = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 2);
      this._handleEvent(rawEvent);
    }
  }

 
  end() {
    const rest = this._buf.trim();
    this._buf = '';
    if (rest) this._handleEvent(rest);
  }

  _handleEvent(rawEvent) {
    const dataParts = [];
    for (const line of rawEvent.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      if (line.startsWith('data:')) dataParts.push(line.slice(5).replace(/^ /, ''));
      
    }
    if (dataParts.length === 0) return;

    const data = dataParts.join('\n');
    if (data === '[DONE]') { this._sawDone = true; return; }

    let chunk;
    try { chunk = JSON.parse(data); }
    catch { this._parseError = true; return; }
    this._consume(chunk);
  }

  _consume(chunk) {
    if (chunk.id) this.id = chunk.id;
    if (chunk.model) this.model = chunk.model;
    if (chunk.created) this.created = chunk.created;
    if (chunk.usage) this.usage = chunk.usage; 

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!choice) return;

    const delta = choice.delta || {};
    if (delta.role) this.role = delta.role;
    if (delta.tool_calls) this._hasToolCalls = true; 
    if (typeof delta.content === 'string' && delta.content.length) {

      if (this.content.length + delta.content.length > this._maxBytes) this._overflow = true;

      else this.content += delta.content;
    }
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
  }


  get contentComplete() {
    return this._sawDone || this.finishReason != null;
  }

  
  result() {
    if (this.reason() !== 'cacheable') return null;
    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created || Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{
        index: 0,
        message: { role: this.role || 'assistant', content: this.content },
        finish_reason: this.finishReason || 'stop',
      }],
      usage: this.usage || null, 
    };
  }

  
  reason() {
    if (!this.contentComplete) return 'incomplete';
    if (this._parseError) return 'parse_error';
    if (this._hasToolCalls) return 'tool_calls';
    if (this._overflow) return 'oversize';
    if (!this.content) return 'empty';
   
    if (this.finishReason && this.finishReason !== 'stop') return `finish_${this.finishReason}`;
    return 'cacheable';
  }
}

module.exports = { SSEAccumulator };