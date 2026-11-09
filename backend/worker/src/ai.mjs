const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

// Returns parsed JSON when `json` is true, otherwise plain text.
export async function generate(
  prompt,
  { json = false, system, timeoutMs = 60_000, maxTokens, temperature } = {},
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      ...((json || maxTokens || temperature != null) && {
        generationConfig: {
          ...(json && { responseMimeType: "application/json" }),
          ...(maxTokens && { maxOutputTokens: maxTokens }),
          ...(temperature != null && { temperature }),
        },
      }),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `Gemini ${res.status}: ${body.error?.message ?? res.statusText}`,
    );
  const text =
    body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  return json ? JSON.parse(text) : text;
}
