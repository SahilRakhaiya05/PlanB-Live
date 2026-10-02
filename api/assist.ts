const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

const SYSTEM = [
  "You are Pip, a small stage assistant inside PlanB Live.",
  "Use only the FACTS json. Do not invent rooms, times, sessions, costs, or check results.",
  "The solver decides. You only explain.",
  "If calculated is false, say the alternatives have not been calculated yet.",
  "If a status is INFEASIBLE, say no valid schedule exists. Do not propose a timetable of your own.",
  "If a status is SEARCH_LIMIT, say the search stopped. Do not call that impossible.",
  "Nothing is sent to attendees. Approval is local.",
  "Answer in under 90 words, in plain sentences.",
].join(" ");

export interface AssistTurn {
  role: "user" | "model";
  text: string;
}

export async function explainWithGemini(message: string, history: AssistTurn[], facts: unknown): Promise<{ ok: true; reply: string; model: string } | { ok: false; error: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "Pip is off because no model key is configured. The schedule solver still works." };

  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: `FACTS:\n${JSON.stringify(facts)}\n\nQUESTION:\n${message}` }] },
  ];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 18_000);
  try {
    let lastStatus = 0;
    for (const model of MODELS) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
        }),
        signal: ctl.signal,
      });
      if (res.status === 429 || res.status === 503) { lastStatus = res.status; continue; }
      if (!res.ok) return { ok: false, error: `The model did not answer (${res.status}). The schedule was not changed.` };
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (text) return { ok: true, reply: text.slice(0, 1200), model };
    }
    return { ok: false, error: lastStatus ? "The model is busy right now. The schedule was not changed." : "The model returned no words. The schedule was not changed." };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: "The model took too long. The schedule was not changed." };
    return { ok: false, error: "Could not reach the model. The schedule was not changed." };
  } finally {
    clearTimeout(timer);
  }
}
