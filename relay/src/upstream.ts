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

// Flatten an Anthropic Messages request (system + messages, string or blocks)
// into plain text for token estimation in stub mode.
function anthropicInputText(req: CompletionRequest): string {
  const parts: string[] = [];
  const sys = (req as any).system;
  if (typeof sys === "string") parts.push(sys);
  else if (Array.isArray(sys)) parts.push(sys.map((b: any) => b?.text ?? "").join("\n"));
  for (const m of req.messages ?? []) {
    if (typeof m.content === "string") parts.push(m.content);
    else if (Array.isArray(m.content))
      parts.push(m.content.map((b: any) => (typeof b === "string" ? b : (b?.text ?? JSON.stringify(b)))).join("\n"));
  }
  return parts.join("\n");
}

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

  // Anthropic-native Messages API (POST /v1/messages).
  async messages(req: CompletionRequest, requestId: string): Promise<UpstreamResult> {
    if (this.isStub) return this.stubMessages(req, requestId);
    return this.forwardMessages(req, requestId);
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

  // ---- Anthropic Messages API ----

  private messagesUrl(): string {
    const b = this.baseUrl!.replace(/\/+$/, "");
    if (b.endsWith("/messages")) return b;
    if (/\/v\d+$/.test(b)) return `${b}/messages`;
    return `${b}/v1/messages`;
  }

  private stubMessages(req: CompletionRequest, requestId: string): UpstreamResult {
    const model = req.model || "boa-stub-anthropic";
    const promptText = anthropicInputText(req);
    const lastUser = [...(req.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastUserText = typeof lastUser === "string" ? lastUser : JSON.stringify(lastUser);
    const text =
      `[BoA stub model] Received your Anthropic-format request via the BoA relay. ` +
      `You said: "${lastUserText}". Set UPSTREAM_BASE_URL + UPSTREAM_API_KEY to forward to a real model.`;

    const inputTokens = estimateTokens(promptText);
    const outputTokens = estimateTokens(text);
    const response = {
      id: "msg_" + requestId,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
    return { response, completionText: text, inputTokens, outputTokens, model };
  }

  private async forwardMessages(req: CompletionRequest, requestId: string): Promise<UpstreamResult> {
    const url = this.messagesUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
        authorization: `Bearer ${this.apiKey}`, // some gateways (e.g. new-api) accept either
      },
      body: JSON.stringify(req),
    });
    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream ${res.status} from ${url}: ${raw.slice(0, 500)}`);
    }
    if (!ct.includes("json") || raw.trimStart().startsWith("<")) {
      throw new Error(
        `upstream returned non-JSON (${ct || "?"}) from ${url} — check UPSTREAM_BASE_URL points at the base (it should resolve to /v1/messages). Body: ${raw.slice(0, 160)}`,
      );
    }
    const response = JSON.parse(raw) as Record<string, any>;
    const model = (response.model as string) || req.model || "upstream";
    const completionText = Array.isArray(response.content)
      ? response.content.map((b: any) => b?.text ?? "").join("")
      : "";
    const usage = response.usage ?? {};
    const inputTokens = usage.input_tokens ?? estimateTokens(anthropicInputText(req));
    const outputTokens = usage.output_tokens ?? estimateTokens(completionText);
    if (!response.id) response.id = "msg_" + requestId;
    return { response, completionText, inputTokens, outputTokens, model };
  }
}
