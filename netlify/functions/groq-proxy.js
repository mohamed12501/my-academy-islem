// netlify/functions/groq-proxy.js
//
// Primary path: Groq (fast, ~1-2s).
// Fallback path: the Funnel Mastery RAG Space on Hugging Face — only used
// if Groq is unreachable, rate-limited, or GROQ_API_KEY isn't set. The
// fallback can't answer synchronously (the free CPU Space can take up to
// a couple minutes), so it returns a 202 + event_id for the frontend to
// poll via groq-proxy-poll.js.
//
// Env vars (Site configuration > Environment variables):
//   GROQ_API_KEY   — required for the primary path
//   HF_API_TOKEN   — optional, only needed if the Space is private

const HF_SPACE_BASE = 'https://mohamedoudha1312-funnelbookislemkb.hf.space';
const GROQ_TIMEOUT_MS = 8000;

function extractMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length) return body.messages;
  let userMessage = 'Hello, what is funnel mastery?';
  if (body.query) userMessage = body.query;
  else if (body.message) userMessage = body.message;
  else if (body.prompt) userMessage = body.prompt;
  return [{ role: 'user', content: userMessage }];
}

function lastUserText(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  return lastUser?.content || 'Hello, what is funnel mastery?';
}

function messagesToGradioHistory(messages) {
  const nonSystem = messages.filter(m => m.role !== 'system');
  const pairs = [];
  for (let i = 0; i < nonSystem.length - 1; i++) {
    if (nonSystem[i].role === 'user' && nonSystem[i + 1]?.role === 'assistant') {
      pairs.push([nonSystem[i].content, nonSystem[i + 1].content]);
      i++;
    }
  }
  return pairs;
}

async function tryGroq(messages) {
  if (!process.env.GROQ_API_KEY) {
    return { ok: false, reason: 'GROQ_API_KEY not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 700,
        messages
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, reason: `Groq returned ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    if (!data?.choices?.[0]?.message?.content) {
      return { ok: false, reason: 'Groq response was missing message content' };
    }
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, reason: e.name === 'AbortError' ? 'Groq request timed out' : e.message };
  }
}

async function submitToRag(messages) {
  const HF_TOKEN = process.env.HF_API_TOKEN;
  const authHeaders = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
  const userMessage = lastUserText(messages);
  const history = messagesToGradioHistory(messages);
  console.log('RAG submit:', JSON.stringify({ userMessage, historyLen: history.length }));

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`${HF_SPACE_BASE}/gradio_api/call/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ data: [userMessage, history] })
    });

    if ((res.status === 502 || res.status === 503) && attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    const result = await res.json();
    if (!res.ok || !result.event_id) {
      throw new Error('Could not start RAG job: ' + JSON.stringify(result));
    }
    return result.event_id;
  }
}

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        message: 'Proxy is working!',
        hasGroqToken: !!process.env.GROQ_API_KEY,
        hasHfToken: !!process.env.HF_API_TOKEN
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Invalid JSON' } })
    };
  }

  const messages = extractMessages(body);

  // ---- 1) Try Groq first ----
  const groqResult = await tryGroq(messages);
  if (groqResult.ok) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'groq', ...groqResult.data })
    };
  }
  console.warn('Groq unavailable, falling back to RAG:', groqResult.reason);

  // ---- 2) Fall back to the RAG Space ----
  try {
    const event_id = await submitToRag(messages);
    return {
      statusCode: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'processing',
        engine: 'rag-fallback',
        event_id,
        groq_failure_reason: groqResult.reason,
        message: 'Groq was unavailable — falling back to the course knowledge base. Poll groq-proxy-poll.'
      })
    };
  } catch (ragErr) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          message:
            'Both engines failed. Groq: ' + groqResult.reason + ' | RAG fallback: ' + ragErr.message
        }
      })
    };
  }
};
