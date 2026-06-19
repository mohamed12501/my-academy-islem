// ===== Hugging Face RAG Proxy — Netlify Function =====
// This runs on Netlify's servers, NOT in the visitor's browser.
// Your Hugging Face Space is public, so no API key is needed.
// If you make it private, add HF_API_TOKEN to Netlify environment variables.
//
// Once deployed, this is reachable at: /.netlify/functions/rag-proxy

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

  // === Your HF Space API endpoint ===
  // For Gradio 5.x, use the /api/predict endpoint
  // If your app uses a different API name, change it here
  const HF_API_URL = 'https://mohamedoudha1312-FunnelBOOKiSLEMKb.hf.space/api/predict';

  // === Build the payload for HF Spaces ===
  // Gradio expects: { "data": [input1, input2, ...] }
  // Adjust based on your RAG app's expected inputs
  // If your app expects a single string input:
  const hfPayload = {
    data: [body.query || body.message || body.prompt || "Hello, what is funnel mastery?"]
  };

  try {
    const hfRes = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // If your Space is private, uncomment this and add HF_API_TOKEN to Netlify env:
         'Authorization': `Bearer ${process.env.HF_API_TOKEN}`
      },
      body: JSON.stringify(hfPayload)
    });

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
    // Gradio returns: { "data": [response] }
    let responseData = parsedResult;
    if (parsedResult.data && Array.isArray(parsedResult.data)) {
      responseData = parsedResult.data[0];
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
        success: true,
        response: responseData
      })
    };

  } catch (e) {
    console.error('HF API Error:', e);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Upstream request failed: ' + e.message } })
    };
  }
};