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

  // Your HF Space URL
  const HF_API_URL = 'https://mohamedoudha1312-FunnelBOOKiSLEMKb.hf.space/api/predict';

  // Get token from environment variable (DO NOT hardcode)
  const HF_TOKEN = process.env.HF_API_TOKEN;

  if (!HF_TOKEN) {
    console.error('HF_API_TOKEN environment variable is not set');
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: Missing API token' })
    };
  }

  try {
    const hfRes = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ data: [userMessage] })
    });

    const result = await hfRes.text();
    
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (e) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        body: result
      };
    }

    let responseData = "I couldn't find an answer to that question.";
    if (parsedResult.data && Array.isArray(parsedResult.data)) {
      responseData = parsedResult.data[0] || responseData;
    } else if (parsedResult.response) {
      responseData = parsedResult.response;
    } else if (parsedResult.error) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: parsedResult.error })
      };
    }

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
    console.error('Error:', e);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { message: 'Request failed: ' + e.message }
      })
    };
  }
};