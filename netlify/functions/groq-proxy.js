// ===== Hugging Face RAG Proxy — Netlify Function =====
// This runs on Netlify's servers, NOT in the visitor's browser.
// Your Hugging Face Space is public, so no API key is needed.
// If you make it private, add HF_API_TOKEN to Netlify environment variables.
//
// Once deployed, this is reachable at: /.netlify/functions/groq-proxy

exports.handler = async (event) => {
  const corsHeaders = {
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

  // === Extract the user's message from the request ===
  // The AI Tutor sends: { messages: [{ role: 'user', content: '...' }] }
  let userMessage = "Hello, what is funnel mastery?";
  
  if (body.messages && Array.isArray(body.messages)) {
    // Find the last user message
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

  // === Your HF Space API endpoint ===
  // For Gradio 5.x, use the /api/predict endpoint
  const HF_API_URL = 'https://mohamedoudha1312-FunnelBOOKiSLEMKb.hf.space/api/predict';

  // === Build the payload for HF Spaces ===
  // Gradio expects: { "data": [input1, input2, ...] }
  const hfPayload = {
    data: [userMessage]
  };

  try {
    // Set a timeout to avoid hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const hfRes = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(hfPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Get the response from Gradio
    const result = await hfRes.text();
    
    // Parse the response if it's JSON
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (e) {
      // If not JSON, return as-is
      return {
        statusCode: hfRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        body: result
      };
    }

    // Extract the actual response from Gradio's format
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

    // === Return in Groq-compatible format ===
    // The AI Tutor expects the response in this format
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
    console.error('HF API Error:', e);
    
    // Check if it was a timeout
    if (e.name === 'AbortError') {
      return {
        statusCode: 504,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { 
            message: 'The RAG app is taking too long to respond. Please try again in a moment.' 
          }
        })
      };
    }

    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: { 
          message: 'Upstream request failed: ' + e.message 
        } 
      })
    };
  }
};