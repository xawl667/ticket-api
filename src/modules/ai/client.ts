// DeepSeek API client
import { env } from "../../config/env.js";

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface DeepSeekChoice {
  index: number;
  message: DeepSeekMessage;
  finish_reason: string | null;
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface DeepSeekError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

/**
 * Calls the DeepSeek chat completions API.
 * @param messages - Array of messages (system, user, assistant)
 * @param options - Optional parameters: temperature, max_tokens
 * @returns The assistant's response content
 * @throws Error if the API call fails, times out, or returns an error
 */
export async function callDeepSeek(
  messages: DeepSeekMessage[],
  options: { temperature?: number; max_tokens?: number } = {}
): Promise<string> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const baseUrl = env.AI_BASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  const requestBody: DeepSeekRequest = {
    model: env.AI_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1000,
    stream: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      // Log error without request body (no sensitive data)
      console.error(
        `[DeepSeek API Error] Status: ${response.status}, Body: ${JSON.stringify(errorBody)}`
      );
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = (await response.json()) as DeepSeekResponse | DeepSeekError;

    // Check for API error response
    if ("error" in data) {
      console.error(`[DeepSeek API Error] ${data.error.message}`);
      throw new Error(`DeepSeek API error: ${data.error.message}`);
    }

    const content = data.choices[0]?.message?.content?.trim();
    if (content === undefined || content === null) {
      throw new Error("Empty response from DeepSeek");
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error) {
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        console.error("[DeepSeek API] Request timeout");
        throw new Error("DeepSeek API timeout");
      }
      // Re-throw other errors (including our custom ones)
      throw err;
    }
    throw new Error("Unknown error calling DeepSeek API");
  }
}

/**
 * Filter call: strict classification with temperature 0 and very low max_tokens.
 * Returns "IT" or "NOT_IT". Any other output, timeout, or error = throw (fail closed).
 */
export async function filterQuestion(question: string): Promise<"IT" | "NOT_IT"> {
  const messages: DeepSeekMessage[] = [
    { role: "system", content: FILTER_SYSTEM_PROMPT },
    { role: "user", content: createFilterUserPrompt(question) },
  ];

  const response = await callDeepSeek(messages, {
    temperature: 0,
    max_tokens: 5, // Very low - we only need "IT" or "NOT_IT"
  });

  const normalized = response.trim().toUpperCase();
  if (normalized === "IT") return "IT";
  if (normalized === "NOT_IT") return "NOT_IT";

  // Fail closed: any unexpected output = refusal
  console.error(`[DeepSeek Filter] Unexpected output: "${response}"`);
  throw new Error("Filter returned unexpected output");
}

/**
 * Answer call: full response with IT support system prompt.
 * Only called after filter returns "IT".
 */
export async function answerQuestion(question: string): Promise<string> {
  const messages: DeepSeekMessage[] = [
    { role: "system", content: ANSWER_SYSTEM_PROMPT },
    { role: "user", content: createAnswerUserPrompt(question) },
  ];

  // Use a reasonable max_tokens for the answer
  return callDeepSeek(messages, {
    temperature: 0.3,
    max_tokens: 1000,
  });
}

// Re-export prompts for use in client
import { FILTER_SYSTEM_PROMPT, ANSWER_SYSTEM_PROMPT, createFilterUserPrompt, createAnswerUserPrompt } from "./prompts.js";