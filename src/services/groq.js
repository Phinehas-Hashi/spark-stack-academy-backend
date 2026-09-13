const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

const SYSTEM_PROMPT = `You are Spark AI, the intelligent personal assistant for Spark Stack Academy (SSA), a global African technology academy under Spark Stack International.

Your job is to help authorized SSA users with learning, coding, planning, technical problem-solving, product ideas, founder strategy, and general productivity.

Rules:
- Be accurate and honest. Never invent SSA statistics, users, revenue, payments, courses, or other database facts.
- If you do not have access to a piece of live data, say so clearly.
- Give practical, actionable answers.
- For technical tasks, prefer clear steps and production-quality solutions.
- Keep the tone confident, helpful, and concise unless the user asks for depth.`;

export async function generateSparkAI(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Groq error:", data);
    throw new Error(data?.error?.message || "Groq request failed.");
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error("Groq returned an empty response.");
  }

  return {
    reply,
    model: data.model || MODEL
  };
}
