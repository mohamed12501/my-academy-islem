// netlify/functions/groq-proxy-poll.js
//
// Polls a previously-submitted RAG fallback job.
// Reads the SSE response as plain text (no streaming) for Lambda compatibility.

const HF_SPACE_BASE = 'https://mohamedoudha1312-funnelbookislemkb.hf.space';
const MAX_LISTEN_MS = 9000;

function parseSseText(text) {
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.replace(/\r$/, ''));
    const eventLine = lines.find(l => l.startsWith('event:'));
    if (!eventLine) continue;

    const eventType = eventLine.slice('event:'.length).trim();
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
  }
  return { done: false };
}

exports.handler = async (event) => {
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
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 502 || res.status === 503) {
        return {
          statusCode: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'processing', event_id: eventId })
        };
      }
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Upstream returned ' + res.status } })
      };
    }

    const text = await res.text();
    const parsed = parseSseText(text);

    if (!parsed.done) {
      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'processing', event_id: eventId })
      };
    }

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
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
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
