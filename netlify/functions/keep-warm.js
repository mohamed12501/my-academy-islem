// netlify/functions/keep-warm.js
// This function pings your HF Space to keep it warm

exports.handler = async (event, context) => {
  // Only allow GET requests (for cron/ping)
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    // Ping your HF Space
    const response = await fetch(
      'https://mohamedoudha1312-funnelbookislemkb.hf.space/',
      {
        headers: {
          'Authorization': `Bearer ${process.env.HF_API_TOKEN}`
        }
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'ok',
        spaceStatus: response.status,
        timestamp: new Date().toISOString()
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};