import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Send, MessageCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { useBroadcastTripWhatsApp } from "@workspace/api-client-react";
import type { BoardingPassenger, FreePassenger } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_CONFIRMED =
  "✅ Olá, {nome}! Sua reserva na viagem *{viagem}* foi confirmada. Partida em *{data}*. Referência: *{referencia}*. Qualquer dúvida, fale com {agencia}.";
const DEFAULT_BOARDING =
  "🚌 Olá, {nome}! Lembrete: sua viagem para *{viagem}* é amanhã, *{data}*. Local de embarque: *{local_saida}*. Boa viagem! {agencia}";

type FilterOption = "all" | "confirmed" | "pending";
type MessageType = "confirmed" | "boarding" | "custom";

const FILTER_LABELS: Record<FilterOption, string> = {
  all: "Todos (exceto cancelados)",
  confirmed: "Somente confirmados",
  pending: "Somente pendentes",
};

const VARIABLES = [
  { key: "{nome}", desc: "Nome do passageiro" },
  { key: "{viagem}", desc: "Nome da viagem" },
  { key: "{data}", desc: "Data de partida" },
  { key: "{referencia}", desc: "Número da reserva / voucher" },
  { key: "{agencia}", desc: "Nome da agência" },
  { key: "{local_saida}", desc: "Local de embarque" },
];

interface WhatsAppBroadcastModalProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  passengers: BoardingPassenger[];
  freePassengers: FreePassenger[];
}

function countWithPhone(passengers: BoardingPassenger[], freePassengers: FreePassenger[]): number {
  const passengerCount = passengers.filter(p => !!(p.passengerPhone || p.whatsapp || p.phone)).length;
  const freeCount = freePassengers.filter(fp => !!fp.whatsapp?.trim()).length;
  return passengerCount + freeCount;
}

export function WhatsAppBroadcastModal({
  open,
  onClose,
  tripId,
  passengers,
  freePassengers,
}: WhatsAppBroadcastModalProps) {
  const { toast } = useToast();
  const [messageType, setMessageType] = useState<MessageType>("confirmed");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_CONFIRMED);
  const [result, setResult] = useState<{ queued: number; skipped: number } | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Fetch tenant WhatsApp notification settings to pre-fill templates
  useEffect(() => {
    if (!open || settingsLoaded) return;
    void (async () => {
      try {
        const resp = await fetch("/api/whatsapp-notifications/settings");
        if (resp.ok) {
          const data = await resp.json() as {
            reservationConfirmedMessage?: string | null;
            boardingReminderMessage?: string | null;
          };
          if (messageType === "confirmed") {
            setMessageTemplate(data.reservationConfirmedMessage?.trim() || DEFAULT_CONFIRMED);
          } else if (messageType === "boarding") {
            setMessageTemplate(data.boardingReminderMessage?.trim() || DEFAULT_BOARDING);
          }
        }
      } catch {
        // ignore — defaults are fine
      } finally {
        setSettingsLoaded(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleTypeChange = (type: MessageType) => {
    setMessageType(type);
    setResult(null);
    if (type === "confirmed") setMessageTemplate(DEFAULT_CONFIRMED);
    else if (type === "boarding") setMessageTemplate(DEFAULT_BOARDING);
    else setMessageTemplate("");
  };

  const broadcast = useBroadcastTripWhatsApp();

  const totalWithPhone = countWithPhone(passengers, freePassengers);

  const handleSend = async () => {
    if (!messageTemplate.trim()) {
      toast({ title: "Escreva uma mensagem antes de enviar", variant: "destructive" });
      return;
    }
    try {
      const res = await broadcast.mutateAsync({
        id: tripId,
        data: { messageTemplate: messageTemplate.trim(), filter },
      });
      setResult(res);
    } catch {
      toast({ title: "Erro ao enviar mensagens", description: "Verifique as configurações de WhatsApp e tente novamente.", variant: "destructive" });
    }
  };

  const handleClose = () => {
    setResult(null);
    setSettingsLoaded(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-600" />
            Enviar WhatsApp para passageiros
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border bg-green-50 p-5 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <div>
                <p className="text-lg font-semibold text-green-800">Mensagens enviadas!</p>
                <p className="text-sm text-green-700 mt-1">
                  <span className="font-bold">{result.queued}</span> mensagem(ns) enfileirada(s)
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground"> · {result.skipped} ignorada(s) (sem telefone)</span>
                  )}
                </p>
              </div>
            </div>
            {result.skipped > 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Passageiros sem WhatsApp/telefone cadastrado foram ignorados.</span>
              </div>
            )}
            <Button className="w-full" variant="outline" onClick={handleClose}>Fechar</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Message type */}
            <div className="space-y-1.5">
              <Label>Tipo de mensagem</Label>
              <Select value={messageType} onValueChange={v => handleTypeChange(v as MessageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">✅ Confirmação de reserva</SelectItem>
                  <SelectItem value="boarding">🚌 Lembrete de embarque</SelectItem>
                  <SelectItem value="custom">✏️ Mensagem livre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Template editor */}
            <div className="space-y-1.5">
              <Label>Mensagem</Label>
              <Textarea
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                rows={5}
                placeholder="Digite a mensagem aqui..."
                className="resize-none font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Variáveis disponíveis:{" "}
                {VARIABLES.map(v => (
                  <span
                    key={v.key}
                    title={v.desc}
                    className="inline-block bg-muted rounded px-1 py-0.5 font-mono text-xs mr-1 mb-0.5 cursor-help"
                  >
                    {v.key}
                  </span>
                ))}
              </p>
            </div>

            {/* Recipient filter */}
            <div className="space-y-1.5">
              <Label>Destinatários</Label>
              <Select value={filter} onValueChange={v => setFilter(v as FilterOption)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(FILTER_LABELS) as [FilterOption, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{totalWithPhone}</span> de {passengers.length} passageiro(s) têm telefone cadastrado — o filtro de status é aplicado pelo servidor
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose} disabled={broadcast.isPending}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleSend}
                disabled={broadcast.isPending || !messageTemplate.trim() || totalWithPhone === 0}
              >
                {broadcast.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" />Enviar mensagens</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
