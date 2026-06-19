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
    // ===== DIRECT API CALL (NO GRADIO CLIENT) =====
    // Step 1: Submit the request
    const submitRes = await fetch(
      'https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/predict',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HF_TOKEN}`
        },
        body: JSON.stringify({ data: [userMessage] })
      }
    );

    // If it's a 404, try alternative endpoints
    if (submitRes.status === 404) {
      // Try older Gradio endpoint
      const altRes = await fetch(
        'https://mohamedoudha1312-funnelbookislemkb.hf.space/api/predict',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${HF_TOKEN}`
          },
          body: JSON.stringify({ data: [userMessage] })
        }
      );
      
      if (altRes.status === 404) {
        // Try with gradio_api/call/chat
        const chatRes = await fetch(
          'https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${HF_TOKEN}`
            },
            body: JSON.stringify({ data: [userMessage] })
          }
        );
        
        const chatResult = await chatRes.json();
        
        if (chatResult.event_id) {
          return {
            statusCode: 202,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'processing',
              event_id: chatResult.event_id,
              message: 'Your request is being processed. Please poll the /poll endpoint.'
            })
          };
        }
      }
      
      const altResult = await altRes.json();
      
      if (altResult.event_id) {
        return {
          statusCode: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'processing',
            event_id: altResult.event_id,
            message: 'Your request is being processed. Please poll the /poll endpoint.'
          })
        };
      }
    }

    // If it's a successful immediate response
    if (submitRes.status === 200) {
      const result = await submitRes.json();
      const responseData = result.data?.[0] || result.response || "I couldn't find an answer.";
      
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

    // If there's an event_id
    const submitResult = await submitRes.json();
    if (submitResult.event_id) {
      return {
        statusCode: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'processing',
          event_id: submitResult.event_id,
          message: 'Your request is being processed. Please poll the /poll endpoint.'
        })
      };
    }

    throw new Error('Unexpected response format: ' + JSON.stringify(submitResult));

  } catch (e) {
    console.error('Error:', e.message);
    
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          message: 'Request failed: ' + e.message
        }
      })
    };
  }
};

// ===== POLLING ENDPOINT =====
exports.poll = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const eventId = event.queryStringParameters?.event_id;
  if (!eventId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing event_id' })
    };
  }

  const HF_TOKEN = process.env.HF_API_TOKEN;

  try {
    const pollRes = await fetch(
      `https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat/${eventId}`,
      {
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`
        }
      }
    );

    const result = await pollRes.json();

    if (result.data && Array.isArray(result.data)) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'complete',
          response: result.data[0] || "I couldn't find an answer."
        })
      };
    }

    // Still processing
    return {
      statusCode: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'processing',
        event_id: eventId
      })
    };

  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { message: 'Polling failed: ' + e.message }
      })
    };
  }
};