import type { Env } from "./types";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "./search/fetch";

type ChatMessage = { role: "system" | "user"; content: string };

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

// Free/small models sometimes wrap JSON in markdown fences or add preamble text.
// Be tolerant: strip fences, then fall back to the largest {...} substring.
export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through to fence / substring extraction
  }
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    // fall through
  }
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  }
  throw new Error("Model returned output that is not valid JSON");
}

export async function completeJson(
  messages: ChatMessage[],
  env: Env,
): Promise<unknown> {
  const apiKey = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY");
  const baseUrl = (
    env.OPENAI_BASE_URL ||
    (env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  const primaryModel = env.OPENROUTER_MODEL || env.OPENAI_MODEL ||
    (env.OPENROUTER_API_KEY ? "google/gemini-3.1-flash-lite" : "openai/gpt-4o-mini");
  const fallbackModel = env.OPENROUTER_FALLBACK_MODEL || (env.OPENROUTER_API_KEY ? "openai/gpt-4.1-mini" : undefined);
  const timeoutMs = parseTimeoutMs(env.MODEL_TIMEOUT_MS, 25000);
  const requestModel = (model: string) =>
    fetchWithRateLimitRetry(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages,
        }),
      },
      { retries: 0, timeoutMs },
    );

  let model = primaryModel;
  let response: Response;
  let networkError: unknown;
  try {
    response = await requestModel(model);
  } catch (error) {
    networkError = error;
    if (!fallbackModel || fallbackModel === primaryModel) throw error;
    model = fallbackModel;
    response = await requestModel(model);
  }

  const retryableStatus = response.status === 404 || response.status === 429 || response.status >= 500;
  if (retryableStatus && fallbackModel && fallbackModel !== primaryModel && !networkError) {
    model = fallbackModel;
    response = await requestModel(model);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Model API (${model}) returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model API returned an empty completion");
  return parseModelJson(content);
}
