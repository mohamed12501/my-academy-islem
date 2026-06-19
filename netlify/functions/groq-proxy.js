// netlify/functions/groq-proxy.js

const { Client } = require('@gradio/client');

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
 if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        status: 'ok', 
        message: 'Proxy is working!',
        env: {
          hasToken: !!process.env.HF_API_TOKEN,
          nodeVersion: process.version
        }
      })
    };
  }
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
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

  // Log for debugging
  console.log('Processing request for message:', userMessage?.slice(0, 50));

  try {
    // Connect to your Space
    console.log('Connecting to HF Space...');
    const client = await Client.connect(
      "mohamedoudha1312/FunnelBOOKiSLEMKb",
      { token: HF_TOKEN }
    );
    console.log('Connected successfully');

    // Call the /chat endpoint
    console.log('Calling /chat endpoint...');
    const result = await client.predict("/chat", {
      message: userMessage
    });
    console.log('Got result:', result?.data?.slice(0, 100));

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
    console.error('Error details:', {
      message: e.message,
      stack: e.stack,
      name: e.name
    });
    
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