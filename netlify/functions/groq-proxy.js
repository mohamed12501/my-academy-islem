// netlify/functions/groq-proxy.js
//
// Submits a question to the Funnel Mastery Tutor Gradio Space and returns
// an event_id for the frontend to poll via groq-proxy-poll.js.
//
// This Space's Gradio app (a gr.ChatInterface) only exposes one function,
// named "chat" (see the Space's "API" tab: api_name: /chat). There is no
// "/predict" — don't waste a round trip probing for it.

const HF_SPACE_BASE = 'https://mohamedoudha1312-funnelbookislemkb.hf.space';

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
        hasToken: !!process.env.HF_API_TOKEN
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  let userMessage = 'Hello, what is funnel mastery?';
  if (body.messages && Array.isArray(body.messages)) {
    const lastUserMsg = body.messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg && lastUserMsg.content) userMessage = lastUserMsg.content;
  } else if (body.query) {
    userMessage = body.query;
  } else if (body.message) {
    userMessage = body.message;
  } else if (body.prompt) {
    userMessage = body.prompt;
  }

  const HF_TOKEN = process.env.HF_API_TOKEN;
  // Only attach Authorization if a token is actually configured — this
  // Space looks public, and sending "Bearer undefined" for no reason is
  // just noise (harmless here, but worth avoiding).
  const authHeaders = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};

  try {
    const submitRes = await fetch(`${HF_SPACE_BASE}/gradio_api/call/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ data: [userMessage] })
    });

    const submitResult = await submitRes.json();

    if (!submitRes.ok || !submitResult.event_id) {
      throw new Error('Could not start a chat job: ' + JSON.stringify(submitResult));
    }

    return {
      statusCode: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'processing',
        event_id: submitResult.event_id,
        message: 'Your request is being processed. Please poll groq-proxy-poll.'
      })
    };
  } catch (e) {
    console.error('Error:', e.message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Request failed: ' + e.message } })
    };
  }
};
