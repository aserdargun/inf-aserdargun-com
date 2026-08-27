import { describe, expect, it, vi } from "vitest";
import { OpenAiService } from "../src/services/openai-service.js";

const samplePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function buildResponse(body: unknown, status = 200, headers: Record<string, string> = { "content-type": "application/json" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const baseOptions = (fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof OpenAiService>[0]> = {}) => ({
  apiKey: "sk-test-1234567890abcdef",
  model: "gpt-4o-mini",
  timeoutMs: 1_000,
  fetchImpl,
  now: () => new Date("2026-08-24T08:00:00.000Z"),
  ...overrides,
});

describe("OpenAiService", () => {
  it("posts the image as a data url and parses the suggestion envelope", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "chatcmpl-1",
      model: "gpt-4o-mini-2025-01-01",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify({
          title: "  Spaced title  ",
          notes: "Concise notes.",
          language: "en",
          category: "GPU",
          topics: ["ai", "policy"],
          rationale: "Visible headline + handle.",
          confidence: 0.92,
        }) },
      }],
    })) as unknown as typeof fetch;

    const service = new OpenAiService(baseOptions(fetchImpl));
    const response = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png", filename: "x.png" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-1234567890abcdef");
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string; content: unknown }>; response_format: { type: string } };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    const user = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(user[0].type).toBe("text");
    expect(user[1].type).toBe("image_url");
    expect(user[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(user[0].text).toBe(`Analyse this infographic and return the metadata JSON. The file was uploaded as "x.png".`);
    // The system prompt must require at least one topic so the Library never
    // lands an item with no tags because the model chose to omit the field.
    expect(user[0].text).toBeDefined();
    const systemText = (body.messages[0].content as string);
    expect(systemText).toMatch(/topics:\s*1-5/);

    expect(response.schemaVersion).toBe(1);
    expect(response.model).toBe("gpt-4o-mini-2025-01-01");
    expect(response.generatedAt).toBe("2026-08-24T08:00:00.000Z");
    expect(response.suggestion.title).toBe("Spaced title");
    expect(response.suggestion.notes).toBe("Concise notes.");
    expect(response.suggestion.language).toBe("en");
    expect(response.suggestion.category).toBe("GPU");
    expect(response.suggestion.topics).toEqual(["ai", "policy"]);
    expect(response.suggestion.rationale).toBe("Visible headline + handle.");
    expect(response.suggestion.confidence).toBe(0.92);
  });

  it("includes existing categories in the user prompt and reuses an existing label when the model picks one", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "chatcmpl-3",
      model: "gpt-4o-mini-2025-01-01",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        title: "GPU memory layout", notes: "VRAM hierarchy.", sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
        language: "en", category: "GPU", topics: ["memory"], rationale: "Existing label reused.", confidence: 0.88,
      }) } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const response = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png", existingCategories: ["GPU", "CPU", "Memory"] });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> | string }> };
    const userText = (body.messages[1].content as Array<{ type: string; text?: string }>)[0]!.text;
    expect(userText).toContain("Existing library categories:");
    expect(userText).toContain('["GPU","CPU","Memory"]');
    expect(response.suggestion.category).toBe("GPU");
  });

  it("treats a missing or empty category in the model output as null", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "chatcmpl-4", model: "gpt-4o-mini-2025-01-01",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        title: "Loose notes", notes: "no category", sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
        language: "en", category: "", topics: [], rationale: "skip", confidence: 0.5,
      }) } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const response = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(response.suggestion.category).toBeNull();
  });

  it("returns 422-equivalent AppError when the model refuses", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "chatcmpl-2",
      model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "", refusal: "I cannot help with that." } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_REFUSAL", status: 422 });
  });

  it("returns 429-equivalent AppError when the model is rate limited", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({ error: "rate limited" }, 429)) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_RATE_LIMITED", status: 429 });
  });

  it("returns 504-equivalent AppError when the request times out", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl, { timeoutMs: 10 }));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_TIMEOUT", status: 504 });
  });

  it("rejects unsupported mime types before calling OpenAI", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/avif" })).rejects.toMatchObject({ code: "UNSUPPORTED_MIME", status: 415 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversize payloads before calling OpenAI", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const huge = Buffer.alloc(8 * 1024 * 1024 + 1, 1);
    await expect(service.suggestMetadata({ bytes: huge, declaredMime: "image/png" })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE", status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 502-equivalent AppError when the model returns malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "not-json" } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_BAD_JSON", status: 502 });
  });

  it("returns 502-equivalent AppError when fields fail validation after coercion", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        title: "ok", notes: "ok", language: "en", category: "ai", topics: ["x".repeat(81)],
        rationale: "ok", confidence: 0.5,
      }) } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_BAD_SHAPE", status: 502 });
  });

  it("strips a markdown code fence before parsing the model JSON", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "```json\n" + JSON.stringify({
        title: "Markdown-wrapped title",
        notes: "Notes survive the fence.",
        language: "en",
        category: "AI",
        topics: ["ai"],
        rationale: "Visible.",
        confidence: 0.81,
      }) + "\n```" } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.title).toBe("Markdown-wrapped title");
    expect(result.suggestion.confidence).toBe(0.81);
  });

  it("extracts JSON embedded in stray prose", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: 'Sure! Here you go:\n{"title":"Embedded","notes":"notes","sourceUrl":null,"sourcePlatform":null,"sourceAuthor":null,"language":null,"category":null,"topics":[],"rationale":"because","confidence":0.7}\nThanks.' } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.title).toBe("Embedded");
    expect(result.suggestion.confidence).toBe(0.7);
  });

  it("coerces word-form confidence values into a numeric 0-1 score", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        title: "Word-confidence title",
        notes: null,
        language: null,
        category: null,
        topics: [],
        rationale: null,
        confidence: "High",
      }) } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.confidence).toBe(0.9);
  });

  it("drops empty string fields and falls back to defaults instead of failing validation", async () => {
    const fetchImpl = vi.fn(async () => buildResponse({
      id: "x", model: "gpt-4o-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        title: "  ",
        notes: "",
        language: null,
        category: null,
        topics: ["  ", "ai", ""],
        rationale: null,
        confidence: 0.5,
      }) } }],
    })) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.title).toBeNull();
    expect(result.suggestion.notes).toBeNull();
    expect(result.suggestion.topics).toEqual(["ai"]);
  });

  it("retries transient upstream errors once and then succeeds", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return new Response(JSON.stringify({ error: "boom" }), { status: 503, headers: { "content-type": "application/json" } });
      return buildResponse({
        id: "x", model: "gpt-4o-mini",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
          title: "Recovered title",
          notes: null,
          language: null,
          category: null,
          topics: [],
          rationale: null,
          confidence: 0.5,
        }) } }],
      });
    }) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.title).toBe("Recovered title");
    expect(callCount).toBe(2);
  });

  it("retries when the first response is malformed JSON, then succeeds", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return buildResponse({
        id: "x", model: "gpt-4o-mini",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "not json" } }],
      });
      return buildResponse({
        id: "x", model: "gpt-4o-mini",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
          title: "Recovered", notes: null, sourceUrl: null, sourcePlatform: null, sourceAuthor: null,
          language: null, category: null, topics: [], rationale: null, confidence: 0.4,
        }) } }],
      });
    }) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    const result = await service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" });
    expect(result.suggestion.title).toBe("Recovered");
    expect(callCount).toBe(2);
  });

  it("does not retry on permanent errors like a 4xx bad request", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: "bad" }), { status: 400, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_BAD_REQUEST" });
    expect(callCount).toBe(1);
  });

  it("does not retry on AI_REFUSAL", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      return buildResponse({
        id: "x", model: "gpt-4o-mini",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", refusal: "I cannot help with that.", content: "" } }],
      });
    }) as unknown as typeof fetch;
    const service = new OpenAiService(baseOptions(fetchImpl));
    await expect(service.suggestMetadata({ bytes: samplePng, declaredMime: "image/png" })).rejects.toMatchObject({ code: "AI_REFUSAL" });
    expect(callCount).toBe(1);
  });

  it("rejects construction with a too-short api key", () => {
    expect(() => new OpenAiService({ apiKey: "short" })).toThrow();
  });
});
