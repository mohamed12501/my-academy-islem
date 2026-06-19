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

  // ===== CORRECT ENDPOINT FOR YOUR APP =====
  // Your app uses gr.ChatInterface, so the endpoint is /gradio_api/call/chat
  const HF_SUBMIT_URL = 'https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat';

  // Get token from environment variable
  const HF_TOKEN = process.env.HF_API_TOKEN;

  try {
    // Step 1: Submit the request
    const submitRes = await fetch(HF_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {})
      },
      body: JSON.stringify({ data: [userMessage] })
    });

    const submitResult = await submitRes.json();
    
    // Check for error
    if (submitResult.error) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: submitResult.error })
      };
    }

    // Get the event ID for polling
    const eventId = submitResult.event_id;
    if (!eventId) {
      // If no event_id, maybe the response is immediate
      // Try to parse the response directly
      if (submitResult.data && Array.isArray(submitResult.data)) {
        const responseData = submitResult.data[0] || "I couldn't find an answer.";
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
      }
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No event ID returned from HF Space' })
      };
    }

    // Step 2: Poll for the result
    const resultUrl = `https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat/${eventId}`;
    
    let attempts = 0;
    const maxAttempts = 35; // 35 seconds max (your app takes ~50s on first run)
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const pollRes = await fetch(resultUrl, {
        headers: HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {}
      });
      
      const pollData = await pollRes.json();
      
      // Check if result is ready
      if (pollData.data && Array.isArray(pollData.data)) {
        const responseData = pollData.data[0] || "I couldn't find an answer to that question.";
        
        // Return Groq-compatible format
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
      }
      
      attempts++;
    }

    // Timeout
    return {
      statusCode: 504,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { message: 'Request timed out. The RAG app is still processing. Please try again in a moment.' }
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