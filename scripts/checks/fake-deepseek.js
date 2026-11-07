// A stand-in for DeepSeek's Anthropic-compatible Messages API, so the real DeepSeek Harness can run with no API usage,
// and for an OpenAI-compatible one (POST …/chat/completions), the custom provider of the checks. `next(body, n, req)` says
// what the n-th request answers: { think, text, tools: [[name, args], …] } or { fail: status }. `models`: what GET
// …/models lists. Requests are kept with the names of their headers and whether they had a key, never its value.
const http = require('http');

function fakeDeepSeek(next, { models = [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }], key = '' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const sent = req.headers.authorization?.replace(/^Bearer /, '') || req.headers['x-api-key'] || '';
      requests.push({ method: req.method, url: req.url, headers: Object.keys(req.headers), keyMatches: Boolean(key) && sent === key, bearer: /^Bearer /.test(req.headers.authorization || '') });
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: models.map((m) => ({ object: 'model', ...m })) }));
        return;
      }
      const parsed = JSON.parse(body || '{}');
      requests[requests.length - 1].body = parsed;
      const n = requests.filter((r) => r.method === 'POST').length;
      const turn = (await next(parsed, n, req)) || { text: 'Done.' };
      if (/\/chat\/completions$/.test(req.url)) return completions(res, parsed, n, turn);
      if (turn.fail) {
        res.writeHead(turn.fail, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: turn.message || 'Refused' } }));
        return;
      }
      const usage = { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 };
      const events = [{ type: 'message_start', message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: parsed.model, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } }];
      let index = 0;
      const block = (start, delta) => {
        events.push({ type: 'content_block_start', index, content_block: start }, { type: 'content_block_delta', index, delta }, { type: 'content_block_stop', index });
        index++;
      };
      if (turn.think) block({ type: 'thinking', thinking: '', signature: '' }, { type: 'thinking_delta', thinking: turn.think });
      if (turn.text) block({ type: 'text', text: '' }, { type: 'text_delta', text: turn.text });
      (turn.tools || []).forEach(([name, args], i) => block({ type: 'tool_use', id: `toolu_${n}_${i}`, name, input: {} }, { type: 'input_json_delta', partial_json: JSON.stringify(args) }));
      events.push({ type: 'message_delta', delta: { stop_reason: turn.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 60 } }, { type: 'message_stop' });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) {
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        if (turn.slow) await new Promise((r) => setTimeout(r, turn.slow));
      }
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() }));
  });
}

// OpenAI Chat Completions, streamed: reasoning_content (DeepSeek's and many relays' field), content, tool_calls.
async function completions(res, body, n, turn) {
  if (turn.fail) {
    res.writeHead(turn.fail, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: turn.message || 'Refused', type: 'invalid_request_error' } }));
    return;
  }
  const chunk = (delta, finish = null) => ({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  const chunks = [chunk({ role: 'assistant' })];
  if (turn.think) chunks.push(chunk({ reasoning_content: turn.think }));
  if (turn.text) for (const part of turn.text.match(/.{1,12}/gs)) chunks.push(chunk({ content: part }));
  (turn.tools || []).forEach(([name, args], i) => chunks.push(chunk({ tool_calls: [{ index: i, id: `call_${n}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })));
  chunks.push(chunk({}, turn.tools?.length ? 'tool_calls' : 'stop'));
  chunks.push({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', model: body.model, choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) {
    res.write(`data: ${JSON.stringify(c)}\n\n`);
    if (turn.slow) await new Promise((r) => setTimeout(r, turn.slow));
  }
  res.end('data: [DONE]\n\n');
}

module.exports = { fakeDeepSeek };
