import type { FormEvent } from "react";

export type InboxMessageChannel = "email" | "whatsapp";
export type InboxMessageClientLinkStatus =
  | "checking"
  | "valid"
  | "missing"
  | "unavailable";

export interface InboxMessageToast {
  title: string;
  description?: string;
  variant?: "destructive";
}

export interface SubmitInboxMessageOptions {
  event: FormEvent<HTMLFormElement>;
  selectedClientId: string | null;
  message: string;
  channel: InboxMessageChannel;
  clientLinkStatus: InboxMessageClientLinkStatus;
  whatsappOptedOut: boolean;
  sendMessage: (input: {
    data: {
      toClientId: string;
      channel: InboxMessageChannel;
      content: string;
    };
  }) => Promise<unknown>;
  setInboxMessage: (message: string) => void;
  refetchMessages: () => unknown;
  refetchOutboundMessages: () => unknown;
  toast: (input: InboxMessageToast) => unknown;
}

export async function submitInboxMessage({
  event,
  selectedClientId,
  message,
  channel,
  clientLinkStatus,
  whatsappOptedOut,
  sendMessage,
  setInboxMessage,
  refetchMessages,
  refetchOutboundMessages,
  toast,
}: SubmitInboxMessageOptions): Promise<void> {
  event.preventDefault();
  if (!selectedClientId || !message.trim()) return;
  if (clientLinkStatus !== "valid") {
    toast({
      title: "Envio bloqueado",
      description: clientLinkStatus === "missing"
        ? "Associe este histórico a um cliente válido antes de enviar."
        : "Aguarde a confirmação do vínculo do cliente antes de enviar.",
      variant: "destructive",
    });
    return;
  }
  if (channel === "whatsapp" && whatsappOptedOut) {
    toast({
      title: "WhatsApp indisponível para esta conversa",
      description: "O contato pediu para não receber novas mensagens por este canal.",
      variant: "destructive",
    });
    return;
  }
  try {
    await sendMessage({
      data: {
        toClientId: selectedClientId,
        channel,
        content: message,
      },
    });
    setInboxMessage("");
    await Promise.all([refetchMessages(), refetchOutboundMessages()]);
  } catch (error) {
    toast({
      title: "Não foi possível enviar a mensagem.",
      description: error instanceof Error ? error.message : "Tente novamente.",
      variant: "destructive",
    });
  }
}
