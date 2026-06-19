// netlify/functions/groq-proxy-poll.js
//
// Polls a previously-submitted RAG fallback job (only reached when Groq
// was unavailable — see groq-proxy.js).
//
// The Gradio "call/{event_id}" endpoint returns Server-Sent Events
// (Content-Type: text/event-stream), NOT plain JSON — calling `.json()`
// on it throws. We read it as a stream and look for an "event: complete"
// block.
//
// Each invocation only listens for up to ~8s (well under Netlify's
// function timeout) before reporting "processing" back to the client —
// the frontend's polling loop calls this repeatedly until the answer is
// ready, covering the Space's free-CPU cold start / inference time.

const HF_SPACE_BASE = 'https://mohamedoudha1312-funnelbookislemkb.hf.space';
const MAX_LISTEN_MS = 8000;

function parseSseBuffer(buffer) {
  // SSE events are separated by a blank line; each block looks like:
  //   event: complete
  //   data: ["the response text"]
  const blocks = buffer.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.replace(/\r$/, ''));
    const eventLine = lines.find(l => l.startsWith('event:'));
    if (!eventLine) continue;

    const eventType = eventLine.slice('event:'.length).trim();
    // Per the SSE spec, multiple "data:" lines in one block get joined.
    const rawData = lines
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice('data:'.length).trim())
      .join('\n');

    if (eventType === 'complete') {
      let parsed = null;
      try { parsed = JSON.parse(rawData); } catch (e) { /* leave null */ }
      return { done: true, error: false, data: parsed };
    }
    if (eventType === 'error') {
      return { done: true, error: true, data: rawData };
    }
    // "heartbeat" (or anything else) falls through — keep reading.
  }
  return { done: false };
}

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const eventId = event.queryStringParameters?.event_id;
  if (!eventId) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing event_id' }) };
  }

  const HF_TOKEN = process.env.HF_API_TOKEN;
  const authHeaders = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_LISTEN_MS);

  try {
    const res = await fetch(`${HF_SPACE_BASE}/gradio_api/call/chat/${eventId}`, {
      headers: authHeaders,
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      // 502/503 are usually the Space waking from sleep — tell the client
      // to keep polling instead of surfacing a hard failure.
      if (res.status === 502 || res.status === 503) {
        return {
          statusCode: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'processing', event_id: eventId })
        };
      }
      throw new Error(`Upstream returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parsed = parseSseBuffer(buffer);
      if (parsed.done) {
        reader.cancel().catch(() => {});
        clearTimeout(timer);

        if (parsed.error) {
          return {
            statusCode: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: { message: 'The knowledge base encountered an error. Please try again.' } })
          };
        }

        const answer = Array.isArray(parsed.data) ? parsed.data[0] : null;
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'complete',
            response: answer ?? "I couldn't find an answer."
          })
        };
      }
    }

    // Stream closed without ever sending "complete" — treat as still processing.
    clearTimeout(timer);
    return {
      statusCode: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'processing', event_id: eventId })
    };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      // Hit our own listen-time budget, not a real failure — the job is
      // probably still running.
      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'processing', event_id: eventId })
      };
    }
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Polling failed: ' + e.message } })
    };
  }
};
