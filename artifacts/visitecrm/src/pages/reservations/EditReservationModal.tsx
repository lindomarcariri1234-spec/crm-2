import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReservation,
  useListBoardingLocations,
  useUpdateReservation,
  useListUsers,
  useCreatePayment,
  useListPayments,
  useDeletePayment,
  useGetMe,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Receipt, ArrowDown, Trash2 } from "lucide-react";
import { z } from "zod";
import { RESERVATION_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, type ReservationStatus } from "@workspace/permissions";
import { fmt, METHOD_LABELS } from "./constants";
import type { LinkedData } from "@/lib/linked-data";

const MANAGEMENT_ROLES = ["super_admin", "agency_admin", "agency_manager"];

const ReservationStatusSchema = z.enum([
  RESERVATION_STATUS.PENDING,
  RESERVATION_STATUS.CONFIRMED,
  RESERVATION_STATUS.CANCELLED,
  RESERVATION_STATUS.REFUNDED,
  RESERVATION_STATUS.COMPLETED,
  RESERVATION_STATUS.FAILED,
]);

const EDITABLE_STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: RESERVATION_STATUS.PENDING, label: "Pendente" },
  { value: RESERVATION_STATUS.CONFIRMED, label: "Confirmada" },
  { value: RESERVATION_STATUS.COMPLETED, label: "Concluída" },
  { value: RESERVATION_STATUS.CANCELLED, label: "Cancelada" },
];

const PAYMENT_METHODS = [
  { value: "pix", label: "PIX" },
  { value: "credit_card", label: "Cartão de Crédito" },
  { value: "debit_card", label: "Cartão de Débito" },
  { value: "bank_transfer", label: "Transferência" },
  { value: "cash", label: "Dinheiro" },
  { value: "boleto", label: "Boleto" },
];

function parseReservationStatus(v: string): ReservationStatus | undefined {
  const r = ReservationStatusSchema.safeParse(v);
  return r.success ? r.data : undefined;
}

