// netlify/functions/groq-proxy.js

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  // Extract message
  let userMessage = "Hello";

  if (body.messages && Array.isArray(body.messages)) {
    const last = body.messages.filter(m => m.role === "user").pop();
    if (last?.content) userMessage = last.content;
  } else if (body.message) {
    userMessage = body.message;
  } else if (body.query) {
    userMessage = body.query;
  }

  const HF_TOKEN = process.env.HF_API_TOKEN;

  if (!HF_TOKEN) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing HF_API_TOKEN" }),
    };
  }

  try {
    // 1. Send request to Gradio Chat endpoint
    const startRes = await fetch(
      "https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HF_TOKEN}`,
        },
        body: JSON.stringify({
          data: [userMessage],
        }),
      }
    );

    const startText = await startRes.text();

    // Gradio returns: { event_id: "xxx" }
    let eventId;
    try {
      eventId = JSON.parse(startText).event_id;
    } catch {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Failed to get event_id from HF",
          raw: startText,
        }),
      };
    }

    // 2. Wait for result
    const resultRes = await fetch(
      `https://mohamedoudha1312-funnelbookislemkb.hf.space/gradio_api/call/chat/${eventId}`,
      {
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
        },
      }
    );

    const resultText = await resultRes.text();

    // 3. Extract final message from SSE stream
    const lines = resultText.split("\n");
    let answer = "No response received";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        try {
          const json = JSON.parse(line.replace("data:", "").trim());

          // Usually last message is here:
          if (Array.isArray(json) && json.length > 0) {
            const last = json[json.length - 1];

            if (Array.isArray(last) && last[1]) {
              answer = last[1];
            } else if (typeof last === "string") {
              answer = last;
            }
          }
        } catch {}
      }
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: answer,
            },
          },
        ],
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
};