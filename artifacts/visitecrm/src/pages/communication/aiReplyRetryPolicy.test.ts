import { describe, expect, it, vi } from "vitest";
import {
  getAiReplyAttempt,
  shouldRetainAiReplyAttempt,
} from "./aiReplyRetryPolicy";

describe("AI inbox reply retry policy", () => {
  it("reuses the idempotency key for the same draft and rotates it when text changes", () => {
    const createKey = vi.fn()
      .mockReturnValueOnce("attempt-1")
      .mockReturnValueOnce("attempt-2")
      .mockReturnValueOnce("attempt-3");
    const first = getAiReplyAttempt(null, "conversation-1", "Olá", createKey);
    const retry = getAiReplyAttempt(first, "conversation-1", "Olá", createKey);
    const edited = getAiReplyAttempt(retry, "conversation-1", "Olá, tudo bem?", createKey);
    const differentConversation = getAiReplyAttempt(first, "conversation-2", "Olá", createKey);

    expect(retry).toBe(first);
    expect(edited).toEqual({
      conversationId: "conversation-1",
      content: "Olá, tudo bem?",
      idempotencyKey: "attempt-2",
    });
    expect(differentConversation).toEqual({
      conversationId: "conversation-2",
      content: "Olá",
      idempotencyKey: "attempt-3",
    });
    expect(createKey).toHaveBeenCalledTimes(3);
  });

  it("keeps the key when the result may be ambiguous or transient", () => {
    expect(shouldRetainAiReplyAttempt(502, "INSTAGRAM_DELIVERY_UNKNOWN")).toBe(true);
    expect(shouldRetainAiReplyAttempt(409, "INSTAGRAM_DELIVERY_UNRESOLVED")).toBe(true);
    expect(shouldRetainAiReplyAttempt(503, "UPSTREAM_UNAVAILABLE")).toBe(true);
    expect(shouldRetainAiReplyAttempt(429, "RATE_LIMITED")).toBe(true);
  });

  it("clears the key for a definitive rejection", () => {
    expect(shouldRetainAiReplyAttempt(422, "WHATSAPP_DELIVERY_FAILED")).toBe(false);
    expect(shouldRetainAiReplyAttempt(403, "WHATSAPP_OPTED_OUT")).toBe(false);
    expect(shouldRetainAiReplyAttempt(400, "VALIDATION_ERROR")).toBe(false);
  });
});