export function EditReservationModal({ reservationId, open, onClose, onSuccess }: {
  reservationId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetReservation(reservationId, {
    query: { queryKey: ["reservation-edit", reservationId], enabled: open && !!reservationId },
  });
  const { data: boardingRaw } = useListBoardingLocations();
  const { data: usersData } = useListUsers();
  const { data: me } = useGetMe();
  const updateReservation = useUpdateReservation();
  const createPayment = useCreatePayment();
  const deletePayment = useDeletePayment();
  const { data: paymentsData } = useListPayments(
    { reservationId, limit: 50 },
    { query: { queryKey: ["payments", reservationId], enabled: open && !!reservationId } }
  );
  const payments = paymentsData?.data ?? [];
  const canDeletePayment = MANAGEMENT_ROLES.includes(me?.role ?? "");
  const linkedData = data as (typeof data & LinkedData) | undefined;
  const hasSingleLinkedReservation = linkedData?.linkedOrder != null
    && linkedData.linkedReservations?.length === 1;

  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState("");
  const [editStatus, setEditStatus] = useState<string>("");
  const [isGratuidade, setIsGratuidade] = useState<boolean>(false);
  const [boardingLocationId, setBoardingLocationId] = useState<string>("");
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");

  // Financial fields (synchronized)
  const [ticketPrice, setTicketPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [commissionAmount, setCommissionAmount] = useState<string>("");
  const [sellerId, setSellerId] = useState<string>("");
  const [totalValue, setTotalValue] = useState<string>("");
  const [paidValue, setPaidValue] = useState<string>("");

  // Inline payment fields
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("pix");
  const [payInstallments, setPayInstallments] = useState<string>("1");

  const paymentSectionRef = useRef<HTMLDivElement>(null);
  const scrollToPayment = () => paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const allUsers = usersData ?? [];

  // Derived balance from current state
  const currentBalance = Math.max(0, (parseFloat(totalValue) || 0) - (parseFloat(paidValue) || 0));
  const requestedDeposit = Number(linkedData?.linkedOrder?.depositAmount ?? data?.depositAmount ?? 0);
  const isDepositOnly = requestedDeposit > 0
    && requestedDeposit < (parseFloat(totalValue) || 0)
    && currentBalance > 0;

  // Load existing data when modal opens / data refreshes
  useEffect(() => {
    if (data) {
      setEditStatus(data.status ?? "");
      setPaymentMethod(data.paymentMethod ?? "");
      setBoardingLocationId((data as { boardingLocationId?: string | null }).boardingLocationId ?? "");
      setSelectedTripId(data.tripId ?? "");
      setSelectedClientId(data.clientId ?? "");

      const existingQuantity = data.seats?.length ?? 1;
      const existingTotal = hasSingleLinkedReservation
        ? Number(linkedData?.linkedOrder?.totalAmount ?? data.totalValue ?? 0)
        : Number(data.totalValue ?? 0);
      const existingDiscount = hasSingleLinkedReservation
        ? Number(linkedData?.linkedOrder?.discountAmount ?? data.discountTotal ?? 0)
        : Number(data.discountTotal ?? 0);
      const existingPaid = hasSingleLinkedReservation
        ? Number(linkedData?.linkedOrder?.paidAmount ?? data.paidValue ?? 0)
        : Number(data.paidValue ?? 0);
      const existingCommission = data.commissionAmount ?? null;
      const existingSellerId = data.sellerId ?? "";

      const derivedPrice = existingQuantity > 0
        ? (existingTotal + existingDiscount) / existingQuantity
        : existingTotal;

      setQuantity(String(existingQuantity));
      setTicketPrice(String(derivedPrice.toFixed(2)));
      setDiscount(String(existingDiscount.toFixed(2)));
      setTotalValue(String(existingTotal.toFixed(2)));
      setPaidValue(String(existingPaid.toFixed(2)));
      setCommissionAmount(existingCommission != null ? String(existingCommission) : "");
      setSellerId(existingSellerId);
      setIsGratuidade(data.isGratuidade ?? false);

      // Prefill payment amount with remaining balance
      const remaining = Math.max(0, existingTotal - existingPaid);
      setPayAmount(remaining > 0 ? remaining.toFixed(2) : "");
    }
  }, [data, hasSingleLinkedReservation, linkedData?.linkedOrder]);

  // Auto-sync totalValue from ticketPrice * quantity - discount
  useEffect(() => {
    const price = parseFloat(ticketPrice) || 0;
    const qty = parseInt(quantity) || 0;
    const disc = parseFloat(discount) || 0;
    if (price > 0 && qty > 0) {
      const computed = Math.max(0, price * qty - disc);
      setTotalValue(String(computed.toFixed(2)));
    }
  }, [ticketPrice, quantity, discount]);

  const boardingLocations = boardingRaw ?? [];


  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const installmentsRaw = fd.get("installments") as string;
    const firstDueDateRaw = (fd.get("firstDueDate") as string || "").trim();
    const seatsRaw = (fd.get("seats") as string || "").trim();

    const totalVal = parseFloat(totalValue) || 0;
    const discVal = parseFloat(discount) || 0;
    const commVal = commissionAmount ? parseFloat(commissionAmount) : null;
    const sellerVal = sellerId || null;

    const updateData: Record<string, unknown> = {
      status: parseReservationStatus(editStatus),
      paymentMethod: paymentMethod || undefined,
      notes: (fd.get("notes") as string) || undefined,
      totalValue: totalVal > 0 ? totalVal : undefined,
      installments: installmentsRaw ? parseInt(installmentsRaw) : undefined,
      firstDueDate: firstDueDateRaw || undefined,
      seats: seatsRaw ? seatsRaw.split(",").map(s => s.trim()).filter(Boolean) : undefined,
      boardingLocationId: boardingLocationId || null,
      commissionAmount: commVal,
      sellerId: sellerVal,
      discountTotal: discVal > 0 ? discVal : null,
      isGratuidade,
    };

    if (selectedClientId && selectedClientId !== data?.clientId) {
      updateData.clientId = selectedClientId;
    }
    if (selectedTripId && selectedTripId !== data?.tripId) {
      updateData.tripId = selectedTripId;
    }

    await updateReservation.mutateAsync({ id: reservationId, data: updateData });
    onSuccess();
  };

  const handleDeletePayment = async (paymentId: string) => {
    await deletePayment.mutateAsync({ id: paymentId });
    setDeletingPaymentId(null);
    await queryClient.invalidateQueries({ queryKey: ["reservation-edit", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/reservations/stats"] });
    await queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["payments", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
  };

  const handleRegisterPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!data) return;
    const amount = parseFloat(payAmount) || 0;
    if (amount <= 0) return;
    const now = new Date().toISOString();
    await createPayment.mutateAsync({
      data: {
        reservationId: data.id,
        clientId: data.clientId,
        type: PAYMENT_TYPE.RECEIVABLE,
        category: "reservation",
        amount,
        paymentMethod: payMethod,
        dueDate: now.split("T")[0],
        description: `Pagamento reserva ${data.voucherCode}`,
        installments: parseInt(payInstallments) || 1,
        status: PAYMENT_STATUS.PAID,
        paidAt: now,
      }
    });
    setPaidValue(previous => String(Math.min(
      parseFloat(totalValue) || 0,
      (parseFloat(previous) || 0) + amount,
    ).toFixed(2)));
    setPayAmount("");
    await queryClient.invalidateQueries({ queryKey: ["reservation-edit", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/reservations/stats"] });
    await queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["payments", reservationId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    await queryClient.invalidateQueries({
      predicate: query => {
        const key = JSON.stringify(query.queryKey);
        return ["store/orders", "store-orders", "referrals", "pipeline", "deals", "financial-metrics"]
          .some(term => key.includes(term));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar Reserva</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : data ? (
          <div className="space-y-6 mt-2">
            {/* ── Main edit form ── */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    <span className="text-muted-foreground">Reserva: </span>
                    <span className="font-mono font-semibold">{data.voucherCode}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Cliente: </span>
                    <span className="font-medium">{data.client?.name}</span>
                  </span>
                  {isDepositOnly && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                      Entrada paga · saldo pendente
                    </Badge>
                  )}
                </div>
                {isDepositOnly && (
                  <p className="mt-1.5 text-xs text-amber-800">
                    Entrada: {fmt(data.depositAmount!)} · Restante: {fmt(data.balance)}
                  </p>
                )}
              </div>

              {/* Viagem / Cliente — oculto por design (não permite troca no editar) */}
              <input type="hidden" name="tripId" value={selectedTripId} />
              <input type="hidden" name="clientId" value={selectedClientId} />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EDITABLE_STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Forma de Pagamento</label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Financial block */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Preço da Passagem (R$)</label>
                  <Input type="number" step="0.01" min="0" value={ticketPrice} onChange={e => setTicketPrice(e.target.value)} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Quantidade de Passageiros</label>
                  <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Desconto (R$)</label>
                  <Input type="number" step="0.01" min="0" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Valor Já Pago (R$)</label>
                  <Input type="number" step="0.01" min="0" value={paidValue} readOnly className="bg-muted/50" />
                  <p className="text-xs text-muted-foreground">
                    Calculado dos pagamentos registrados.{" "}
                    {currentBalance > 0 && (
                      <button type="button" onClick={scrollToPayment} className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5">
                        Registrar pagamento <ArrowDown className="w-3 h-3" />
                      </button>
                    )}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Valor Total (R$)</label>
                  <Input type="number" step="0.01" min="0" value={totalValue} readOnly className="bg-muted/50 font-semibold" />
                  <p className="text-xs text-muted-foreground">
                    Saldo devedor: <span className={currentBalance > 0 ? "text-destructive font-medium" : "text-green-700 font-medium"}>{fmt(currentBalance)}</span>
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Parcelas</label>
                  <Input name="installments" type="number" min="1" max="24" defaultValue={data.installments ?? 1} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Comissão (R$)</label>
                  <Input type="number" step="0.01" min="0" value={commissionAmount} onChange={e => setCommissionAmount(e.target.value)} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Consultor / Vendedor</label>
                  <Select value={sellerId || "none"} onValueChange={v => setSellerId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Não especificado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não especificado</SelectItem>
                      {allUsers.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">1ª data de vencimento</label>
                <Input name="firstDueDate" type="date" />
                <p className="text-xs text-muted-foreground">Preencha para regenerar o cronograma de parcelas (apenas parcelas não pagas serão recriadas).</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Assentos</label>
                <Input name="seats" defaultValue={(data.seats ?? []).join(", ")} placeholder="Ex: 1, 2, 3 (separados por vírgula)" />
              </div>
              {boardingLocations.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Local de Embarque</label>
                  <Select value={boardingLocationId || "none"} onValueChange={v => setBoardingLocationId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {boardingLocations.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Observações</label>
                <Input name="notes" defaultValue={data.notes ?? ""} placeholder="Observações sobre a reserva..." />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isGratuidade}
                  onChange={e => setIsGratuidade(e.target.checked)}
                  className="rounded border-border h-4 w-4"
                />
                <span className="text-sm font-medium">Gratuidade</span>
                <span className="text-xs text-muted-foreground">(passageiro cortesia, sem cobrança)</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                <Button type="submit" disabled={updateReservation.isPending}>
                  {updateReservation.isPending ? "Salvando..." : "Salvar alterações"}
                </Button>
              </div>
            </form>

            {/* ── Inline payment section ── */}
            {currentBalance > 0 && (
              <div className="border-t pt-4" ref={paymentSectionRef}>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Registrar Pagamento</h3>
                  <span className="ml-auto text-xs text-destructive font-medium">Saldo: {fmt(currentBalance)}</span>
                </div>
                <form onSubmit={handleRegisterPayment} className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Valor (R$)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={currentBalance}
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Forma de Pagamento</label>
                      <Select value={payMethod} onValueChange={setPayMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Parcelas</label>
                      <Input
                        type="number"
                        min="1"
                        max="12"
                        value={payInstallments}
                        onChange={e => setPayInstallments(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={createPayment.isPending} size="sm">
                      {createPayment.isPending ? "Registrando..." : "Confirmar Pagamento"}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* ── Payment history ── */}
            {payments.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Receipt className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Histórico de Pagamentos</h3>
                  <span className="ml-auto text-xs text-muted-foreground">{payments.length} registro(s)</span>
                </div>
                <div className="space-y-2">
                  {(() => {
                    const PAYMENT_STATUS_CFG: Record<string, { label: string; cls: string }> = {
                      [PAYMENT_STATUS.PAID]:        { label: "Pago",       cls: "bg-green-100 text-green-700" },
                      [PAYMENT_STATUS.APPROVED]:    { label: "Aprovado",   cls: "bg-green-100 text-green-700" },
                      [PAYMENT_STATUS.PENDING]:     { label: "Pendente",   cls: "bg-yellow-100 text-yellow-700" },
                      [PAYMENT_STATUS.OVERDUE]:     { label: "Vencido",    cls: "bg-orange-100 text-orange-700" },
                      [PAYMENT_STATUS.FAILED]:      { label: "Falhou",     cls: "bg-red-100 text-red-700" },
                      [PAYMENT_STATUS.CANCELLED]:   { label: "Cancelado",  cls: "bg-gray-100 text-gray-600" },
                      [PAYMENT_STATUS.REFUNDED]:    { label: "Estornado",  cls: "bg-purple-100 text-purple-700" },
                      [PAYMENT_STATUS.CHARGED_BACK]:{ label: "Chargeback", cls: "bg-red-100 text-red-700" },
                    };
                    return payments.map(p => {
                      const cfg = PAYMENT_STATUS_CFG[p.status ?? ""] ?? { label: p.status ?? "—", cls: "bg-gray-100 text-gray-600" };
                      const isPaid = p.status === PAYMENT_STATUS.PAID || p.status === PAYMENT_STATUS.APPROVED;
                      const displayDate = p.paidAt ?? p.dueDate;
                      return (
                        <div key={p.id} className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg border text-sm">
                          <div>
                            <p className="font-medium text-xs">{METHOD_LABELS[p.paymentMethod ?? ""] ?? p.paymentMethod ?? "—"}</p>
                            {displayDate && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {p.paidAt ? "Pago em" : "Venc."} {new Date(displayDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <p className={`font-semibold text-sm ${isPaid ? "text-green-600" : "text-muted-foreground"}`}>
                                {fmt(parseFloat(String(p.amount)))}
                              </p>
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cfg.cls}`}>
                                {cfg.label}
                              </span>
                            </div>
                            {canDeletePayment && (
                              <button
                                type="button"
                                onClick={() => setDeletingPaymentId(p.id)}
                                className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                                title="Excluir pagamento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Delete payment confirmation */}
            <AlertDialog open={!!deletingPaymentId} onOpenChange={open => { if (!open) setDeletingPaymentId(null); }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação removerá o registro de pagamento permanentemente. O saldo devedor da reserva será recalculado automaticamente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deletingPaymentId && handleDeletePayment(deletingPaymentId)}
                    disabled={deletePayment.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deletePayment.isPending ? "Excluindo..." : "Excluir"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : <p className="text-muted-foreground py-4">Reserva não encontrada.</p>}
      </DialogContent>
    </Dialog>
  );
}
