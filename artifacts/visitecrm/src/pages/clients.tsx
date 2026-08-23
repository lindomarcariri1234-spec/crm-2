import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListClients, useCreateClient, useUpdateClient,
  useListPipelineStages, useListTrips, useListUsers,
  useCreateDeal, useListPayments, useCreateReservation,
  useCalculateCommission, useGetMe, useDeleteClient,
} from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { Client360Modal } from "@/components/client360-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Users, TrendingUp, UserCheck, MoreHorizontal,
  MapPin, Download, Upload, ChevronLeft, ChevronRight,
  X, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Trash2, Copy,
  GitMerge, ChevronDown, ChevronUp, Loader2, ShieldAlert,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDateBR, localToday, isValidBrazilWhatsAppPhone } from "@workspace/shared";
import { useToast } from "@/hooks/use-toast";
import { SeatMapPicker } from "@/components/SeatMapPicker";
import { PlanLimitWall, usePlanLimitError } from "@/components/plan-limit-wall";

import { formatCurrency } from "@/lib/utils";
import { ROLES, PAYMENT_STATUS, ADMIN_ROLES } from "@workspace/permissions";

function cleanCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function maskCPF(value: string): string {
  const digits = cleanCPF(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isValidCPF(cpf: string): boolean {
  const c = cleanCPF(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;
  let sum = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(c[i - 1]) * (11 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(c[i - 1]) * (12 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(c[10]);
}

function downloadCsv(rows: string[][], filename: string) {
  const content = rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportClientsCsv(clients: Client[]) {
  const headers = ["Código", "Nome", "E-mail", "WhatsApp", "Telefone", "CPF", "Nascimento", "Gênero", "Cidade", "Estado", "Instagram", "Classificação", "Status", "Pipeline", "Total Gasto", "Saldo Devedor", "Tags", "Destinos Sonhados", "Observações", "Cadastrado em"];
  const rows = clients.map(c => [
    c.customerCode ?? "", c.name, c.email, c.whatsapp, c.phone ?? "", c.cpf ?? "",
    c.birthDate ? formatDateBR(c.birthDate) : "",
    c.gender ?? "", c.addressCity ?? "", c.addressState ?? "", c.instagram ?? "",
    c.classification ?? "", c.status ?? "", c.pipelineStage ?? "",
    String(c.totalSpent), String(c.outstandingBalance),
    (c.tags ?? []).join("; "), (c.dreamDestinations ?? []).join("; "),
    c.observations ?? "",
    formatDateBR(c.createdAt),
  ]);
  downloadCsv([headers, ...rows], `clientes_${localToday().replace(/-/g, "")}.csv`);
}


interface CsvImportModalProps { open: boolean; onClose: () => void; onImported: () => void; }

function CsvImportModal({ open, onClose, onImported }: CsvImportModalProps) {
  const { toast } = useToast();
  const createClient = useCreateClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const CSV_COLUMNS = ["nome", "email", "whatsapp", "telefone", "cpf", "cidade", "estado", "instagram", "observacoes"];

  function parseCsv(text: string): string[][] {
    return text.split("\n").filter(l => l.trim()).map(line => {
      const cells: string[] = [];
      let inside = false, cell = "";
      for (const ch of line) {
        if (ch === '"') { inside = !inside; }
        else if (ch === "," && !inside) { cells.push(cell.trim()); cell = ""; }
        else { cell += ch; }
      }
      cells.push(cell.trim());
      return cells;
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(reader.result as string);
      if (rows.length < 2) { toast({ title: "CSV inválido", variant: "destructive" }); return; }
      setHeaders(rows[0]);
      setPreview(rows.slice(1, 6));
      setErrors([]);
    };
    reader.readAsText(file, "UTF-8");
  }

  function colIdx(h: string) { return headers.findIndex(x => x.toLowerCase().includes(h)); }

  async function handleImport() {
    if (!inputRef.current?.files?.[0]) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rows = parseCsv(reader.result as string).slice(1).filter(r => r.some(c => c.trim()));
      setImporting(true); setProgress(0); setErrors([]);
      const errs: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const get = (h: string) => { const idx = colIdx(h); return idx >= 0 ? (r[idx] ?? "").trim() : ""; };
        const name = get("nome"); const email = get("email"); const whatsapp = get("whatsapp") || get("celular") || get("tel");
        const rawCpf = get("cpf");
        const cpfDigits = cleanCPF(rawCpf);
        if (!name || !email || !whatsapp) { errs.push(`Linha ${i + 2}: nome, e-mail e WhatsApp são obrigatórios`); setProgress(Math.round(((i + 1) / rows.length) * 100)); continue; }
        if (!cpfDigits || !isValidCPF(cpfDigits)) { errs.push(`Linha ${i + 2}: ${name} — CPF inválido ou ausente`); setProgress(Math.round(((i + 1) / rows.length) * 100)); continue; }
        try {
          await createClient.mutateAsync({ data: { name, email, whatsapp, phone: get("telefone") || undefined, cpf: cpfDigits, addressCity: get("cidade") || undefined, addressState: get("estado") || undefined, observations: get("observacoes") || undefined } });
        } catch (err: unknown) {
          const rd = (err as { data?: Record<string, unknown> })?.data
            ?? (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
          if (rd?.["conflict"] === "name_whatsapp") {
            const ec = rd["existingClient"] as { name?: string; code?: string } | undefined;
            errs.push(`Linha ${i + 2}: ${name} — duplicado (já existe: ${ec?.name ?? name}${ec?.code ? ` · ${ec.code}` : ""})`);
          } else {
            errs.push(`Linha ${i + 2}: ${name} — erro ao criar`);
          }
        }
        setProgress(Math.round(((i + 1) / rows.length) * 100));
      }
      setImporting(false); setErrors(errs);
      if (errs.length === 0) { toast({ title: `${rows.length} clientes importados com sucesso!` }); onImported(); onClose(); }
      else { toast({ title: `Importação concluída com ${errs.length} erro(s)`, variant: "destructive" }); onImported(); }
    };
    reader.readAsText(inputRef.current.files[0], "UTF-8");
  }

  function handleClose() { if (!importing) { setPreview([]); setHeaders([]); setErrors([]); setProgress(0); onClose(); } }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Clientes via CSV</DialogTitle>
          <DialogDescription>O arquivo deve ter cabeçalhos: Nome, Email, WhatsApp, CPF (obrigatórios) + Telefone, Cidade, Estado, Instagram, Observacoes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => inputRef.current?.click()}>
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Clique para selecionar um arquivo CSV</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>
          {headers.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pré-visualização (primeiros 5 registros)</p>
              <div className="overflow-x-auto border rounded-lg">
                <table className="text-xs w-full">
                  <thead className="bg-muted"><tr>{headers.slice(0, 6).map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>{preview.map((row, i) => <tr key={i} className="border-t">{row.slice(0, 6).map((cell, j) => <td key={j} className="px-2 py-1 truncate max-w-[120px]">{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Colunas detectadas: {headers.join(", ")}</p>
            </div>
          )}
          {importing && (
            <div className="space-y-1">
              <div className="w-full bg-muted rounded-full h-2"><div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="text-xs text-muted-foreground text-center">Importando... {progress}%</p>
            </div>
          )}
          {errors.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto border rounded-lg p-2 bg-destructive/10">
              {errors.map((e, i) => <p key={i} className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3 shrink-0" />{e}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>Cancelar</Button>
          <Button onClick={handleImport} disabled={importing || preview.length === 0}>
            {importing ? `Importando ${progress}%...` : "Importar Clientes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: "Ativo", color: "bg-green-100 text-green-700 border-green-200" },
  inactive: { label: "Inativo", color: "bg-gray-100 text-gray-600 border-gray-200" },
  lead: { label: "Lead", color: "bg-blue-100 text-blue-700 border-blue-200" },
  prospect: { label: "Prospecto", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  vip: { label: "VIP", color: "bg-purple-100 text-purple-700 border-purple-200" },
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  lead: "Lead",
  prospect: "Prospecto",
  client: "Cliente",
  vip: "VIP",
  inactive: "Inativo",
};

const GENDER_OPTIONS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Feminino" },
  { value: "other", label: "Outro" },
];

const ORIGIN_OPTIONS = ["Indicação", "Instagram", "WhatsApp", "Google", "Cliente Antigo", "Evento", "Outros"];
const MARITAL_OPTIONS = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)"];
const TRAVEL_TYPE_OPTIONS = ["Casal", "Bate-volta", "Excursão", "Trilha", "Corporativo"];
const ROOM_TYPE_OPTIONS = ["Quarto Casal", "Quarto Triplo", "Quarto Quádruplo", "Quarto Compartilhado", "Não se aplica"];
const TRAVEL_REASON_OPTIONS = ["Lazer", "Aniversário", "Família", "Romance", "Negócios"];
const TRAVEL_INTERESTS_OPTIONS = ["Gastronomia", "Natureza", "Cultura e história", "Compras", "Aventura", "Religiosidade", "Descanso", "Ecoturismo", "Arte e música", "Fotografia"];
const PAYMENT_METHOD_OPTIONS = ["Dinheiro", "PIX", "Cartão Débito", "Cartão Crédito", "Boleto", "Transferência"];
const INTERNAL_RATING_LABELS: Record<number, string> = { 1: "Difícil", 2: "Neutro", 3: "Fácil", 4: "Ótimo", 5: "Excelente" };

function CommissionPreview({
  sellerId,
  saleAmount,
  tripId,
  onApply,
}: {
  sellerId: string;
  saleAmount: number;
  tripId?: string;
  onApply: (amount: number) => void;
}) {
  const enabled = !!sellerId && sellerId !== "none" && saleAmount > 0;
  const { data } = useCalculateCommission(
    { sellerId, saleAmount, tripId: tripId && tripId !== "none" ? tripId : undefined },
    { query: { enabled, queryKey: ["commission-preview", sellerId, saleAmount, tripId] } }
  );
  if (!enabled || !data) return null;
  const estimated = parseFloat(String(data.commissionAmount ?? 0));
  if (estimated <= 0) return null;
  return (
    <div className="flex items-center gap-2 mt-1 p-2 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
      <span className="text-xs text-green-700 dark:text-green-300 flex-1">
        Comissão estimada:{" "}
        <strong>{formatCurrency(estimated)}</strong>
        {data.commissionType === "percentage" && ` (${data.commissionRate}%)`}
        {data.commissionType === "fixed" && " (valor fixo)"}
      </span>
      <button
        type="button"
        className="text-xs font-medium text-green-700 dark:text-green-300 hover:underline"
        onClick={() => onApply(estimated)}
      >
        Usar
      </button>
    </div>
  );
}

interface ClientFormData {
  name: string; email: string; whatsapp: string; phone: string; cpf: string; rg: string;
  birthDate: string; gender: string; addressCity: string; addressState: string;
  instagram: string; pipelineStage: string; classification: string; status: string;
  origin: string; maritalStatus: string;
  tripId: string; boardingPoint: string; seatNumber: string;
  travelType: string; roomType: string; hasInsurance: boolean; isGratuidade: boolean;
  hasMinorChild: boolean; isOnLap: boolean; travelReason: string;
  ticketPrice: string; quantity: string; discount: string; paymentMethod: string;
  amountPaid: string; commission: string; consultantId: string;
  installments: string;
  internalRating: number; observations: string;
  professionalArea: string; favoriteDrink: string;
  musicalPreferences: string; foodPreferences: string;
  dreamDestinations: string; tags: string;
  npsScore: string; companyFeedback: string;
  travelInterests: string[]; ambassadorOptIn: boolean;
}

const EMPTY_CLIENT: ClientFormData = {
  name: "", email: "", whatsapp: "", phone: "", cpf: "", rg: "", birthDate: "", gender: "none",
  addressCity: "", addressState: "", instagram: "", pipelineStage: "none",
  classification: "lead", status: "active", origin: "none", maritalStatus: "none",
  tripId: "none", boardingPoint: "none", seatNumber: "", travelType: "none",
  roomType: "none", hasInsurance: false, isGratuidade: false, hasMinorChild: false, isOnLap: false, travelReason: "none",
  ticketPrice: "", quantity: "1", discount: "", paymentMethod: "none", amountPaid: "", commission: "", consultantId: "none",
  installments: "1",
  internalRating: 0, observations: "",
  professionalArea: "", favoriteDrink: "", musicalPreferences: "", foodPreferences: "",
  dreamDestinations: "", tags: "",
  npsScore: "", companyFeedback: "",
  travelInterests: [], ambassadorOptIn: false,
};

function sanitizeBirthDateInput(isoStr: string): string {
  const datePart = isoStr.split("T")[0];
  const d = new Date(datePart);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) return "";
  return datePart;
}

function clientToForm(c: Client): ClientFormData {
  return {
    name: c.name, email: c.email, whatsapp: c.whatsapp, phone: c.phone ?? "",
    cpf: c.cpf ?? "", rg: c.rg ?? "", birthDate: c.birthDate ? sanitizeBirthDateInput(c.birthDate) : "",
    gender: c.gender ?? "none", addressCity: c.addressCity ?? "", addressState: c.addressState ?? "",
    instagram: c.instagram ?? "", pipelineStage: c.pipelineStage ?? "none",
    classification: c.classification ?? "lead", status: c.status ?? "active",
    origin: c.origin ?? "none", maritalStatus: c.maritalStatus ?? "none",
    tripId: "none", boardingPoint: "none", seatNumber: "", travelType: "none",
    roomType: "none", hasInsurance: false, isGratuidade: false, hasMinorChild: false, isOnLap: false, travelReason: "none",
    ticketPrice: "", quantity: "1", discount: "", paymentMethod: "none", amountPaid: "", commission: "", consultantId: "none",
  installments: "1",
    internalRating: c.internalRating ?? 0, observations: c.observations ?? "",
    professionalArea: c.professionalArea ?? "", favoriteDrink: c.favoriteDrink ?? "",
    musicalPreferences: c.musicalPreferences ?? "", foodPreferences: c.foodPreferences ?? "",
    dreamDestinations: (c.dreamDestinations ?? []).join(", "), tags: (c.tags ?? []).join(", "),
    npsScore: c.companyNps != null ? String(c.companyNps) : (c.npsScore != null ? String(c.npsScore) : ""),
    companyFeedback: c.companyFeedback ?? "",
    travelInterests: c.travelInterests ?? [],
    ambassadorOptIn: c.ambassadorOptIn ?? false,
  };
}


function ClientPaymentsSection({ clientId }: { clientId: string }) {
  const { data: payments, isLoading } = useListPayments({ clientId, limit: 10 });
  if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  const items = payments?.data ?? [];
  return (
    <div className="space-y-2 pt-2 border-t">
      <p className="text-sm font-medium text-muted-foreground">Pagamentos / Comissões</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum pagamento registrado.</p>
      ) : (
        <div className="space-y-1 max-h-[220px] overflow-y-auto">
          {items.map(p => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.description ?? p.category}</p>
                <p className="text-xs text-muted-foreground">
                  Vence {p.dueDate ? formatDateBR(p.dueDate) : "—"}
                  {p.installmentNumber ? ` · Parcela ${p.installmentNumber}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  p.status === PAYMENT_STATUS.PAID ? "bg-green-100 text-green-700" :
                  p.status === PAYMENT_STATUS.OVERDUE ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                }`}>{p.status === PAYMENT_STATUS.PAID ? "Pago" : p.status === PAYMENT_STATUS.OVERDUE ? "Vencido" : "Pendente"}</span>
                <span className="text-sm font-semibold">{formatCurrency(p.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClientModalProps {
  open: boolean;
  onClose: () => void;
  editClient?: Client | null;
  onSave: (createReservation?: boolean, savedClientId?: string) => void;
  defaultStageId?: string;
  pipelineId?: string | null;
}

export function ClientModal({ open, onClose, editClient, onSave, defaultStageId, pipelineId }: ClientModalProps) {
  const [tab, setTab] = useState("personal");
  const [form, setForm] = useState<ClientFormData>(EMPTY_CLIENT);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [hasSeatMap, setHasSeatMap] = useState<boolean | null>(null);
  const [limitError, setLimitError] = useState<{ resource: string; current?: number; limit?: number } | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{ id: string; name: string; code: string | null; whatsapp: string } | null>(null);
  const { toast } = useToast();
  const { data: allStages } = useListPipelineStages();
  // When creating a deal, scope stages to the pipeline the user is currently viewing
  const stages = pipelineId
    ? allStages?.filter(s => s.pipelineId === pipelineId)
    : allStages;
  const { data: tripsData } = useListTrips({ limit: 100 });
  const { data: usersData } = useListUsers();
  const { data: me } = useGetMe();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const createDeal = useCreateDeal();
  const createReservation = useCreateReservation();

  useEffect(() => {
    if (open) {
      setTab("personal");
      const formData = editClient ? clientToForm(editClient) : EMPTY_CLIENT;
      setForm(formData);
      setSelectedSeats(formData.seatNumber ? [formData.seatNumber] : []);
      setHasSeatMap(null);
      setDuplicateConflict(null);
    }
  }, [open, editClient]);

  const isEditing = !!editClient;
  const isPending = createClient.isPending || updateClient.isPending || createDeal.isPending || createReservation.isPending;
  const set = (key: keyof ClientFormData) => (val: string) => setForm(prev => ({ ...prev, [key]: val }));
  const whatsappHasInvalidFormat =
    form.whatsapp.length > 0 && !isValidBrazilWhatsAppPhone(form.whatsapp);

  const trips = tripsData?.data ?? [];
  const users = usersData ?? [];
  const selectedTrip = trips.find(t => t.id === form.tripId);
  const boardingPoints = (selectedTrip?.boardingPoints ?? []) as Array<{ id: string; name: string }>;

  useEffect(() => {
    if (form.tripId && form.tripId !== "none" && selectedTrip) {
      setForm(prev => ({ ...prev, ticketPrice: prev.isGratuidade ? "0" : String(selectedTrip.priceAdult) }));
    } else if (!form.tripId || form.tripId === "none") {
      setForm(prev => ({ ...prev, ticketPrice: "" }));
    }
  }, [form.tripId, selectedTrip]);

  useEffect(() => {
    if (form.isGratuidade) {
      setForm(prev => ({ ...prev, ticketPrice: "0" }));
    } else if (form.tripId && form.tripId !== "none" && selectedTrip) {
      setForm(prev => ({ ...prev, ticketPrice: String(selectedTrip.priceAdult) }));
    }
  }, [form.isGratuidade]);

  const ticketPrice = parseFloat(form.ticketPrice) || 0;
  const quantity = parseInt(form.quantity) || 1;
  const discount = parseFloat(form.discount) || 0;
  const amountPaid = parseFloat(form.amountPaid) || 0;
  const valorTotal = ticketPrice * quantity;
  const valorComDesconto = Math.max(0, valorTotal - discount);
  const faltaPagar = valorComDesconto - amountPaid;

  const handleSubmit = async (forceCreate = false) => {
    if (!form.name || !form.whatsapp) {
      toast({ title: "Nome e WhatsApp são obrigatórios", variant: "destructive" });
      return;
    }
    if (!isEditing) {
      if (!form.cpf) {
        toast({ title: "CPF é obrigatório", variant: "destructive" });
        return;
      }
    }
    if (form.cpf && !isValidCPF(form.cpf)) {
      toast({ title: "CPF inválido", description: "Verifique o número e tente novamente.", variant: "destructive" });
      return;
    }
    if (discount < 0 || discount > valorTotal) {
      toast({ title: "Desconto inválido", description: "O desconto não pode ser negativo nem maior que o Valor Total.", variant: "destructive" });
      return;
    }
    if (amountPaid < 0 || amountPaid > valorComDesconto) {
      toast({ title: "Valor pago inválido", description: "O valor já pago não pode ser maior que o Valor com Desconto.", variant: "destructive" });
      return;
    }
    const base = {
      name: form.name, email: form.email, whatsapp: form.whatsapp,
      phone: form.phone || undefined, cpf: form.cpf ? cleanCPF(form.cpf) : undefined,
      rg: form.rg || undefined,
      birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : undefined,
      gender: form.gender !== "none" ? form.gender : undefined,
      addressCity: form.addressCity || undefined,
      addressState: form.addressState || undefined,
      instagram: form.instagram || undefined,
      origin: form.origin !== "none" ? form.origin : undefined,
      maritalStatus: form.maritalStatus !== "none" ? form.maritalStatus : undefined,
      observations: form.observations || undefined,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      dreamDestinations: form.dreamDestinations ? form.dreamDestinations.split(",").map(t => t.trim()).filter(Boolean) : [],
      professionalArea: form.professionalArea || undefined,
      favoriteDrink: form.favoriteDrink || undefined,
      musicalPreferences: form.musicalPreferences || undefined,
      foodPreferences: form.foodPreferences || undefined,
      internalRating: form.internalRating > 0 ? form.internalRating : undefined,
      companyFeedback: form.companyFeedback || undefined,
      companyNps: form.npsScore ? parseInt(form.npsScore) : undefined,
      pipelineStage: form.pipelineStage !== "none" ? form.pipelineStage : undefined,
      classification: form.classification || undefined,
      status: form.status || undefined,
      travelInterests: form.travelInterests.length > 0 ? form.travelInterests : [],
      ambassadorOptIn: form.ambassadorOptIn,
    };

    try {
      let savedId: string | undefined;
      if (isEditing && editClient) {
        await updateClient.mutateAsync({
          id: editClient.id,
          data: { ...base },
        });
        savedId = editClient.id;
        const hasTrip = form.tripId !== "none";
        const commission = parseFloat(form.commission) || 0;
        const consultantId = form.consultantId !== "none" ? form.consultantId : null;
        if (hasTrip && (ticketPrice > 0 || form.isGratuidade || form.isOnLap)) {
          try {
            await createReservation.mutateAsync({
              data: {
                tripId: form.tripId,
                clientId: savedId,
                seats: selectedSeats,
                totalValue: valorComDesconto,
                paidValue: amountPaid || undefined,
                discountTotal: discount > 0 ? discount : undefined,
                paymentMethod: form.paymentMethod !== "none" ? form.paymentMethod.toLowerCase().replace(/ /g, "_") : undefined,
                installments: parseInt(form.installments) || 1,
                commissionAmount: commission > 0 ? commission : null,
                sellerId: consultantId,
                notes: form.observations || undefined,
                isGratuidade: form.isGratuidade || undefined,
                isOnLap: form.isOnLap || undefined,
                isChildUnder7: (form.hasMinorChild && !form.isOnLap) || undefined,
              },
            });
          } catch {
            // Reservation creation failure should not block client update
          }
        }
      } else {
        const result = await createClient.mutateAsync({ data: { ...base, cpf: cleanCPF(form.cpf), forceCreate: forceCreate || undefined } });
        savedId = result.id;
        if (result.isNew === false) {
          toast({ title: "Cliente já cadastrado", description: "Os dados do cadastro existente foram atualizados com sucesso." });
        }
        if (savedId) {
          const hasTrip = form.tripId !== "none";
          const commission = parseFloat(form.commission) || 0;
          const consultantId = form.consultantId !== "none" ? form.consultantId : null;

          // Create reservation when trip selected and ticket price > 0 (or gratuidade)
          let createdReservationId: string | undefined;
          if (hasTrip && (ticketPrice > 0 || form.isGratuidade || form.isOnLap)) {
            try {
              const resResult = await createReservation.mutateAsync({
                data: {
                  tripId: form.tripId,
                  clientId: savedId,
                  seats: selectedSeats,
                  totalValue: valorComDesconto,
                  paidValue: amountPaid || undefined,
                  discountTotal: discount > 0 ? discount : undefined,
                  paymentMethod: form.paymentMethod !== "none" ? form.paymentMethod.toLowerCase().replace(/ /g, "_") : undefined,
                  installments: parseInt(form.installments) || 1,
                  commissionAmount: commission > 0 ? commission : null,
                  sellerId: consultantId,
                  notes: form.observations || undefined,
                  isGratuidade: form.isGratuidade || undefined,
                  isOnLap: form.isOnLap || undefined,
                  isChildUnder7: (form.hasMinorChild && !form.isOnLap) || undefined,
                },
              });
              createdReservationId = resResult.id;
            } catch {
              // Reservation creation failure should not block client creation
            }
          }

          // When reservation was created successfully, the backend's syncClientDeal
          // already created/moved the deal to "Reserva Criada". Skip frontend deal
          // creation to avoid duplicates in the Pipeline.
          if (!createdReservationId) {
            const leadStage = stages?.find(s => s.name === "Lead");
            const dealStageId = hasTrip
              ? (leadStage?.id ?? defaultStageId)
              : defaultStageId;
            if (dealStageId) {
              const tripName = selectedTrip?.name ?? "Viagem";
              await createDeal.mutateAsync({
                data: {
                  stageId: dealStageId,
                  ...(hasTrip ? { tripId: form.tripId } : {}),
                  title: hasTrip ? `${form.name} — ${tripName}` : `${form.name} — Lead`,
                  value: hasTrip ? (valorComDesconto ?? 0) : 0,
                  clientId: savedId,
                  leadName: form.name,
                  leadWhatsapp: form.whatsapp,
                  ...(form.travelReason !== "none" ? { travelReason: form.travelReason } : {}),
                },
              });
            }
          }
        }
      }
      toast({ title: isEditing ? "Alterações salvas!" : "Cliente criado!" });
      onSave(false, savedId);
      onClose();
    } catch (err: unknown) {
      const responseData = (err as { data?: Record<string, unknown> })?.data
        ?? (err as { response?: { data?: Record<string, unknown> } })?.response?.data
        ?? {};
      const limitInfo = usePlanLimitError(responseData);
      if (limitInfo.isLimitError) {
        setLimitError({ resource: limitInfo.resource ?? "clients", current: limitInfo.current, limit: limitInfo.limit });
        return;
      }
      // Duplicate name+WhatsApp conflict — show inline confirmation (only on first attempt, not forceCreate)
      if (!forceCreate && responseData["conflict"] === "name_whatsapp") {
        const ec = responseData["existingClient"] as { id: string; name: string; code: string | null; whatsapp: string } | undefined;
        if (ec) { setDuplicateConflict(ec); return; }
      }
      const msg = (responseData["error"] as string)
        || (err as { message?: string })?.message
        || "Erro ao salvar cliente";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleForceCreate = () => {
    setDuplicateConflict(null);
    handleSubmit(true);
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <DialogTitle>{isEditing ? `Editar: ${editClient?.name}` : "Novo Cliente"}</DialogTitle>
            {isEditing && editClient?.customerCode && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground font-normal">Código de Registro:</span>
                <button
                  type="button"
                  className="flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded bg-muted border hover:bg-muted/70 transition-colors text-muted-foreground"
                  title="Copiar código do cliente"
                  onClick={() => {
                    navigator.clipboard.writeText(editClient.customerCode!);
                    toast({ title: "Código copiado!" });
                  }}
                >
                  {editClient.customerCode}
                  <Copy className="w-3 h-3 ml-0.5" />
                </button>
              </div>
            )}
          </div>
        </DialogHeader>

        {limitError && (
          <PlanLimitWall
            resource={limitError.resource as "clients" | "users" | "trips"}
            current={limitError.current}
            limit={limitError.limit}
          />
        )}

        {duplicateConflict && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">Contato duplicado detectado</p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-0.5">
                  Já existe um contato com este mesmo nome e WhatsApp:{" "}
                  <span className="font-semibold">{duplicateConflict.name}</span>
                  {duplicateConflict.code && (
                    <span className="font-mono text-xs ml-1">({duplicateConflict.code})</span>
                  )}
                  .
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Deseja criar mesmo assim ou cancelar?</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDuplicateConflict(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleForceCreate} disabled={isPending}>
                {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Criar mesmo assim
              </Button>
            </div>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-6 text-xs">
            <TabsTrigger value="personal">Pessoal</TabsTrigger>
            <TabsTrigger value="trip">Viagem</TabsTrigger>
            <TabsTrigger value="financial">Financeiro</TabsTrigger>
            <TabsTrigger value="observations">Obs.</TabsTrigger>
            <TabsTrigger value="followup">Follow-up</TabsTrigger>
            <TabsTrigger value="agency">Agência</TabsTrigger>
          </TabsList>

          {/* Aba 1 — Pessoal */}
          <TabsContent value="personal" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Nome Completo *</Label>
                <Input placeholder="Maria Silva" value={form.name} onChange={e => set("name")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp *</Label>
                <Input placeholder="+55 31 99999-9999" value={form.whatsapp} onChange={e => set("whatsapp")(e.target.value)} />
                {whatsappHasInvalidFormat && (
                  <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" role="status">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Número fora do padrão do WhatsApp brasileiro (12–13 dígitos com o código 55). A mensagem não será enviada até corrigi-lo.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>CPF {!isEditing && <span className="text-destructive">*</span>}</Label>
                <Input
                  placeholder="000.000.000-00"
                  value={form.cpf}
                  onChange={e => set("cpf")(maskCPF(e.target.value))}
                  className={form.cpf && !isValidCPF(form.cpf) ? "border-destructive" : ""}
                />
                {form.cpf && !isValidCPF(form.cpf) && (
                  <p className="text-xs text-destructive mt-1">CPF inválido</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" placeholder="maria@email.com" value={form.email} onChange={e => set("email")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Instagram</Label>
                <Input placeholder="@mariaSilva" value={form.instagram} onChange={e => set("instagram")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Data de Aniversário</Label>
                <Input type="date" value={form.birthDate} onChange={e => set("birthDate")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Origem do Cliente</Label>
                <Select value={form.origin} onValueChange={set("origin")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não informado</SelectItem>
                    {ORIGIN_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input placeholder="Belo Horizonte" value={form.addressCity} onChange={e => set("addressCity")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Estado Civil</Label>
                <Select value={form.maritalStatus} onValueChange={set("maritalStatus")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não informado</SelectItem>
                    {MARITAL_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Gênero</Label>
                <Select value={form.gender} onValueChange={set("gender")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não informado</SelectItem>
                    {GENDER_OPTIONS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status no Pipeline</Label>
                <Select value={form.pipelineStage} onValueChange={set("pipelineStage")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {stages?.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          {/* Aba 2 — Viagem */}
          <TabsContent value="trip" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Viagem</Label>
                <Select
                  value={form.tripId}
                  onValueChange={v => {
                    setForm(prev => ({ ...prev, tripId: v, boardingPoint: "none", seatNumber: "" }));
                    setSelectedSeats([]);
                    setHasSeatMap(null);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecionar viagem..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    {trips.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — {formatDateBR(t.departureDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTrip && (
                <div className="col-span-2 rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 p-3 text-sm space-y-2">
                  <p className="font-semibold text-foreground">{selectedTrip.name}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Destino</p>
                      <p className="font-medium text-foreground">{selectedTrip.destination}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data de Partida</p>
                      <p className="font-medium text-foreground">{formatDateBR(selectedTrip.departureDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Preço / Pessoa</p>
                      <p className="font-medium text-foreground">{formatCurrency(selectedTrip.priceAdult)}</p>
                    </div>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Vagas disponíveis: </span>
                    <span className={`font-semibold ${selectedTrip.availableSeats <= 5 ? "text-destructive" : "text-green-600"}`}>
                      {selectedTrip.availableSeats}
                    </span>
                    <span className="text-muted-foreground"> de {selectedTrip.totalCapacity}</span>
                  </div>
                </div>
              )}
              {boardingPoints.length > 0 && (
                <div className="col-span-2 space-y-2">
                  <Label>Local de Embarque</Label>
                  <Select value={form.boardingPoint} onValueChange={set("boardingPoint")}>
                    <SelectTrigger><SelectValue placeholder="Selecionar ponto de embarque..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não especificado</SelectItem>
                      {boardingPoints.map(bp => <SelectItem key={bp.id} value={bp.name}>{bp.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!form.isOnLap && (selectedTrip && form.tripId !== "none" ? (
                <div className="col-span-2 space-y-3">
                  <Label>Selecionar Poltrona</Label>
                  <SeatMapPicker
                    tripId={form.tripId}
                    selectedSeats={selectedSeats}
                    onSeatsChange={seats => {
                      setSelectedSeats(seats);
                      setForm(prev => ({ ...prev, seatNumber: seats[0] ?? "" }));
                    }}
                    maxSeats={1}
                    onHasMap={setHasSeatMap}
                  />
                  {hasSeatMap === false && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Poltrona (manual)</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="Informe o número da poltrona..."
                        value={form.seatNumber}
                        onChange={e => {
                          const val = e.target.value;
                          set("seatNumber")(val);
                          setSelectedSeats(val ? [val] : []);
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Poltrona</Label>
                  <Input type="number" min="1" placeholder="Ex: 12" value={form.seatNumber} onChange={e => {
                    const val = e.target.value;
                    set("seatNumber")(val);
                    setSelectedSeats(val ? [val] : []);
                  }} />
                </div>
              ))}
              <div className="space-y-2">
                <Label>Tipo de Viagem</Label>
                <Select value={form.travelType} onValueChange={set("travelType")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não especificado</SelectItem>
                    {TRAVEL_TYPE_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pacote / Quarto</Label>
                <Select value={form.roomType} onValueChange={set("roomType")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não especificado</SelectItem>
                    {ROOM_TYPE_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex flex-col gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="isGratuidade"
                    checked={form.isGratuidade}
                    onCheckedChange={v => setForm(prev => ({ ...prev, isGratuidade: !!v }))}
                  />
                  <Label htmlFor="isGratuidade" className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">Gratuidade (passageiro cortesia)</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="hasInsurance"
                    checked={form.hasInsurance}
                    onCheckedChange={v => setForm(prev => ({ ...prev, hasInsurance: !!v }))}
                  />
                  <Label htmlFor="hasInsurance" className="cursor-pointer">Possui Seguro de Viagem</Label>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="hasMinorChild"
                      checked={form.hasMinorChild}
                      onCheckedChange={v => {
                        if (!v) {
                          setForm(prev => ({ ...prev, hasMinorChild: false, isOnLap: false }));
                        } else {
                          setForm(prev => ({ ...prev, hasMinorChild: true }));
                        }
                      }}
                    />
                    <Label htmlFor="hasMinorChild" className="cursor-pointer">Criança menor de 7 anos</Label>
                  </div>
                  {form.hasMinorChild && (
                    <div className="pl-7 flex flex-col gap-2">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="childSeatOption"
                          checked={!form.isOnLap}
                          onChange={() => setForm(prev => ({ ...prev, isOnLap: false }))}
                          className="w-4 h-4 accent-primary"
                        />
                        Ocupa poltrona
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="childSeatOption"
                          checked={form.isOnLap}
                          onChange={() => {
                            setSelectedSeats([]);
                            setForm(prev => ({ ...prev, isOnLap: true, seatNumber: "", ticketPrice: "0" }));
                          }}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="font-medium text-rose-600">Vai no colo</span>
                        <span className="text-muted-foreground text-xs">(não ocupa poltrona)</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Aba 3 — Financeiro */}
          <TabsContent value="financial" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preço da Passagem (R$)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0,00" value={form.ticketPrice} onChange={e => set("ticketPrice")(e.target.value)} />
                {selectedTrip && (
                  <p className="text-xs text-muted-foreground">
                    Preço base: {formatCurrency(selectedTrip.priceAdult)}/pessoa × {quantity} passageiro(s) = <span className="font-semibold text-foreground">{formatCurrency(selectedTrip.priceAdult * quantity)}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Quantidade de Passageiros</Label>
                <Input type="number" min="1" placeholder="1" value={form.quantity} onChange={e => set("quantity")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Desconto (R$)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0,00" value={form.discount} onChange={e => set("discount")(e.target.value)} />
                {discount > valorTotal && (
                  <p className="text-xs text-destructive">Desconto não pode ser maior que o Valor Total.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={form.paymentMethod} onValueChange={set("paymentMethod")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não especificado</SelectItem>
                    {PAYMENT_METHOD_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor Já Pago (R$)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0,00" value={form.amountPaid} onChange={e => set("amountPaid")(e.target.value)} />
                {amountPaid > valorComDesconto && (
                  <p className="text-xs text-destructive">Valor pago excede o valor com desconto.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Parcelas</Label>
                <Input type="number" min="1" max="12" defaultValue="1" value={form.installments} onChange={e => set("installments")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Comissão (R$)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0,00" value={form.commission} onChange={e => set("commission")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Consultor / Vendedor</Label>
                <Select value={form.consultantId} onValueChange={set("consultantId")}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não especificado</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CommissionPreview
              sellerId={
                form.consultantId !== "none"
                  ? form.consultantId
                  : me?.role === ROLES.SALES
                  ? me.id
                  : form.consultantId
              }
              saleAmount={valorComDesconto}
              tripId={form.tripId}
              onApply={(amount) => set("commission")(String(amount))}
            />
            {(ticketPrice > 0 || amountPaid > 0) && (
              <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
                  <p className="text-base font-bold">{formatCurrency(valorTotal)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Desconto</p>
                  <p className={`text-base font-bold ${discount > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {discount > 0 ? `− ${formatCurrency(discount)}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Valor c/ Desconto</p>
                  <p className="text-base font-bold">{formatCurrency(valorComDesconto)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Valor Pago</p>
                  <p className="text-base font-bold text-green-600">{formatCurrency(amountPaid)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Falta Pagar</p>
                  <p className={`text-base font-bold ${faltaPagar > 0 ? "text-destructive" : "text-green-600"}`}>{formatCurrency(Math.max(0, faltaPagar))}</p>
                </div>
              </div>
            )}
            {isEditing && editClient && (
              <>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Total Gasto</p>
                    <p className="text-base font-bold">{formatCurrency(editClient.totalSpent)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Saldo Devedor</p>
                    <p className={`text-base font-bold ${editClient.outstandingBalance > 0 ? "text-destructive" : "text-green-600"}`}>
                      {formatCurrency(editClient.outstandingBalance)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Pontos Fidelidade</p>
                    <p className="text-base font-bold">0 pts</p>
                  </div>
                </div>
                <ClientPaymentsSection clientId={editClient.id} />
              </>
            )}
          </TabsContent>

          {/* Aba 4 — Observações */}
          <TabsContent value="observations" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Motivo da Viagem</Label>
              <Select value={form.travelReason} onValueChange={set("travelReason")}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não especificado</SelectItem>
                  {TRAVEL_REASON_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Avaliação Interna (0–5)</Label>
              <p className="text-xs text-muted-foreground -mt-2">Como a equipe avalia esse cliente</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setForm(prev => ({ ...prev, internalRating: prev.internalRating === n ? 0 : n }))}
                    className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-all ${
                      form.internalRating >= n
                        ? form.internalRating >= 4 ? "bg-green-500 border-green-500 text-white" : form.internalRating >= 3 ? "bg-yellow-400 border-yellow-400 text-white" : "bg-red-400 border-red-400 text-white"
                        : "bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10"
                    }`}
                  >
                    <div className="text-sm">{n}</div>
                    <div className="text-[10px] leading-tight">{INTERNAL_RATING_LABELS[n]}</div>
                  </button>
                ))}
              </div>
              {form.internalRating > 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Avaliação: <span className="font-semibold">{form.internalRating}/5 — {INTERNAL_RATING_LABELS[form.internalRating]}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea placeholder="Anotações livres sobre o cliente..." rows={6} value={form.observations} onChange={e => set("observations")(e.target.value)} />
            </div>
          </TabsContent>

          {/* Aba 5 — Follow-up */}
          <TabsContent value="followup" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Área de Atuação Profissional</Label>
                <Input placeholder="Ex: Saúde, Tecnologia..." value={form.professionalArea} onChange={e => set("professionalArea")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bebida Favorita</Label>
                <Input placeholder="Ex: Vinho, Cerveja artesanal..." value={form.favoriteDrink} onChange={e => set("favoriteDrink")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Preferências Musicais</Label>
                <Input placeholder="Ex: Sertanejo, Rock, MPB..." value={form.musicalPreferences} onChange={e => set("musicalPreferences")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Preferências Gastronômicas</Label>
                <Input placeholder="Ex: Frutos do mar, Vegetariano..." value={form.foodPreferences} onChange={e => set("foodPreferences")(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Destinos Sonhados</Label>
                <Input placeholder="Arraial do Cabo, Morro de São Paulo, Fernando de Noronha" value={form.dreamDestinations} onChange={e => set("dreamDestinations")(e.target.value)} />
                <p className="text-xs text-muted-foreground">Separe os destinos com vírgula</p>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Tags</Label>
                <Input placeholder="vip, família, aventura, praia" value={form.tags} onChange={e => set("tags")(e.target.value)} />
                <p className="text-xs text-muted-foreground">Separe as tags com vírgula</p>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Interesses de Viagem</Label>
                <p className="text-xs text-muted-foreground -mt-1">Selecione todos que se aplicam</p>
                <div className="flex flex-wrap gap-2">
                  {TRAVEL_INTERESTS_OPTIONS.map(interest => (
                    <button
                      key={interest}
                      type="button"
                      onClick={() => setForm(prev => ({
                        ...prev,
                        travelInterests: prev.travelInterests.includes(interest)
                          ? prev.travelInterests.filter(x => x !== interest)
                          : [...prev.travelInterests, interest],
                      }))}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        form.travelInterests.includes(interest)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-muted"
                      }`}
                    >
                      {interest}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Aba 6 — Agência */}
          <TabsContent value="agency" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>NPS — Nota do cliente à agência (0–10)</Label>
                {form.npsScore !== "" && (
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                    parseInt(form.npsScore) >= 9 ? "bg-green-100 text-green-700" :
                    parseInt(form.npsScore) >= 7 ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>{form.npsScore}/10</span>
                )}
              </div>
              <input
                type="range" min="0" max="10" step="1"
                value={form.npsScore !== "" ? parseInt(form.npsScore) : 5}
                onChange={e => set("npsScore")(e.target.value)}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0 — Detrator</span><span>6 — Neutro</span><span>10 — Promotor</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 11 }).map((_, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => set("npsScore")(String(i))}
                    className={`flex-1 h-7 rounded text-xs font-bold transition-all ${
                      form.npsScore !== "" && i <= parseInt(form.npsScore)
                        ? parseInt(form.npsScore) >= 9 ? "bg-green-500 text-white" : parseInt(form.npsScore) >= 7 ? "bg-yellow-400 text-white" : "bg-red-400 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                    }`}
                  >{i}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Origem do Cliente</Label>
              <Select value={form.origin} onValueChange={set("origin")}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {ORIGIN_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Comentário sobre a Agência</Label>
              <Textarea placeholder="O que o cliente disse sobre a experiência com a agência..." rows={5} value={form.companyFeedback} onChange={e => set("companyFeedback")(e.target.value)} />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Checkbox
                id="ambassadorOptIn"
                checked={form.ambassadorOptIn}
                onCheckedChange={v => setForm(prev => ({ ...prev, ambassadorOptIn: !!v }))}
              />
              <div>
                <Label htmlFor="ambassadorOptIn" className="cursor-pointer">Participante do Programa de Embaixadores</Label>
                <p className="text-xs text-muted-foreground">Cliente optou por participar do programa de indicações</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t mt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => handleSubmit()} disabled={isPending || !!limitError || !form.name || !form.whatsapp}>
            {isPending ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Cliente"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


type SortField = "name" | "createdAt" | "totalSpent" | "purchaseScore" | "churnScore";
type SortOrder = "asc" | "desc";

interface DuplicatePair {
  reason: "cpf" | "name_whatsapp";
  clients: Array<{ id: string; name: string; email: string; whatsapp: string; cpf?: string | null; createdAt: string; totalSpent: number; customerCode?: string | null }>;
}

async function fetchClientDuplicates(): Promise<{ pairs: DuplicatePair[]; total: number }> {
  const res = await fetch("/api/clients/duplicates");
  if (!res.ok) throw new Error("Erro ao buscar duplicatas");
  return res.json() as Promise<{ pairs: DuplicatePair[]; total: number }>;
}

async function mergeClients(primaryId: string, secondaryId: string): Promise<void> {
  const res = await fetch(`/api/clients/${primaryId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secondaryId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Erro ao mesclar clientes");
  }
}

function ClientDuplicatesPanel({ onMergeComplete }: { onMergeComplete: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mergePair, setMergePair] = useState<{ pair: DuplicatePair; primaryIndex: number } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["client-duplicates"],
    queryFn: fetchClientDuplicates,
    staleTime: 60_000,
  });

  const mergeMutation = useMutation({
    mutationFn: ({ primaryId, secondaryId }: { primaryId: string; secondaryId: string }) =>
      mergeClients(primaryId, secondaryId),
    onSuccess: () => {
      toast({ title: "Clientes mesclados com sucesso", description: "O cadastro duplicado foi incorporado ao perfil principal." });
      queryClient.invalidateQueries({ queryKey: ["client-duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      onMergeComplete();
      setMergePair(null);
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao mesclar", description: err.message, variant: "destructive" });
    },
  });

  const handleConfirmMerge = () => {
    if (!mergePair) return;
    const primaryId = mergePair.pair.clients[mergePair.primaryIndex].id;
    const secondaryId = mergePair.pair.clients[mergePair.primaryIndex === 0 ? 1 : 0].id;
    mergeMutation.mutate({ primaryId, secondaryId });
  };

  const REASON_LABEL: Record<string, string> = {
    cpf: "Mesmo CPF",
    name_whatsapp: "Mesmo nome e WhatsApp",
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Verificando registros duplicados...
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive py-4 text-center">Erro ao carregar duplicatas.</p>;
  }

  const pairs = data?.pairs ?? [];
  if (pairs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
        Nenhum registro duplicado encontrado.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {pairs.map((pair, pairIdx) => (
          <div key={pairIdx} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs gap-1">
                <AlertCircle className="w-3 h-3" />
                {REASON_LABEL[pair.reason] ?? pair.reason}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => setMergePair({ pair, primaryIndex: 0 })}
              >
                <GitMerge className="w-3.5 h-3.5" /> Mesclar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {pair.clients.map((c, idx) => (
                <div key={c.id} className={`rounded-md border p-3 text-sm space-y-0.5 ${idx === 0 ? "bg-muted/30" : ""}`}>
                  <p className="font-semibold truncate">{c.name}</p>
                  {c.customerCode && <p className="text-xs text-muted-foreground">{c.customerCode}</p>}
                  <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  <p className="text-xs text-muted-foreground">{c.whatsapp}</p>
                  {c.cpf && <p className="text-xs font-mono text-muted-foreground">{c.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}</p>}
                  <p className="text-xs text-muted-foreground">Cadastrado: {format(parseISO(c.createdAt), "dd/MM/yyyy", { locale: ptBR })}</p>
                  <p className="text-xs text-muted-foreground">Gasto: R$ {c.totalSpent.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!mergePair} onOpenChange={o => { if (!o) setMergePair(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mesclar Cadastros Duplicados</DialogTitle>
            <DialogDescription>
              Escolha qual registro será o <strong>principal</strong> (manterá todos os dados e histórico). O outro será desativado.
            </DialogDescription>
          </DialogHeader>
          {mergePair && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">Selecione o registro <strong>principal</strong>:</p>
              <div className="grid grid-cols-2 gap-3">
                {mergePair.pair.clients.map((c, idx) => (
                  <button
                    key={c.id}
                    className={`rounded-lg border p-3 text-left text-sm space-y-1 transition-colors ${mergePair.primaryIndex === idx ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/40"}`}
                    onClick={() => setMergePair(p => p ? { ...p, primaryIndex: idx } : p)}
                  >
                    <p className="font-semibold">{c.name}</p>
                    {c.customerCode && <p className="text-xs text-muted-foreground">{c.customerCode}</p>}
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    <p className="text-xs text-muted-foreground">{c.whatsapp}</p>
                    <p className="text-xs text-muted-foreground">Gasto: R$ {c.totalSpent.toFixed(2)}</p>
                    {mergePair.primaryIndex === idx && (
                      <Badge className="text-xs mt-1">Principal</Badge>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded p-2">
                Reservas, pagamentos, notas e demais vínculos do cadastro secundário serão transferidos ao principal. O cadastro secundário será desativado com status "mesclado".
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergePair(null)} disabled={mergeMutation.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmMerge}
              disabled={mergeMutation.isPending}
              className="gap-1.5"
            >
              {mergeMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Mesclando...</> : <><GitMerge className="w-4 h-4" /> Confirmar Mescla</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SortableHeaderProps {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
}

function SortableHeader({ label, field, currentSort, currentOrder, onSort }: SortableHeaderProps) {
  const isActive = currentSort === field;
  return (
    <button
      className="flex items-center gap-1 text-xs font-semibold hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      {label}
      {isActive ? (
        currentOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

export default function Clients() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("search") ?? "");
  const [page, setPage] = useState(() => parseInt(new URLSearchParams(searchStr).get("page") ?? "1") || 1);
  const [filterStatus, setFilterStatus] = useState<string>(() => new URLSearchParams(searchStr).get("status") ?? "all");
  const [filterClassification, setFilterClassification] = useState<string>(() => new URLSearchParams(searchStr).get("classification") ?? "all");
  const [filterPipelineStage, setFilterPipelineStage] = useState<string>(() => new URLSearchParams(searchStr).get("pipeline") ?? "all");
  const [filterCity, setFilterCity] = useState<string>(() => new URLSearchParams(searchStr).get("city") ?? "");
  const [filterTripId, setFilterTripId] = useState<string>(() => new URLSearchParams(searchStr).get("trip") ?? "all");
  const [filterSellerId, setFilterSellerId] = useState<string>(() => new URLSearchParams(searchStr).get("seller") ?? "all");
  const [filterOrigin, setFilterOrigin] = useState<string>(() => new URLSearchParams(searchStr).get("origin") ?? "");
  const [filterDateFrom, setFilterDateFrom] = useState<string>(() => new URLSearchParams(searchStr).get("dateFrom") ?? "");
  const [filterDateTo, setFilterDateTo] = useState<string>(() => new URLSearchParams(searchStr).get("dateTo") ?? "");
  const [filterScoreBand, setFilterScoreBand] = useState<string>(() => new URLSearchParams(searchStr).get("score") ?? "all");
  const [sortBy, setSortBy] = useState<SortField>(() => (new URLSearchParams(searchStr).get("sortBy") as SortField) ?? "createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => (new URLSearchParams(searchStr).get("sortOrder") as SortOrder) ?? "desc");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [viewClientId, setViewClientId] = useState<string | null>(null);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [birthdayFilter, setBirthdayFilter] = useState(() => {
    const params = new URLSearchParams(searchStr);
    return params.get("filter") === "birthday";
  });

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    setBirthdayFilter(params.get("filter") === "birthday");
  }, [searchStr]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (page > 1) params.set("page", String(page));
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterClassification !== "all") params.set("classification", filterClassification);
    if (filterPipelineStage !== "all") params.set("pipeline", filterPipelineStage);
    if (filterCity) params.set("city", filterCity);
    if (filterTripId !== "all") params.set("trip", filterTripId);
    if (filterSellerId !== "all") params.set("seller", filterSellerId);
    if (filterOrigin) params.set("origin", filterOrigin);
    if (filterDateFrom) params.set("dateFrom", filterDateFrom);
    if (filterDateTo) params.set("dateTo", filterDateTo);
    if (filterScoreBand !== "all") params.set("score", filterScoreBand);
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    if (birthdayFilter) params.set("filter", "birthday");
    navigate(`?${params.toString()}`, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page, filterStatus, filterClassification, filterPipelineStage, filterCity, filterTripId, filterSellerId, filterOrigin, filterDateFrom, filterDateTo, filterScoreBand, sortBy, sortOrder, birthdayFilter]);
  const { toast } = useToast();
  const LIMIT = 12;

  const { data: stages } = useListPipelineStages();
  const { data: tripsData } = useListTrips({ limit: 100 });
  const { data: sellers } = useListUsers();
  const { data: me } = useGetMe();
  const deleteClientMutation = useDeleteClient();

  const scoreBandFilter = useMemo(() => {
    if (filterScoreBand === "alta-compra") return { minPurchaseScore: 70 };
    if (filterScoreBand === "media-compra") return { minPurchaseScore: 40, maxPurchaseScore: 69 };
    if (filterScoreBand === "baixa-compra") return { maxPurchaseScore: 39 };
    if (filterScoreBand === "alto-churn") return { minChurnScore: 70 };
    return {};
  }, [filterScoreBand]);

  const { data: clientsData, isLoading, refetch } = useListClients({
    search: search || undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
    pipelineStage: filterPipelineStage !== "all" ? filterPipelineStage : undefined,
    classification: filterClassification !== "all" ? filterClassification : undefined,
    city: filterCity || undefined,
    origin: filterOrigin || undefined,
    tripId: filterTripId !== "all" ? filterTripId : undefined,
    sellerId: filterSellerId !== "all" ? filterSellerId : undefined,
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    page,
    limit: LIMIT,
    ...scoreBandFilter,
  });

  const { data: allClients } = useListClients({ limit: 1000, page: 1 });

  const stats = useMemo(() => {
    const all = allClients?.data ?? [];
    return {
      total: allClients?.total ?? 0,
      active: all.filter(c => c.status === "active").length,
      leads: all.filter(c => c.classification === "lead" || c.status === "lead").length,
      totalRevenue: all.reduce((acc, c) => acc + c.totalSpent, 0),
    };
  }, [allClients]);

  const birthdayClients = useMemo(() => {
    // Use Brazil calendar date so birthday highlights are correct at 21h-midnight BRT
    const [, _bm, _bd] = localToday().split("-").map(Number);
    const todayMonth = _bm;
    const todayDay = _bd;
    return (allClients?.data ?? []).filter(c => {
      if (!c.birthDate) return false;
      try {
        const d = parseISO(c.birthDate);
        return d.getMonth() + 1 === todayMonth && d.getDate() === todayDay;
      } catch {
        return false;
      }
    });
  }, [allClients]);

  const handleSort = useCallback((field: SortField) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  }, [sortBy]);

  const hasFilters = !!(search || filterStatus !== "all" || filterClassification !== "all" || filterPipelineStage !== "all" || filterCity || filterOrigin || filterTripId !== "all" || filterSellerId !== "all" || filterDateFrom || filterDateTo || filterScoreBand !== "all");

  const clearFilters = () => {
    setSearch(""); setFilterStatus("all"); setFilterClassification("all");
    setFilterPipelineStage("all"); setFilterCity(""); setFilterOrigin(""); setFilterTripId("all");
    setFilterSellerId("all"); setFilterDateFrom(""); setFilterDateTo(""); setFilterScoreBand("all");
    setPage(1);
  };

  const totalPages = Math.ceil((clientsData?.total ?? 0) / LIMIT);

  const isAdmin = me && ADMIN_ROLES.includes(me.role as string);

  const { data: duplicatesData } = useQuery({
    queryKey: ["client-duplicates"],
    queryFn: fetchClientDuplicates,
    staleTime: 60_000,
    enabled: !!isAdmin,
  });
  const duplicateCount = duplicatesData?.total ?? 0;

  const handleDeleteConfirm = async () => {
    if (!deleteClient) return;
    try {
      await deleteClientMutation.mutateAsync({ id: deleteClient.id });
      toast({ title: "Cliente excluído com sucesso" });
      setDeleteClient(null);
      setDeleteConfirmText("");
      refetch();
    } catch {
      toast({ title: "Erro ao excluir cliente", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground text-sm">Gerencie sua carteira de clientes.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDuplicates(v => !v)}
              className="gap-1.5"
            >
              <GitMerge className="w-4 h-4" />
              Duplicados
              {duplicateCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none min-w-[16px] h-4 px-1">
                  {duplicateCount}
                </span>
              )}
              {showDuplicates ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
            <Upload className="w-4 h-4 mr-1" /> Importar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            const clients = allClients?.data ?? [];
            if (clients.length === 0) { toast({ title: "Nenhum cliente para exportar" }); return; }
            exportClientsCsv(clients);
            toast({ title: `${clients.length} clientes exportados!` });
          }}>
            <Download className="w-4 h-4 mr-1" /> Exportar CSV
          </Button>
          <Button size="sm" onClick={() => { setEditClient(null); setIsCreateOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Novo Cliente
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-4">
        {[
          { icon: Users, color: "bg-blue-100 text-blue-600", label: "Total", value: stats.total },
          { icon: UserCheck, color: "bg-green-100 text-green-600", label: "Ativos", value: stats.active },
          { icon: TrendingUp, color: "bg-purple-100 text-purple-600", label: "Leads", value: stats.leads },
          { icon: TrendingUp, color: "bg-yellow-100 text-yellow-600", label: "Receita Total", value: formatCurrency(stats.totalRevenue) },
        ].map(({ icon: Icon, color, label, value }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {birthdayFilter && (
        <div className="flex items-center gap-3 px-4 py-3 bg-pink-50 border border-pink-200 rounded-lg text-pink-800">
          <span className="text-lg">🎂</span>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {birthdayClients.length === 0
                ? "Nenhum aniversariante hoje"
                : `${birthdayClients.length} aniversariante${birthdayClients.length > 1 ? "s" : ""} hoje`}
            </p>
            <p className="text-xs text-pink-600">Aproveite para enviar uma mensagem de parabéns!</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-pink-700 hover:text-pink-900 hover:bg-pink-100"
            onClick={() => { setBirthdayFilter(false); navigate("/clients"); }}
          >
            <X className="w-4 h-4 mr-1" /> Limpar filtro
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, email, WhatsApp..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
            </div>
            <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, { label }]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterClassification} onValueChange={v => { setFilterClassification(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Classificação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(CLASSIFICATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPipelineStage} onValueChange={v => { setFilterPipelineStage(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Pipeline" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estágios</SelectItem>
                {stages?.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Filtrar por cidade..." value={filterCity} onChange={e => { setFilterCity(e.target.value); setPage(1); }} className="w-36" />
            <Input placeholder="Filtrar por origem..." value={filterOrigin} onChange={e => { setFilterOrigin(e.target.value); setPage(1); }} className="w-36" />
            <Select value={filterTripId} onValueChange={v => { setFilterTripId(v); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Viagem de interesse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as viagens</SelectItem>
                {tripsData?.data.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSellerId} onValueChange={v => { setFilterSellerId(v); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Vendedor / Captador" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                {(sellers ?? []).filter(u => u.role === ROLES.SALES || u.role === ROLES.AGENCY_ADMIN).map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">De:</Label>
              <Input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }} className="w-36" />
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Até:</Label>
              <Input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }} className="w-36" />
            </div>
            <Select value={filterScoreBand} onValueChange={v => { setFilterScoreBand(v); setPage(1); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Faixa de Score IA" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os scores</SelectItem>
                <SelectItem value="alta-compra">Alta prob. compra (≥70%)</SelectItem>
                <SelectItem value="media-compra">Média prob. compra (40–69%)</SelectItem>
                <SelectItem value="baixa-compra">Baixa prob. compra (&lt;40%)</SelectItem>
                <SelectItem value="alto-churn">Alto risco de churn (≥70%)</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="w-4 h-4 mr-1" /> Limpar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortableHeader label="Cliente" field="name" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} /></TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Localidade</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Última Viagem</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><SortableHeader label="Gasto Total" field="totalSpent" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} /></TableHead>
                <TableHead>Saldo</TableHead>
                <TableHead><SortableHeader label="Score IA" field="purchaseScore" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} /></TableHead>
                <TableHead><SortableHeader label="Risco Churn" field="churnScore" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} /></TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 13 }).map((__, j) => <TableCell key={j}><Skeleton className="h-8 w-full" /></TableCell>)}</TableRow>
                ))
              ) : birthdayFilter ? (
                birthdayClients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                      Nenhum aniversariante hoje.
                    </TableCell>
                  </TableRow>
                ) : birthdayClients.map(client => {
                  const status = STATUS_LABELS[client.status];
                  return (
                    <TableRow key={client.id} className="hover:bg-pink-50/40">
                      <TableCell>
                        <button className="flex items-center gap-3 text-left" onClick={() => setViewClientId(client.id)}>
                          <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm shrink-0">
                            {client.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{client.name} 🎂</p>
                            <p className="text-xs text-muted-foreground">{client.email}</p>
                          </div>
                        </button>
                      </TableCell>
                      <TableCell>
                        {client.customerCode ? (
                          <button
                            type="button"
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted border hover:bg-muted/70 transition-colors text-muted-foreground"
                            title="Copiar código"
                            onClick={() => { navigator.clipboard.writeText(client.customerCode!); toast({ title: "Código copiado!" }); }}
                          >
                            {client.customerCode}
                          </button>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{client.whatsapp}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{[client.addressCity, client.addressState].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{client.origin || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.birthDate ? formatDateBR(client.birthDate).slice(0, 5) : "—"}
                      </TableCell>
                      <TableCell>
                        {client.classification && (
                          <Badge variant="outline" className="text-[10px]">{CLASSIFICATION_LABELS[client.classification] ?? client.classification}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {status && <Badge variant="outline" className={`text-[10px] ${status.color}`}>{status.label}</Badge>}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(client.totalSpent)}</TableCell>
                      <TableCell className="text-sm">{formatCurrency(client.outstandingBalance)}</TableCell>
                      <TableCell>
                        {client.purchaseScore != null ? (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            client.purchaseScore >= 70 ? "bg-green-100 text-green-700" :
                            client.purchaseScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                            "bg-red-100 text-red-700"
                          }`}>{client.purchaseScore}%</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {client.churnScore != null ? (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            client.churnScore >= 70 ? "bg-red-100 text-red-700" :
                            client.churnScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                            "bg-green-100 text-green-700"
                          }`}>{client.churnScore}%</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewClientId(client.id)}>Ver Perfil 360°</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditClient(client); setIsCreateOpen(true); }}>Editar</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (clientsData?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                    {hasFilters ? "Nenhum cliente encontrado com os filtros aplicados." : "Nenhum cliente cadastrado."}
                  </TableCell>
                </TableRow>
              ) : (
                (clientsData?.data ?? []).map(client => {
                  const status = STATUS_LABELS[client.status];
                  return (
                    <TableRow key={client.id} className="hover:bg-muted/30">
                      <TableCell>
                        <button className="flex items-center gap-3 text-left" onClick={() => setViewClientId(client.id)}>
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {client.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate max-w-[160px]">{client.name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[160px]">{client.email}</p>
                          </div>
                        </button>
                      </TableCell>
                      <TableCell>
                        {client.customerCode ? (
                          <button
                            type="button"
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted border hover:bg-muted/70 transition-colors text-muted-foreground"
                            title="Copiar código"
                            onClick={() => { navigator.clipboard.writeText(client.customerCode!); toast({ title: "Código copiado!" }); }}
                          >
                            {client.customerCode}
                          </button>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{client.whatsapp}</p>
                        {client.phone && <p className="text-xs text-muted-foreground">{client.phone}</p>}
                      </TableCell>
                      <TableCell>
                        {client.addressCity ? (
                          <div className="flex items-center gap-1 text-sm"><MapPin className="w-3 h-3 text-muted-foreground" />{client.addressCity}{client.addressState ? `/${client.addressState}` : ""}</div>
                        ) : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>
                        {client.origin ? (
                          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 truncate max-w-[100px] inline-block">{client.origin}</span>
                        ) : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>
                        {client.lastTripName ? (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px] inline-block">{client.lastTripName}</span>
                        ) : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{CLASSIFICATION_LABELS[client.classification] ?? client.classification}</Badge>
                      </TableCell>
                      <TableCell>
                        {status ? <Badge className={`${status.color} border text-xs`}>{status.label}</Badge> : <Badge variant="secondary" className="text-xs">{client.status}</Badge>}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{formatCurrency(client.totalSpent)}</TableCell>
                      <TableCell>
                        <span className={`text-sm font-medium ${client.outstandingBalance > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {formatCurrency(client.outstandingBalance)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {client.purchaseScore != null ? (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            client.purchaseScore >= 70 ? "bg-green-100 text-green-700" :
                            client.purchaseScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                            "bg-red-100 text-red-700"
                          }`}>{client.purchaseScore}%</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {client.churnScore != null ? (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            client.churnScore >= 70 ? "bg-red-100 text-red-700" :
                            client.churnScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                            "bg-green-100 text-green-700"
                          }`}>{client.churnScore}%</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewClientId(client.id)}>Ver detalhes 360°</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditClient(client); setIsCreateOpen(true); }}>Editar dados</DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`https://wa.me/${client.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
                            </DropdownMenuItem>
                            {isAdmin && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteClient(client)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Excluir cliente
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!birthdayFilter && totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-muted-foreground">
            Mostrando {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, clientsData?.total ?? 0)} de {clientsData?.total ?? 0} clientes
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-medium">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {showDuplicates && isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <GitMerge className="w-5 h-5 text-muted-foreground" />
              <div>
                <h2 className="text-base font-semibold">Registros Duplicados</h2>
                <p className="text-xs text-muted-foreground">Clientes com mesmo CPF ou mesmo nome e WhatsApp. Mescle para unificar o histórico.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ClientDuplicatesPanel onMergeComplete={() => refetch()} />
          </CardContent>
        </Card>
      )}

      <ClientModal
        open={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setEditClient(null); }}
        editClient={editClient}
        onSave={(withReservation, savedClientId) => {
          refetch();
          if (withReservation && savedClientId) {
            navigate(`/reservations?clientId=${savedClientId}&new=true`);
          }
        }}
      />
      <Client360Modal open={!!viewClientId} onClose={() => setViewClientId(null)} clientId={viewClientId} />
      <CsvImportModal open={isImportOpen} onClose={() => setIsImportOpen(false)} onImported={() => refetch()} />

      <AlertDialog open={!!deleteClient} onOpenChange={open => { if (!open) { setDeleteClient(null); setDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              <span>Você está prestes a excluir <strong>{deleteClient?.name}</strong>.</span>
              <span className="block mt-2">
                Se este cliente tiver uma conta na vitrine, o acesso ao portal também será removido.
              </span>
              <span className="block mt-2 text-destructive font-medium">O histórico de reservas e pagamentos é preservado. Esta ação não pode ser desfeita.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Label htmlFor="delete-client-confirm" className="text-sm mb-1.5 block">
              Para confirmar, digite <span className="font-semibold">EXCLUIR</span> abaixo:
            </Label>
            <Input
              id="delete-client-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              disabled={deleteClientMutation.isPending}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteClientMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteClientMutation.isPending || deleteConfirmText !== "EXCLUIR"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteClientMutation.isPending ? "Excluindo..." : "Excluir cliente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
