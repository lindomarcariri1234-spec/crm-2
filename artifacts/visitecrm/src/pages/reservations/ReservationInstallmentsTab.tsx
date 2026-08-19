import { useState, useEffect, useCallback } from "react";
import { CheckCircle, Clock, AlertCircle, CreditCard, RefreshCcw, Pencil, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { fmt } from "./constants";
import { PAYMENT_STATUS } from "@workspace/permissions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Installment {
  id: string;
  reservationId: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paidAmount: number | null;
  paidAt: string | null;
  notes: string | null;
  status: "paid" | "overdue" | "pending";
}

const STATUS_COLORS: Record<string, string> = {
  [PAYMENT_STATUS.PAID]: "bg-green-100 text-green-700 border-green-200",
  [PAYMENT_STATUS.OVERDUE]: "bg-red-100 text-red-700 border-red-200",
  [PAYMENT_STATUS.PENDING]: "bg-yellow-100 text-yellow-700 border-yellow-200",
};

const STATUS_LABELS: Record<string, string> = {
  [PAYMENT_STATUS.PAID]: "Pago",
  [PAYMENT_STATUS.OVERDUE]: "Vencido",
  [PAYMENT_STATUS.PENDING]: "Pendente",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  [PAYMENT_STATUS.PAID]: <CheckCircle className="w-3 h-3 mr-1" />,
  [PAYMENT_STATUS.OVERDUE]: <AlertCircle className="w-3 h-3 mr-1" />,
  [PAYMENT_STATUS.PENDING]: <Clock className="w-3 h-3 mr-1" />,
};

function toDateInputValue(isoStr: string) {
  return isoStr.slice(0, 10);
}

export function ReservationInstallmentsTab({ reservationId }: { reservationId: string }) {
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const { toast } = useToast();

  const fetchInstallments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/reservations/${encodeURIComponent(reservationId)}/installments`, {
        credentials: "include",
      });
      if (res.ok) {
        setInstallments(await res.json());
      } else {
        setError("Não foi possível carregar as parcelas.");
      }
    } catch {
      setError("Erro de conexão ao carregar parcelas.");
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    fetchInstallments();
  }, [fetchInstallments]);

  const markPaid = useCallback(async (installment: Installment) => {
    setMarkingIds(prev => new Set(prev).add(installment.id));
    try {
      const res = await fetch(`${BASE}/api/reservations/installments/${encodeURIComponent(installment.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAmount: installment.amount, paidAt: new Date().toISOString() }),
      });
      if (res.ok) {
        toast({ title: "Parcela marcada como paga" });
        await fetchInstallments();
      } else {
        toast({ title: "Erro ao marcar parcela", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão", variant: "destructive" });
    } finally {
      setMarkingIds(prev => { const n = new Set(prev); n.delete(installment.id); return n; });
    }
  }, [fetchInstallments, toast]);

  const startEdit = (installment: Installment) => {
    setEditingId(installment.id);
    setEditDueDate(toDateInputValue(installment.dueDate));
    setEditNotes(installment.notes ?? "");
  };

  const cancelEdit = () => { setEditingId(null); setEditDueDate(""); setEditNotes(""); };

  const saveEdit = async (installment: Installment) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`${BASE}/api/reservations/installments/${encodeURIComponent(installment.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueDate: editDueDate || undefined,
          notes: editNotes || null,
        }),
      });
      if (res.ok) {
        toast({ title: "Parcela atualizada" });
        cancelEdit();
        await fetchInstallments();
      } else {
        toast({ title: "Erro ao salvar parcela", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão", variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 text-muted-foreground mt-4">
        <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={fetchInstallments}>
          <RefreshCcw className="w-4 h-4 mr-1" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (installments.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground mt-4">
        <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Nenhuma parcela cadastrada.</p>
        <p className="text-xs mt-1 text-muted-foreground">Edite a reserva e informe a data da primeira parcela para gerar o cronograma.</p>
      </div>
    );
  }

  const totalPaid = installments.reduce((s, i) => s + (i.paidAt ? (i.paidAmount ?? i.amount) : 0), 0);
  const totalAmount = installments.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-3 mt-4">
      <div className="space-y-2">
        {installments.map(inst => {
          const isEditing = editingId === inst.id;
          return (
            <div key={inst.id} className="p-3 bg-muted/50 rounded-lg border text-sm">
              {isEditing ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 justify-between">
                    <span className="font-medium">Parcela {inst.installmentNumber}</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={savingEdit} onClick={() => saveEdit(inst)}>
                        {savingEdit ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                        {savingEdit ? "..." : "Salvar"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelEdit}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Data de vencimento</label>
                      <Input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className="h-7 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                      <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Nota opcional..." className="h-7 text-xs" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium">Parcela {inst.installmentNumber}</span>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[inst.status] ?? ""}`}>
                        {STATUS_ICONS[inst.status]}
                        {STATUS_LABELS[inst.status] ?? inst.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Venc.: {new Date(inst.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      {inst.paidAt && ` · Pago em ${new Date(inst.paidAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
                    </p>
                    {inst.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{inst.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-semibold text-base ${inst.status === "paid" ? "text-green-600" : ""}`}>
                      {fmt(inst.amount)}
                    </span>
                    {inst.status !== "paid" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => startEdit(inst)}
                          title="Editar vencimento"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={markingIds.has(inst.id)}
                          onClick={() => markPaid(inst)}
                        >
                          {markingIds.has(inst.id) ? (
                            <RefreshCcw className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3 h-3 mr-1" />
                          )}
                          {markingIds.has(inst.id) ? "..." : "Pago"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-3 bg-muted/30 rounded-lg border">
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total:</span><span className="font-semibold">{fmt(totalAmount)}</span></div>
        <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Pago:</span><span className="font-semibold text-green-600">{fmt(totalPaid)}</span></div>
        <div className="flex justify-between text-sm mt-1"><span className="text-muted-foreground">Pendente:</span><span className={`font-semibold ${totalAmount - totalPaid > 0 ? "text-destructive" : "text-green-600"}`}>{fmt(totalAmount - totalPaid)}</span></div>
      </div>
    </div>
  );
}
