/**
 * AI Lab helpers (no React, so they can be unit-tested): which provider to use, what to send,
 * and how to describe a failure to the user. The request only carries what the user ticked.
 */
import { ApiError, type AiAnalyzeRequest, type AiImage, type AiProvider, type AiProviderId, type AiShare } from "./journalApi";
import type { Rule } from "./rules";

export const AI_PROVIDER_KEY = "elion.aiProvider";
export const MAX_AI_IMAGES = 4;
export const MAX_AI_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const NO_SHARE: AiShare = { rules: false, trades: false, mt5_account: false, market: false };

/** The saved choice if it is usable, else the first configured provider, else none. */
export function pickProvider(list: AiProvider[], preferred: string | null): AiProviderId | null {
  const usable = list.filter((p) => p.available);
  return (usable.find((p) => p.id === preferred) ?? usable[0])?.id ?? null;
}

export function buildAnalyzeRequest(o: {
  provider: AiProviderId;
  question: string;
  share: AiShare;
  accountId: number | null;
  rules: Rule[];
  images: AiImage[];
  symbol: string;
  timeframe: string;
}): AiAnalyzeRequest {
  return {
    provider: o.provider,
    question: o.question.trim(),
    // no account id at all unless something that needs one was shared
    account_id: o.share.trades || o.share.mt5_account || o.share.market ? o.accountId : null,
    share: { ...o.share },
    rules: o.share.rules ? o.rules.map(({ id, title, hint, status }) => ({ id, title, hint, status })) : [],
    images: o.images,
    symbol: o.symbol,
    timeframe: o.timeframe,
  };
}

export type AiFailureKind = "unavailable" | "timeout" | "offline" | "error";

export interface AiFailure {
  kind: AiFailureKind;
  message: string;
}

/** HTTP status (from journal/ai.py) -> what the chat should say. */
export function classifyAiError(e: unknown): AiFailure {
  if (e instanceof ApiError) {
    if (e.status === 503) return { kind: "unavailable", message: e.message };
    if (e.status === 504 || e.status === 408) return { kind: "timeout", message: e.status === 408 ? "The AI request took too long and was cancelled. Try again, or share less data." : e.message };
    if (e.status === 0) return { kind: "offline", message: e.message || "The journal server is not reachable." };
    return { kind: "error", message: e.message };
  }
  return { kind: "error", message: e instanceof Error ? e.message : "Unknown error" };
}

/** Checks a picked file before it is read; returns an error message or null. */
export function checkImageFile(f: { type: string; size: number }, alreadyAttached: number): string | null {
  if (alreadyAttached >= MAX_AI_IMAGES) return `At most ${MAX_AI_IMAGES} chart images per question.`;
  if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return "Only PNG, JPEG or WebP images can be sent.";
  if (f.size > MAX_AI_IMAGE_BYTES) return "That image is larger than 4 MB.";
  return null;
}

/** Reads an image the user picked into the base64 shape the endpoint expects. */
export function readImageFile(f: File): Promise<AiImage> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read the image."));
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve({ mime: f.type as AiImage["mime"], data: s.slice(s.indexOf(",") + 1), label: f.name.slice(0, 120) });
    };
    r.readAsDataURL(f);
  });
}

export const BIAS_COLOR: Record<string, string> = { bullish: "var(--e-up-2)", bearish: "#ef5a50", neutral: "var(--e-text-2)", unclear: "var(--e-text-3)" };
export const CHECK_ICON: Record<string, [string, string]> = {
  met: ["check_circle", "var(--e-up-2)"],
  not_met: ["cancel", "#ef5a50"],
  unclear: ["help", "#e2c089"],
  not_applicable: ["remove_circle", "var(--e-text-3)"],
};
