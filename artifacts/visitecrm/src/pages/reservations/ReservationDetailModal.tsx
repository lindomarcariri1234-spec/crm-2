import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useGetReservation, useListPayments } from "@workspace/api-client-react";
import { PAYMENT_STATUS } from "@workspace/permissions";
import { useToast } from "@/hooks/use-toast";
import { Client360Modal } from "@/components/client360-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, DollarSign, Tag, Mail, RefreshCcw, Check, XCircle, Clock, Send } from "lucide-react";
import { STATUS_COLORS, STATUS_LABELS, METHOD_LABELS, fmt } from "./constants";
import { formatDate } from "@/lib/utils";
import { ReservationPassengersTab } from "./ReservationPassengersTab";
import { ReservationInstallmentsTab } from "./ReservationInstallmentsTab";
import { Button } from "@/components/ui/button";
import { getReservationFinancialSummary, type ReservationWithFinancialLinks } from "./financial";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  isAutoRetry: boolean;
  createdAt: string;
}

export function ReservationDetailModal({ reservationId, open, onClose }: {
  reservationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [client360Id, setClient360Id] = useState<string | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [emailLogsError, setEmailLogsError] = useState<string | null>(null);
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("details");

  const { data, isLoading } = useGetReservation(reservationId, {
    query: { queryKey: ["reservation", reservationId], enabled: open && !!reservationId },
  });
  const { data: paymentsData } = useListPayments(
    { reservationId, limit: 50 },
    { query: { queryKey: ["payments", reservationId], enabled: open && !!reservationId } }
  );
  const payments = paymentsData?.data ?? [];
  const financial = data
    ? getReservationFinancialSummary(data as ReservationWithFinancialLinks)
    : null;

  const fetchEmailLogs = useCallback(async () => {
    if (!reservationId) return;
    setLoadingEmailLogs(true);
    setEmailLogsError(null);
    try {
      const res = await fetch(`${BASE}/api/email-logs?reservationId=${encodeURIComponent(reservationId)}`, {
        credentials: "include",
      });
      if (res.ok) {
        setEmailLogs(await res.json());
      } else if (res.status === 403) {
        setEmailLogsError("Você não tem permissão para visualizar os e-mails desta reserva.");
      } else {
        setEmailLogsError("Não foi possível carregar o histórico de e-mails.");
      }
    } catch {
      setEmailLogsError("Erro de conexão ao carregar e-mails.");
    } finally {
      setLoadingEmailLogs(false);
    }
  }, [reservationId]);

  const { toast } = useToast();

  const resendEmail = useCallback(async (emailLogId: string) => {
    setResendingIds(prev => new Set(prev).add(emailLogId));
    try {
      const res = await fetch(`${BASE}/api/email-logs/${encodeURIComponent(emailLogId)}/resend`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "E-mail reenviado", description: "O e-mail de confirmação foi reenviado com sucesso." });
      } else {
        toast({ title: "Falha ao reenviar", description: "Não foi possível reenviar o e-mail. Tente novamente.", variant: "destructive" });
      }
      await fetchEmailLogs();
    } catch {
      toast({ title: "Falha ao reenviar", description: "Erro de conexão. Verifique sua rede e tente novamente.", variant: "destructive" });
    } finally {
      setResendingIds(prev => {
        const next = new Set(prev);
        next.delete(emailLogId);
        return next;
      });
    }
  }, [fetchEmailLogs, toast]);

  useEffect(() => {
    if (open && activeTab === "emails") {
      fetchEmailLogs();
    }
  }, [open, activeTab, fetchEmailLogs]);

  useEffect(() => {
    if (!open) setActiveTab("details");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data ? (
              <span className="flex items-center gap-2">
                Reserva <code className="text-base font-mono bg-muted px-1.5 py-0.5 rounded">{data.voucherCode}</code>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[data.status] ?? "bg-gray-100 text-gray-800"}`}>
                  {STATUS_LABELS[data.status] ?? data.status}
                </span>
              </span>
            ) : "Detalhes da Reserva"}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-4 py-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : data ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="details">Detalhes</TabsTrigger>
              <TabsTrigger value="passengers">Passageiros</TabsTrigger>
              <TabsTrigger value="installments">Parcelas</TabsTrigger>
              <TabsTrigger value="payments">Pagamentos</TabsTrigger>
              <TabsTrigger value="emails">E-mails</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              {(() => {
                const linked = data as ReservationWithFinancialLinks;
                const summary = financial!;
                const useOrderTotals = summary.usesOrderTotals;
                return (
                  <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Cliente</p>
                  {data.client?.id ? (
                    <button className="font-medium hover:underline text-left" onClick={() => setClient360Id(data.client!.id)}>
                      {data.client?.name}
                    </button>
                  ) : (
                    <p className="font-medium">{data.client?.name}</p>
                  )}
                  <p className="text-sm text-muted-foreground">{data.client?.email}</p>
                  <p className="text-sm text-muted-foreground">{data.client?.whatsapp}</p>
                  {data.client?.cpf && <p className="text-sm text-muted-foreground">CPF: {data.client.cpf}</p>}
                  {data.client?.birthDate && <p className="text-sm text-muted-foreground">Nasc.: {new Date(data.client.birthDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Viagem</p>
                  <p className="font-medium">{data.trip?.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {data.trip?.departureDate ? formatDate(data.trip.departureDate) : "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">{data.trip?.destination}</p>
                </div>
              </div>
              <Separator />
              {summary.discount > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
                    <p className="font-semibold text-lg line-through text-muted-foreground">{fmt(summary.subtotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Desconto</p>
                    <p className="font-semibold text-lg text-destructive">− {fmt(summary.discount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total líquido</p>
                    <p className="font-semibold text-lg">{fmt(summary.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Pago</p>
                    <p className="font-semibold text-lg text-green-600">{fmt(summary.paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Saldo devedor</p>
                    <p className={`font-semibold text-lg ${summary.balance > 0 ? "text-destructive" : "text-green-600"}`}>{fmt(summary.balance)}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total líquido</p>
                    <p className="font-semibold text-lg">{fmt(summary.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Pago</p>
                    <p className="font-semibold text-lg text-green-600">{fmt(summary.paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Saldo devedor</p>
                    <p className={`font-semibold text-lg ${summary.balance > 0 ? "text-destructive" : "text-green-600"}`}>{fmt(summary.balance)}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Forma de Pagamento</p>
                  <p className="font-medium">{METHOD_LABELS[summary.paymentMethod ?? ""] ?? summary.paymentMethod ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Parcelas</p>
                  <p className="font-medium">{summary.installments ?? 1}x</p>
                </div>
              </div>
              {(linked.linkedOrder || linked.linkedReferral || linked.linkedDeals?.length) && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2" data-testid={`card-reservation-links-${data.id}`}>
                  <p className="text-xs font-medium text-muted-foreground">Vínculos</p>
                  {linked.linkedOrder && (
                    <div className="text-sm" data-testid={`text-reservation-order-${data.id}`}>
                      <p>Pedido <span className="font-mono font-semibold">{linked.linkedOrder.orderNumber}</span></p>
                      <p className="text-xs text-muted-foreground">
                        Base {fmt(Number(linked.linkedOrder.subtotal))} · Desconto {fmt(Number(linked.linkedOrder.discountAmount))} · Total {fmt(Number(linked.linkedOrder.totalAmount))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pago {fmt(Number(linked.linkedOrder.paidAmount ?? 0))} · Saldo {fmt(Number(linked.linkedOrder.amountRemaining ?? 0))}
                      </p>
                    </div>
                  )}
                  {linked.linkedReservations?.length ? (
                    <div className="border-t pt-2" data-testid={`text-reservation-same-order-${data.id}`}>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Reservas do mesmo pedido</p>
                      <div className="space-y-1">
                        {linked.linkedReservations
                          .map((reservation) => (
                            (() => {
                              const useCanonicalOrderValues = useOrderTotals && reservation.id === data.id;
                              const total = useCanonicalOrderValues
                                ? Number(linked.linkedOrder?.totalAmount ?? reservation.totalValue)
                                : Number(reservation.totalValue);
                              const paid = useCanonicalOrderValues
                                ? Number(linked.linkedOrder?.paidAmount ?? reservation.paidValue)
                                : Number(reservation.paidValue);
                              const balance = useCanonicalOrderValues
                                ? Number(linked.linkedOrder?.amountRemaining ?? Math.max(0, total - paid))
                                : Number(reservation.balance);
                              return (
                            <p key={reservation.id} className="text-xs">
                              <Link href={`/reservations/${reservation.id}`} className="font-mono font-semibold text-primary hover:underline" data-testid={`link-reservation-sibling-${reservation.id}`}>
                                {reservation.reservationNumber}
                              </Link>
                              {reservation.id === data.id ? " (esta reserva)" : ""}
                              {" · "}{STATUS_LABELS[reservation.status] ?? reservation.status}
                               {" · "}Total {fmt(total)}
                               {" · "}Pago {fmt(paid)}
                               {" · "}Saldo {fmt(balance)}
                            </p>
                              );
                            })()
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {linked.linkedReferral && (
                    <p className="text-sm" data-testid={`text-reservation-referral-${data.id}`}>
                      Indicação <span className="font-mono font-semibold">{linked.linkedReferral.code}</span>
                      {" · "}{linked.linkedReferral.referrerName ?? "Indicador não informado"}
                    </p>
                  )}
                  {!!linked.linkedDeals?.length && (
                    <p className="text-sm" data-testid={`text-reservation-deals-${data.id}`}>
                      {linked.linkedDeals.length} negócio{linked.linkedDeals.length > 1 ? "s" : ""} vinculado{linked.linkedDeals.length > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}
              {data.seats?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Assentos Reservados</p>
                  <div className="flex flex-wrap gap-1">
                    {data.seats.map(s => (
                      <span key={s} className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-sm font-mono">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {data.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Observações</p>
                  <p className="text-sm">{data.notes}</p>
                </div>
              )}
              {linked.storeOrderId && !linked.linkedOrder && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <Tag className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="text-xs text-blue-600 font-medium">Origem: Vitrine Online</p>
                    <p className="text-sm text-blue-700">
                      N° do pedido: <span className="font-mono font-semibold">{linked.storeOrderId}</span>
                    </p>
                  </div>
                </div>
              )}
              {data.isGratuidade && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <Tag className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-700 font-medium">Gratuidade — passageiro cortesia</p>
                </div>
              )}
              {data.checkedInAt && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                  <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700">Check-in realizado em {new Date(data.checkedInAt).toLocaleString("pt-BR")}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Criada em</p>
                <p className="text-sm">{new Date(data.createdAt).toLocaleString("pt-BR")}</p>
              </div>
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="passengers">
              <ReservationPassengersTab reservationId={reservationId} />
            </TabsContent>

            <TabsContent value="installments">
              <ReservationInstallmentsTab reservationId={reservationId} />
            </TabsContent>

            <TabsContent value="payments" className="space-y-4 mt-4">
              {payments.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhum pagamento registrado.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border text-sm">
                      <div>
                        <p className="font-medium">{METHOD_LABELS[p.paymentMethod ?? ""] ?? p.paymentMethod ?? "—"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Venc: {new Date(p.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          {p.description && ` · ${p.description}`}
                        </p>
                        {p.paidAt && <p className="text-xs text-green-600 mt-0.5">Pago em {new Date(p.paidAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold text-base ${p.status === PAYMENT_STATUS.PAID ? "text-green-600" : ""}`}>
                          {fmt(parseFloat(String(p.amount)))}
                        </p>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${p.status === PAYMENT_STATUS.PAID ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                          {p.status === PAYMENT_STATUS.PAID ? "Pago" : "Pendente"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-3 bg-muted/30 rounded-lg border">
                {financial!.discount > 0 ? (
                  <>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Valor Total:</span><span className="font-semibold line-through text-muted-foreground">{fmt(financial!.subtotal)}</span></div>
                    <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Desconto:</span><span className="font-semibold text-destructive">− {fmt(financial!.discount)}</span></div>
                    <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Total líquido:</span><span className="font-semibold">{fmt(financial!.total)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total líquido:</span><span className="font-semibold">{fmt(financial!.total)}</span></div>
                )}
                <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Pago:</span><span className="font-semibold text-green-600">{fmt(financial!.paid)}</span></div>
                <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Saldo devedor:</span><span className={`font-semibold ${financial!.balance > 0 ? "text-destructive" : "text-green-600"}`}>{fmt(financial!.balance)}</span></div>
              </div>
            </TabsContent>

            <TabsContent value="emails" className="mt-4">
              {loadingEmailLogs ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : emailLogsError ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Mail className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm text-destructive">{emailLogsError}</p>
                </div>
              ) : emailLogs.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Mail className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhum e-mail registrado para esta reserva.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {emailLogs.map(log => (
                    <div key={log.id} className="p-3 bg-muted/50 rounded-lg border text-sm space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{log.subject || "—"}</p>
                          <p className="text-xs text-muted-foreground">{log.recipient}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge
                            variant="outline"
                            className={
                              log.status === "sent"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : log.status === "failed"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : log.status === "queued"
                                ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                : "bg-gray-50 text-gray-700 border-gray-200"
                            }
                          >
                            {log.status === "sent" && <Check className="w-3 h-3 mr-1" />}
                            {log.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                            {log.status === "queued" && <Clock className="w-3 h-3 mr-1" />}
                            {log.status === "sent" ? "Enviado" : log.status === "failed" ? "Falhou" : log.status === "queued" ? "Na fila" : log.status}
                          </Badge>
                          {log.isAutoRetry && (
                            <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200" variant="outline">
                              <RefreshCcw className="w-3 h-3 mr-1" />
                              Auto-reenviado
                            </Badge>
                          )}
                          {log.status === "failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={resendingIds.has(log.id)}
                              onClick={() => resendEmail(log.id)}
                            >
                              {resendingIds.has(log.id) ? (
                                <RefreshCcw className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3 mr-1" />
                              )}
                              {resendingIds.has(log.id) ? "Enviando..." : "Reenviar"}
                            </Button>
                          )}
                        </div>
                      </div>
                      {log.errorMessage && (
                        <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{log.errorMessage}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-muted-foreground py-4">Reserva não encontrada.</p>
        )}
      </DialogContent>
      <Client360Modal open={!!client360Id} onClose={() => setClient360Id(null)} clientId={client360Id} />
    </Dialog>
  );
}
