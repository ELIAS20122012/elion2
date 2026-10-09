import { describe, expect, it } from "vitest";
import { buildAnalyzeRequest, checkImageFile, classifyAiError, NO_SHARE, pickProvider } from "./aiLab";
import { ApiError, type AiProvider } from "./journalApi";

const P = (id: "gemini" | "claude", available: boolean): AiProvider => ({ id, label: id, model: "m", available, reason: available ? null : "key missing" });
const RULE = { id: "divergence", title: "Regular divergence", hint: "two highs", status: "teaching" as const, ready: true };

describe("provider selection", () => {
  it("keeps the saved provider when it is configured", () => {
    expect(pickProvider([P("gemini", true), P("claude", true)], "claude")).toBe("claude");
  });
  it("falls back to a configured provider when the saved one has no key", () => {
    expect(pickProvider([P("gemini", true), P("claude", false)], "claude")).toBe("gemini");
  });
  it("returns none when no provider is configured", () => {
    expect(pickProvider([P("gemini", false), P("claude", false)], "gemini")).toBeNull();
    expect(pickProvider([], null)).toBeNull();
  });
});

describe("analyze request", () => {
  const base = { provider: "gemini" as const, question: "  valid?  ", accountId: 7, rules: [RULE], images: [], symbol: "XAUUSD", timeframe: "H1" };

  it("sends nothing the user did not share", () => {
    const r = buildAnalyzeRequest({ ...base, share: NO_SHARE });
    expect(r.rules).toEqual([]);
    expect(r.account_id).toBeNull();
    expect(r.share).toEqual(NO_SHARE);
    expect(r.question).toBe("valid?");
  });
  it("includes rules and the account only when shared", () => {
    const r = buildAnalyzeRequest({ ...base, share: { ...NO_SHARE, rules: true, trades: true } });
    expect(r.rules).toEqual([{ id: "divergence", title: "Regular divergence", hint: "two highs", status: "teaching" }]);
    expect(r.account_id).toBe(7);
  });
});

describe("AI Lab error states", () => {
  it("missing key / provider off -> unavailable", () => {
    expect(classifyAiError(new ApiError("Gemini is not configured: set GEMINI_API_KEY", 503))).toEqual({ kind: "unavailable", message: "Gemini is not configured: set GEMINI_API_KEY" });
  });
  it("server-side and client-side timeouts -> timeout", () => {
    expect(classifyAiError(new ApiError("Gemini did not answer within 60 s.", 504)).kind).toBe("timeout");
    expect(classifyAiError(new ApiError("The request timed out.", 408)).kind).toBe("timeout");
  });
  it("journal server down -> offline", () => {
    expect(classifyAiError(new ApiError("down", 0)).kind).toBe("offline");
  });
  it("provider/format errors -> error with the server's message", () => {
    expect(classifyAiError(new ApiError("Gemini returned HTTP 429: quota", 502))).toEqual({ kind: "error", message: "Gemini returned HTTP 429: quota" });
    expect(classifyAiError(new Error("boom")).kind).toBe("error");
  });
});

describe("chart image approval", () => {
  it("accepts small PNG/JPEG/WebP", () => {
    expect(checkImageFile({ type: "image/png", size: 1000 }, 0)).toBeNull();
  });
  it("rejects other types, big files and a fifth image", () => {
    expect(checkImageFile({ type: "image/gif", size: 10 }, 0)).toMatch(/PNG/);
    expect(checkImageFile({ type: "image/png", size: 5 * 1024 * 1024 }, 0)).toMatch(/4 MB/);
    expect(checkImageFile({ type: "image/png", size: 10 }, 4)).toMatch(/At most 4/);
  });
});
