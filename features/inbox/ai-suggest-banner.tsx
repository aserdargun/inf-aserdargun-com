"use client";

import type { AiMetadataSuggestion } from "@inf/contracts";
import { Sparkles, X } from "lucide-react";

export type AiRowStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; suggestion: AiMetadataSuggestion }
  | { kind: "error"; message: string };

interface AiSuggestBannerProps {
  status: AiRowStatus;
  onApply: (suggestion: AiMetadataSuggestion) => void;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function AiSuggestBanner({ status, onApply, onDismiss, onRetry }: AiSuggestBannerProps) {
  if (status.kind === "idle") return null;
  if (status.kind === "loading") {
    return <div aria-live="polite" className="ai-banner ai-banner--loading" role="status">
      <Sparkles aria-hidden="true" size={18} strokeWidth={1.75} />
      <div className="ai-banner__body"><strong>AI is drafting metadata for this image…</strong><span>This usually takes a few seconds.</span></div>
    </div>;
  }
  if (status.kind === "ready") {
    const { suggestion } = status;
    const filled = [suggestion.title, suggestion.sourceUrl, suggestion.sourcePlatform, suggestion.sourceAuthor, suggestion.notes].filter((value) => typeof value === "string" && value.length > 0).length;
    const ratio = Math.round((suggestion.confidence ?? 0) * 100);
    return <div aria-live="polite" className="ai-banner ai-banner--ready" role="status">
      <Sparkles aria-hidden="true" size={18} strokeWidth={1.75} />
      <div className="ai-banner__body">
        <strong>AI suggested {filled} field{filled === 1 ? "" : "s"}.</strong>
        {suggestion.rationale ? <span>{suggestion.rationale}</span> : null}
        <span className="ai-banner__meta">confidence {ratio}%</span>
        <div className="ai-banner__actions">
          <button className="button button--primary" onClick={() => onApply(suggestion)} type="button">Apply AI</button>
          {onRetry ? <button className="button button--quiet" onClick={onRetry} type="button">Try again</button> : null}
        </div>
      </div>
      <button aria-label="Discard AI suggestion" className="ai-banner__dismiss" onClick={onDismiss} type="button"><X aria-hidden="true" size={16} strokeWidth={1.75} /></button>
    </div>;
  }
  return <div aria-live="polite" className="ai-banner ai-banner--error" role="status">
    <Sparkles aria-hidden="true" size={18} strokeWidth={1.75} />
    <div className="ai-banner__body">
      <strong>AI suggestion unavailable.</strong>
      <span>{status.message}</span>
      {onRetry ? <div className="ai-banner__actions"><button className="button button--quiet" onClick={onRetry} type="button">Try again</button></div> : null}
    </div>
    <button aria-label="Dismiss AI suggestion" className="ai-banner__dismiss" onClick={onDismiss} type="button"><X aria-hidden="true" size={16} strokeWidth={1.75} /></button>
  </div>;
}
