// src/aimaster-bridge.js
export async function getAITradingDecision(env, context) {
  if (env.AIMASTER_STRATEGY_URL) {
    try {
      const resp = await fetch(env.AIMASTER_STRATEGY_URL + "/analyze", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify(context), signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) return await resp.json();
    } catch (_) {}
  }
  return await callDeepSeekDirect(env, context);
}
async function callDeepSeekDirect(env, context) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return { recommendation:"skip", confidence:0, reasoning:"DeepSeek not configured" };
  const system = "You are an expert arbitrage trading AI. Respond in JSON only.";
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method:"POST", headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body: JSON.stringify({ model:"deepseek-chat", messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(context)}], temperature:0.3, max_tokens:500 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) return { recommendation:"skip", confidence:0, reasoning:"API error "+resp.status };
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseAIResponse(content);
}
function parseAIResponse(text) {
  try { const m = text.match(/\{[^}]+\}/); if (m) return JSON.parse(m[0]); }
  catch (_) {}
  return { recommendation:"skip", confidence:0, reasoning:text.substring(0,200) };
}
