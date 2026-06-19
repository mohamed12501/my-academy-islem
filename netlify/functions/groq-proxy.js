// netlify/functions/groq-proxy.js

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
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

  // Extract user message
  let userMessage = "Hello, what is funnel mastery?";
  if (body.messages && Array.isArray(body.messages)) {
    const lastUserMsg = body.messages.filter(m => m.role === 'user').pop();
    if (lastUserMsg && lastUserMsg.content) {
      userMessage = lastUserMsg.content;
    }
  } else if (body.query) {
    userMessage = body.query;
  } else if (body.message) {
    userMessage = body.message;
  } else if (body.prompt) {
    userMessage = body.prompt;
  }

  const HF_TOKEN = process.env.HF_API_TOKEN;

  if (!HF_TOKEN) {
    console.error('Missing HF_API_TOKEN');
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: Missing API token' })
    };
  }

  try {
    // Dynamic import for ES Module (works in CommonJS)
    const { Client } = await import('@gradio/client');

    console.log('Connecting to HF Space...');
    const client = await Client.connect(
      "mohamedoudha1312/FunnelBOOKiSLEMKb",
      { token: HF_TOKEN }
    );
    console.log('Connected successfully');

    console.log('Calling /chat endpoint...');
    const result = await client.predict("/chat", {
      message: userMessage
    });
    console.log('Got result');

    const responseData = result?.data || "I couldn't find an answer.";

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: responseData
          }
        }]
      })
    };

  } catch (e) {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);

    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          message: 'Request failed: ' + e.message,
          type: e.name || 'UnknownError'
        }
      })
    };
  }
};