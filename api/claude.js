export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = req.headers["x-api-key"];
  if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("sk-ant-")) {
    res.status(401).json({ error: "Missing or invalid Anthropic API key. Add yours in the app's Settings tab." });
    return;
  }

  const { max_tokens, system, messages, webSearch } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "Missing messages" });
    return;
  }

  const body = {
    model: "claude-sonnet-4-5-20250929",
    max_tokens: max_tokens || 1000,
    system,
    messages,
  };
  if (webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: `Could not reach Anthropic: ${e.message}` });
  }
}
