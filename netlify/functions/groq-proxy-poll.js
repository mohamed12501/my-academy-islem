// netlify/functions/groq-proxy-poll.js
//
// Polls a previously-submitted Gradio chat job.
//
// IMPORTANT: the Gradio "call/{event_id}" endpoint returns Server-Sent
// Events (Content-Type: text/event-stream), NOT plain JSON. Calling
// `.json()` on it throws. We read it as a stream instead and look for an
// "event: complete" block.
//
// Each invocation only listens for up to ~8s (well under Netlify's
// function timeout) before reporting "processing" back to the client —
// the frontend's existing polling loop (every 1s, up to 60x) calls this
// repeatedly until the answer is ready, which covers the 30-60s cold
// start of the HF Space's free CPU tier.

const HF_SPACE_BASE = 'https://mohamedoudha1312-funnelbookislemkb.hf.space';
const MAX_LISTEN_MS = 8000;

function parseSseBuffer(buffer) {
  // SSE events are separated by a blank line; each block looks like:
  //   event: complete
  //   data: ["the response text"]
  const blocks = buffer.split('\n\n');
  for (const block of blocks) {
    const eventLine = block.split('\n').find(l => l.startsWith('event:'));
    const dataLine = block.split('\n').find(l => l.startsWith('data:'));
    if (!eventLine || !dataLine) continue;

    const eventType = eventLine.slice('event:'.length).trim();
    const rawData = dataLine.slice('data:'.length).trim();

    if (eventType === 'complete') {
      let parsed = null;
      try { parsed = JSON.parse(rawData); } catch (e) { /* leave null */ }
      return { done: true, error: false, data: parsed };
    }
    if (eventType === 'error') {
      return { done: true, error: true, data: rawData };
    }
    // "heartbeat" events fall through — keep reading.
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
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const eventId = event.queryStringParameters?.event_id;
  if (!eventId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing event_id' })
    };
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
            body: JSON.stringify({ error: { message: 'Gradio job failed: ' + parsed.data } })
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
      // Hit our own listen-time budget, not a real failure — the HF Space
      // job is probably still running (cold start can take 30-60s).
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
