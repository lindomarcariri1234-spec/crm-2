export interface AiReplyAttempt {
  conversationId: string;
  content: string;
  idempotencyKey: string;
}

export function getAiReplyAttempt(
  current: AiReplyAttempt | null,
  conversationId: string,
  content: string,
  createKey: () => string,
): AiReplyAttempt {
  if (current?.conversationId === conversationId && current.content === content) return current;
  return { conversationId, content, idempotencyKey: createKey() };
}

export function shouldRetainAiReplyAttempt(status: number, code: string): boolean {
  if (code === "INSTAGRAM_DELIVERY_UNKNOWN" || code === "INSTAGRAM_DELIVERY_UNRESOLVED") {
    return true;
  }
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
