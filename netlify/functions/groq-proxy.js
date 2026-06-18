// ===== Groq Proxy — Netlify Function =====
// This runs on Netlify's servers, NOT in the visitor's browser.
// Your real Groq API key lives in a Netlify environment variable
// (set it in Site configuration > Environment variables), never in this file.
//
// Once deployed, this is reachable at: /.netlify/functions/groq-proxy

exports.handler = async (event) => {
  const corsHeaders = {
    // Netlify serves the HTML and this function from the same domain,
    // so '*' is fine here — tighten it to your exact domain if you want to be stricter.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
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

  // Only forward what we expect — never let the client dictate the model
  // or smuggle other params through to your Groq account.
  const groqPayload = {
    model: 'llama-3.3-70b-versatile',
    max_tokens: 700,
    messages: Array.isArray(body.messages) ? body.messages : []
  };

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(groqPayload)
    });

    const text = await groqRes.text();
    return {
      statusCode: groqRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Upstream request failed' } })
    };
  }
};
