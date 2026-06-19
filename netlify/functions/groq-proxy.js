// netlify/functions/groq-proxy.js

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

  try {
    // Use dynamic import for ES Module
    const { Client } = await import('@gradio/client');

    const client = await Client.connect(
      "mohamedoudha1312/FunnelBOOKiSLEMKb",
      { token: HF_TOKEN }
    );

    const result = await client.predict("/chat", {
      message: userMessage
    });

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
    // Check if it's a timeout error
    const isTimeout = e.message?.includes('timeout') || e.message?.includes('abort');
    
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          message: isTimeout 
            ? 'The RAG app is warming up (cold start). Please wait 30 seconds and try again.'
            : 'Request failed: ' + e.message,
          type: e.name || 'UnknownError'
        }
      })
    };
  }
};