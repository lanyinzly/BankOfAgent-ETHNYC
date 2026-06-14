// Upstream model.
//
// If UPSTREAM_BASE_URL + UPSTREAM_API_KEY are configured, forward the OpenAI-shaped
// request to that endpoint (this is where a real model — or a self-hosted new-api /
// QuantumNous gateway — plugs in). Otherwise fall back to a deterministic STUB echo
// model so the whole demo runs with no upstream and no API key.
//
// Design note: this relay is intentionally a lightweight, dependency-free
// reimplementation of the new-api (github.com/QuantumNous/new-api) relay idea
// (bearer-token auth + usage metering + OpenAI-compatible forwarding). We do NOT
// vendor the heavyweight Go service; point UPSTREAM_BASE_URL at one to use it.

import { estimateTokens, messagesToText, type ChatMessage } from "./metering.ts";

export interface UpstreamResult {
  // OpenAI-shaped chat.completion object to return to the caller
  response: Record<string, unknown>;
  completionText: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface CompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  [k: string]: unknown;
}

export class UpstreamModel {
  private baseUrl: string | null;
  private apiKey: string | null;

  constructor(baseUrl: string | null, apiKey: string | null) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  get isStub(): boolean {
    return !(this.baseUrl && this.apiKey);
  }

  async complete(req: CompletionRequest, requestId: string): Promise<UpstreamResult> {
    if (this.isStub) return this.stub(req, requestId);
    return this.forward(req, requestId);
  }

  private stub(req: CompletionRequest, requestId: string): UpstreamResult {
    const model = req.model || "boa-stub-echo";
    const promptText = messagesToText(req.messages);
    const lastUser =
      [...(req.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastUserText = typeof lastUser === "string" ? lastUser : JSON.stringify(lastUser);

    const content =
      `[BoA stub model] Received your request via the BoA relay. ` +
      `You said: "${lastUserText}". ` +
      `This is a stubbed completion — set UPSTREAM_BASE_URL + UPSTREAM_API_KEY to forward to a real model.`;

    const inputTokens = estimateTokens(promptText);
    const outputTokens = estimateTokens(content);

    const response = {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    };

    return { response, completionText: content, inputTokens, outputTokens, model };
  }

  // Normalize UPSTREAM_BASE_URL into the chat-completions endpoint, tolerating
  // common forms: ".../v1", root host, or a full ".../v1/chat/completions".
  private completionsUrl(): string {
    const b = this.baseUrl!.replace(/\/+$/, "");
    if (b.endsWith("/chat/completions")) return b;
    if (/\/v\d+$/.test(b)) return `${b}/chat/completions`;
    return `${b}/v1/chat/completions`;
  }

  private async forward(req: CompletionRequest, requestId: string): Promise<UpstreamResult> {
    const url = this.completionsUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream ${res.status} from ${url}: ${raw.slice(0, 500)}`);
    }
    if (!ct.includes("json") || raw.trimStart().startsWith("<")) {
      // Almost always means UPSTREAM_BASE_URL is wrong (hit the web UI, not the
      // OpenAI API). Give a clear hint instead of a JSON.parse stack trace.
      throw new Error(
        `upstream returned non-JSON (${ct || "?"}) from ${url} — check UPSTREAM_BASE_URL points at the OpenAI-compatible base (it should resolve to /v1/chat/completions). Body: ${raw.slice(0, 160)}`,
      );
    }
    const response = JSON.parse(raw) as Record<string, any>;
    const model = (response.model as string) || req.model || "upstream";
    const completionText = response?.choices?.[0]?.message?.content ?? "";
    const usage = response.usage ?? {};
    const inputTokens =
      usage.prompt_tokens ?? estimateTokens(messagesToText(req.messages));
    const outputTokens = usage.completion_tokens ?? estimateTokens(String(completionText));
    if (!response.id) response.id = requestId;
    return { response, completionText: String(completionText), inputTokens, outputTokens, model };
  }
}
