import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  DndContext, closestCenter, DragOverlay, useSensor, useSensors, PointerSensor,
  type DragStartEvent, type DragEndEvent
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import {
  useListPipelineStages, useListDeals, useMoveDeal,
  useDeleteDeal, useListClients, useListTrips, useUpdateDeal, useGetMe,
} from "@workspace/api-client-react";
import type { Deal, PipelineStage, Client } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { ClientModal } from "./clients";
import { Client360Modal } from "@/components/client360-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Trash2, Phone, Mail, Calendar, MapPin, X, Pencil, UserPen, Eye, BookOpen,
  ExternalLink, ShoppingBag, ChevronDown, ChevronUp, BarChart2, Loader2, XCircle,
  Settings2, Star, ChevronRight, ChevronLeft, GripVertical, Plane, ArrowRightLeft, Bell, CreditCard,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DEAL_STATUS, ROLES } from "@workspace/permissions";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CLASSIFICATION_LABELS: Record<string, string> = {
  lead: "Lead", prospect: "Prospecto", client: "Cliente", vip: "VIP", inactive: "Inativo",
};

// ─── Card Mark Modal ──────────────────────────────────────────────────────────

interface CardMarkData {
  marking: "perdida" | "follow" | "";
  lostReason: string;
  followUpNote: string;
  travelReason: string;
}

interface CardMarkModalProps {
  deal: Deal | null;
  perdidoStageId: string | null | undefined;
  initialMarking?: "perdida" | "follow" | "";
  onClose: () => void;
  onConfirm: (data: CardMarkData) => Promise<void>;
}

function CardMarkModal({ deal, perdidoStageId, initialMarking, onClose, onConfirm }: CardMarkModalProps) {
  const [marking, setMarking] = useState<"perdida" | "follow" | "">("");
  const [lostReason, setLostReason] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [travelReason, setTravelReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (deal) {
      setMarking(initialMarking ?? (deal.status === DEAL_STATUS.LOST ? "perdida" : ""));
      setLostReason(deal.lostReason ?? "");
      setFollowUpNote(deal.followUpNote ?? "");
      setTravelReason(deal.travelReason ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal]);

  async function handleSubmit() {
    setLoading(true);
    try { await onConfirm({ marking, lostReason, followUpNote, travelReason }); }
    finally { setLoading(false); }
  }

  const canSave = marking !== "perdida" || !!perdidoStageId;

  return (
    <Dialog open={!!deal} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-muted-foreground" />
            Marcações do Card
          </DialogTitle>
          <DialogDescription>Defina o status e informações deste negócio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {deal?.followUpNote && marking !== "follow" && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-100">
              <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-amber-700 mb-0.5">Nota de Follow Up registrada</p>
                <p className="text-xs text-amber-600">{deal.followUpNote}</p>
              </div>
            </div>
          )}
          <div>
            <Label className="text-sm font-medium">Marcação</Label>
            <Select
              value={marking === "" ? "none" : marking}
              onValueChange={v => setMarking(v === "none" ? "" : v as "perdida" | "follow")}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Selecionar marcação..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma</SelectItem>
                <SelectItem value="perdida">Perdida</SelectItem>
                <SelectItem value="follow">Follow</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {marking === "perdida" && (
            <div>
              <Label className="text-sm font-medium">Motivo da Perda</Label>
              <Textarea
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                placeholder="Descreva o motivo pelo qual este negócio foi perdido..."
                className="mt-1.5"
                rows={3}
              />
            </div>
          )}

          {marking === "follow" && (
            <div>
              <Label className="text-sm font-medium">Informação para o próximo Follow Up</Label>
              <Textarea
                value={followUpNote}
                onChange={e => setFollowUpNote(e.target.value)}
                placeholder="Informação importante para a próxima etapa do acompanhamento..."
                className="mt-1.5"
                rows={3}
              />
            </div>
          )}

          <div>
            <Label className="text-sm font-medium">Motivo da Viagem</Label>
            <Textarea
              value={travelReason}
              onChange={e => setTravelReason(e.target.value)}
              placeholder="Qual é o motivo desta viagem? (lazer, negócios, aniversário...)"
              className="mt-1.5"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading || !canSave}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Analytics Panel ──────────────────────────────────────────────────────────

interface AnalyticsData {
  stages: { stageId: string; stageName: string; color: string; count: number; value: number; avgDays: number; conversionRate: number; cumulativeRate: number }[];
  lostReasons: { reason: string; count: number }[];
  totalPipeline: number;
  totalLost: number;
}

function AnalyticsPanel({ pipelineId }: { pipelineId: string }) {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["pipeline-analytics", pipelineId],
    queryFn: async () => {
      const resp = await fetch(`${API_BASE}/api/pipeline/${pipelineId}/analytics`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    enabled: !!pipelineId,
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex gap-4 py-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 flex-1 rounded-lg" />)}
      </div>
    );
  }
  if (!data) return null;

  const maxCount = Math.max(...(data.stages.map(s => s.count)), 1);
  const maxLostCount = Math.max(...(data.lostReasons.map(r => r.count)), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-2">
      {/* Conversion Funnel */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Funil de Conversão</p>
        <div className="space-y-2">
          {data.stages.map((s, idx) => (
            <div key={s.stageId} className="flex items-center gap-3">
              <div className="w-28 truncate text-xs font-medium shrink-0">{s.stageName}</div>
              <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max((s.count / maxCount) * 100, 4)}%`,
                    backgroundColor: s.color,
                    opacity: 0.85,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground text-right shrink-0 w-36">
                <span className="font-semibold text-foreground">{s.count}</span>
                {s.avgDays > 0 && <span className="text-[10px] ml-1 text-muted-foreground">({s.avgDays}d)</span>}
                {idx > 0 && (
                  <span className={`ml-1 text-[10px] font-medium ${s.conversionRate >= 50 ? "text-green-600" : s.conversionRate >= 25 ? "text-amber-500" : "text-red-500"}`}>
                    {s.conversionRate}%↓
                  </span>
                )}
                {s.value > 0 && (
                  <span className="block text-[10px] text-primary font-medium">{formatCurrency(s.value)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary + Lost Reasons */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Em negociação</p>
            <p className="text-lg font-bold text-primary">{formatCurrency(data.totalPipeline)}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Negócios perdidos</p>
            <p className="text-lg font-bold text-destructive">{data.totalLost}</p>
          </div>
        </div>
        {data.lostReasons.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Principais Motivos de Perda</p>
            <div className="space-y-1.5">
              {data.lostReasons.map(r => (
                <div key={r.reason} className="flex items-center gap-2">
                  <div className="flex-1 text-xs truncate">{r.reason}</div>
                  <div className="w-24 bg-muted rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{ width: `${(r.count / maxLostCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-5 text-right">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {data.lostReasons.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum negócio perdido registrado ainda.</p>
        )}
      </div>
    </div>
  );
}

// ─── Card Components ──────────────────────────────────────────────────────────

interface ClientCardProps {
  deal: Deal;
  tripsById: Map<string, string>;
  onEditClient: (clientId: string) => void;
  onView360: (clientId: string) => void;
  onDelete: (id: string) => void;
  onCreateReservation: (deal: Deal) => void;
  onViewReservation: (reservationId: string) => void;
  onOpenMarkModal?: (deal: Deal) => void;
  isFinalStage: boolean;
  isLostStage?: boolean;
  isDragging?: boolean;
}

function ClientCardContent({ deal, tripsById, onEditClient, onView360, onDelete, onCreateReservation, onViewReservation, onOpenMarkModal, isFinalStage, isLostStage, isDragging }: ClientCardProps) {
  const name = deal.clientName ?? deal.leadName ?? "Lead Desconhecido";
  const whatsapp = deal.clientWhatsapp ?? deal.leadWhatsapp;
  const email = deal.clientEmail ?? deal.leadEmail;
  const phone = deal.clientPhone && deal.clientPhone !== whatsapp ? deal.clientPhone : null;
  const cpf = deal.clientCpf ?? null;
  const city = deal.clientCity;
  const state = deal.clientState;
  const dealValue = deal.value ?? 0;
  const outstanding = deal.clientOutstandingBalance ?? 0;
  const hasOutstanding = outstanding > 0;
  const tripName = deal.tripId ? tripsById.get(deal.tripId) : undefined;
  const initials = name.charAt(0).toUpperCase();
  const hasReservation = !!deal.reservationId;

  return (
    <div className={`bg-card rounded-lg border p-3 shadow-sm group relative select-none ${isDragging ? "opacity-50 shadow-xl" : "hover:shadow-md"} transition-all`}>
      <div className="flex items-start gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm leading-tight truncate">{name}</p>
            {deal.source === "website" && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                <ShoppingBag className="w-2.5 h-2.5" />
                Loja
              </span>
            )}
            {!!deal.followUpNote && !deal.lostReason && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                <Bell className="w-2.5 h-2.5" />
                Follow
              </span>
            )}
            {!!deal.lostReason && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-100 shrink-0">
                <XCircle className="w-2.5 h-2.5" />
                Perdida
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{deal.title}</p>
          {tripName && (
            <p className="text-xs text-emerald-700 font-medium mt-0.5 truncate flex items-center gap-1">
              <Plane className="w-3 h-3 shrink-0" />
              {tripName}
            </p>
          )}
          {deal.reservationNumber && (
            <p className="text-xs text-blue-700 font-mono font-semibold mt-0.5">{deal.reservationNumber}</p>
          )}
          {!deal.reservationNumber && deal.source === "website" && deal.seats && deal.seats.length > 0 && (
            <p className="text-xs text-blue-600 font-medium mt-0.5">
              {deal.seats.length === 1 ? `Assento ${deal.seats[0]}` : `Assentos ${deal.seats.join(", ")}`}
            </p>
          )}
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 text-muted-foreground hover:text-foreground rounded" title="Opções">
                <Pencil className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {deal.clientId ? (
                <>
                  <DropdownMenuItem onClick={() => onView360(deal.clientId!)}>
                    <Eye className="w-3.5 h-3.5 mr-2" />
                    Ver 360°
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEditClient(deal.clientId!)}>
                    <UserPen className="w-3.5 h-3.5 mr-2" />
                    Editar Cliente
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  <UserPen className="w-3.5 h-3.5 mr-2" />
                  Sem cliente vinculado
                </DropdownMenuItem>
              )}
              {hasReservation && (
                <DropdownMenuItem onClick={() => onViewReservation(deal.reservationId!)}>
                  <ExternalLink className="w-3.5 h-3.5 mr-2" />
                  Ver Reserva
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onOpenMarkModal?.(deal)}>
                <Settings2 className="w-3.5 h-3.5 mr-2" />
                Marcações
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button onClick={() => onDelete(deal.id)} className="p-1 text-muted-foreground hover:text-destructive rounded">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {whatsapp && (
        <div className="flex items-center gap-1 mb-1">
          <Phone className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{whatsapp}</span>
        </div>
      )}

      {email && (
        <div className="flex items-center gap-1 mb-1">
          <Mail className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground truncate">{email}</span>
        </div>
      )}

      {phone && (
        <div className="flex items-center gap-1 mb-1">
          <Phone className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{phone}</span>
        </div>
      )}

      {cpf && (
        <div className="flex items-center gap-1 mb-1" title={cpf}>
          <CreditCard className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-mono">
            {cpf.replace(/^(\d{3})\.(\d{3})\.(\d{3})-(\d{2})$/, "$1.***.***-$4") !== cpf
              ? cpf.replace(/^(\d{3})\.(\d{3})\.(\d{3})-(\d{2})$/, "$1.***.***-$4")
              : `${cpf.slice(0, 3)}***${cpf.slice(-2)}`}
          </span>
        </div>
      )}

      {(city || state) && (
        <div className="flex items-center gap-1 mb-1">
          <MapPin className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{[city, state].filter(Boolean).join("/")}</span>
        </div>
      )}

      {deal.expectedCloseDate && (
        <div className="flex items-center gap-1 mb-1">
          <Calendar className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{format(parseISO(deal.expectedCloseDate), "dd/MM/yy", { locale: ptBR })}</span>
        </div>
      )}

      {tripName && (
        <div className="mb-1">
          <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded truncate inline-block max-w-full">{tripName}</span>
        </div>
      )}

      {deal.travelReason && (
        <div className="mb-1">
          <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
            <Plane className="w-2.5 h-2.5 shrink-0" />
            {deal.travelReason}
          </span>
        </div>
      )}

      {deal.followUpNote && (
        <div className="mb-1">
          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1 max-w-full">
            <Bell className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{deal.followUpNote}</span>
          </span>
        </div>
      )}

      <div className="pt-2 border-t mt-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Valor do negócio</p>
            <p className="text-sm font-bold text-primary">{formatCurrency(dealValue)}</p>
          </div>
          {hasOutstanding && (
            <Badge variant="destructive" className="text-xs">
              Deve {formatCurrency(outstanding)}
            </Badge>
          )}
        </div>

        {isLostStage && deal.lostReason && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100">
            <XCircle className="w-3 h-3 text-red-500 shrink-0" />
            <span className="text-xs text-red-600 font-medium truncate">{deal.lostReason}</span>
          </div>
        )}
        {isFinalStage && !hasReservation && !isLostStage && (
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-2 h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
            onClick={e => { e.stopPropagation(); onCreateReservation(deal); }}
          >
            <BookOpen className="w-3 h-3" />
            Criar Reserva
          </Button>
        )}
        {hasReservation && (
          <button
            className="w-full mt-2 text-xs text-blue-600 hover:underline flex items-center justify-center gap-1"
            onClick={e => { e.stopPropagation(); onViewReservation(deal.reservationId!); }}
          >
            <ExternalLink className="w-3 h-3" />
            Ver Reserva vinculada
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ deal, tripsById, onEditClient, onView360, onDelete, onCreateReservation, onViewReservation, onOpenMarkModal, isFinalStage, isLostStage }: Omit<ClientCardProps, "isDragging">) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
      <ClientCardContent deal={deal} tripsById={tripsById} onEditClient={onEditClient} onView360={onView360} onDelete={onDelete} onCreateReservation={onCreateReservation} onViewReservation={onViewReservation} onOpenMarkModal={onOpenMarkModal} isFinalStage={isFinalStage} isLostStage={isLostStage} isDragging={isDragging} />
    </div>
  );
}

function DroppableColumn({ stage, children }: { stage: PipelineStage; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 min-h-[120px] p-2 rounded-lg transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
    >
      {children}
    </div>
  );
}

// ─── Types & Constants ────────────────────────────────────────────────────────

interface PipelineInfo {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  tenantId: string;
  createdAt: string;
}

const PRESET_COLORS = [
  "#6366F1", "#3B82F6", "#0EA5E9", "#10B981", "#06B6D4",
  "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6B7280",
];

// ─── New Pipeline Modal ───────────────────────────────────────────────────────

interface NewPipelineModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (pipeline: PipelineInfo) => void;
}

const DEFAULT_PIPELINE_STAGES = [
  { name: "Lead", color: "#6366F1" },
  { name: "Vitrine", color: "#3B82F6" },
  { name: "Reserva Criada", color: "#0EA5E9" },
  { name: "Pagamento Confirmado", color: "#10B981" },
  { name: "Em Viagem", color: "#06B6D4" },
  { name: "Pós Viagem", color: "#6B7280" },
  { name: "Perdido", color: "#EF4444" },
];

function NewPipelineModal({ open, onClose, onCreated }: NewPipelineModalProps) {
  const [name, setName] = useState("");
  const [initialStages, setInitialStages] = useState(DEFAULT_PIPELINE_STAGES.map(s => ({ ...s })));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newStageName, setNewStageName] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setError("");
      setInitialStages(DEFAULT_PIPELINE_STAGES.map(s => ({ ...s })));
      setNewStageName("");
    }
  }, [open]);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/api/pipelines`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.message ?? "Erro ao criar pipeline");
        return;
      }
      const pipeline = await resp.json() as PipelineInfo;

      // Create initial stages
      for (let i = 0; i < initialStages.length; i++) {
        const s = initialStages[i];
        await fetch(`${API_BASE}/api/pipeline/stages?pipelineId=${pipeline.id}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: s.name, color: s.color }),
        });
      }

      onCreated(pipeline);
    } finally {
      setLoading(false);
    }
  }

  function addStage() {
    if (!newStageName.trim()) return;
    setInitialStages(prev => [...prev, { name: newStageName.trim(), color: PRESET_COLORS[prev.length % PRESET_COLORS.length] }]);
    setNewStageName("");
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Pipeline</DialogTitle>
          <DialogDescription>Crie um pipeline separado para organizar negócios por contexto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label className="text-sm font-medium">Nome do pipeline</Label>
            <Input
              className="mt-1.5"
              placeholder="Ex: Viagens Internacionais"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
              autoFocus
            />
          </div>

          <div>
            <Label className="text-sm font-medium">Etapas iniciais</Label>
            <p className="text-xs text-muted-foreground mb-2">Personalize antes de criar — você pode editar depois.</p>
            <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
              {initialStages.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-sm flex-1 truncate">{s.name}</span>
                  <button
                    onClick={() => setInitialStages(prev => prev.filter((_, i) => i !== idx))}
                    className="p-0.5 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={newStageName}
                  onChange={e => setNewStageName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addStage(); }}
                  placeholder="+ Nova etapa..."
                  className="h-7 text-sm"
                />
                {newStageName.trim() && (
                  <Button size="sm" className="h-7 px-2 shrink-0" onClick={addStage}>Adicionar</Button>
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Criar Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Stages Modal ──────────────────────────────────────────────────────

interface StageRow {
  id: string;
  name: string;
  color: string;
  order: number;
  isFinal: boolean;
  isDefaultWeb: boolean;
  pipelineId: string;
  activeDeals?: number;
  isDirty?: boolean;
}

interface ManageStagesModalProps {
  open: boolean;
  onClose: () => void;
  pipelineId: string;
  pipelineName: string;
  onChanged: () => void;
}

function ManageStagesModal({ open, onClose, pipelineId, pipelineName, onChanged }: ManageStagesModalProps) {
  const [rows, setRows] = useState<StageRow[]>([]);
  const [loadingStages, setLoadingStages] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [addingName, setAddingName] = useState("");
  const [addingColor, setAddingColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");

  async function loadStages() {
    setLoadingStages(true);
    try {
      const resp = await fetch(`${API_BASE}/api/pipeline/stages?pipelineId=${pipelineId}`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json() as StageRow[];
      setRows(data.map(s => ({ ...s, isDirty: false })));
    } finally {
      setLoadingStages(false);
    }
  }

  useEffect(() => {
    if (open && pipelineId) { loadStages(); setAddOpen(false); setAddingName(""); setError(""); }
  }, [open, pipelineId]);

  async function saveRow(row: StageRow) {
    setSaving(row.id);
    try {
      await fetch(`${API_BASE}/api/pipeline/stages/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: row.name, color: row.color, order: row.order }),
      });
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, isDirty: false } : r));
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  async function deleteRow(id: string) {
    setDeleting(id);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/api/pipeline/stages/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.message ?? "Não foi possível excluir a etapa");
        return;
      }
      setRows(prev => prev.filter(r => r.id !== id));
      onChanged();
    } finally {
      setDeleting(null);
    }
  }

  async function addStage() {
    if (!addingName.trim()) return;
    setAdding(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/api/pipeline/stages?pipelineId=${pipelineId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addingName.trim(), color: addingColor }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.message ?? "Erro ao criar etapa");
        return;
      }
      const stage = await resp.json() as StageRow;
      setRows(prev => [...prev, stage]);
      setAddingName("");
      setAddOpen(false);
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  function moveRow(idx: number, dir: -1 | 1) {
    const newRows = [...rows];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= newRows.length) return;
    const a = { ...newRows[idx], order: newRows[targetIdx].order, isDirty: true };
    const b = { ...newRows[targetIdx], order: newRows[idx].order, isDirty: true };
    newRows[idx] = b;
    newRows[targetIdx] = a;
    newRows.sort((x, y) => x.order - y.order);
    setRows(newRows);
    // Save both
    setTimeout(() => {
      saveRow(a);
      saveRow(b);
    }, 0);
  }

  function updateName(id: string, name: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, name, isDirty: true } : r));
  }

  function updateColor(id: string, color: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, color, isDirty: true } : r));
    // Save immediately on color change
    const row = rows.find(r => r.id === id);
    if (row) saveRow({ ...row, color, isDirty: false });
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Gerenciar Etapas — {pipelineName}
          </DialogTitle>
          <DialogDescription>Adicione, renomeie, reordene ou remova etapas do pipeline.</DialogDescription>
        </DialogHeader>

        {loadingStages ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto py-1 pr-1">
            {rows.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
                <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                {/* Color dot selector */}
                <div className="relative group shrink-0">
                  <div
                    className="w-5 h-5 rounded-full cursor-pointer border-2 border-transparent hover:border-ring"
                    style={{ backgroundColor: row.color }}
                    title="Cor"
                  />
                  <div className="absolute z-10 hidden group-hover:flex flex-wrap gap-1 p-2 bg-popover border rounded-lg shadow-lg left-0 top-7 w-32">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        className={`w-5 h-5 rounded-full border-2 ${row.color === c ? "border-ring" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                        onClick={() => updateColor(row.id, c)}
                      />
                    ))}
                  </div>
                </div>
                <Input
                  value={row.name}
                  onChange={e => updateName(row.id, e.target.value)}
                  onBlur={() => { if (row.isDirty) saveRow(row); }}
                  onKeyDown={e => { if (e.key === "Enter" && row.isDirty) saveRow(row); }}
                  className="h-7 text-sm flex-1"
                />
                {saving === row.id && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />}
                <div className="flex gap-0.5 shrink-0">
                  <button
                    onClick={() => moveRow(idx, -1)}
                    disabled={idx === 0 || !!saving}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Mover para cima"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveRow(idx, 1)}
                    disabled={idx === rows.length - 1 || !!saving}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Mover para baixo"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Excluir a etapa "${row.name}"?`)) deleteRow(row.id); }}
                    disabled={!!deleting || !!saving}
                    className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-30"
                    title="Excluir etapa"
                  >
                    {deleting === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            ))}

            {/* Add new stage row */}
            {addOpen ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2 mt-2">
                <div className="relative group shrink-0">
                  <div
                    className="w-5 h-5 rounded-full cursor-pointer border-2 border-transparent hover:border-ring"
                    style={{ backgroundColor: addingColor }}
                  />
                  <div className="absolute z-10 hidden group-hover:flex flex-wrap gap-1 p-2 bg-popover border rounded-lg shadow-lg left-0 top-7 w-32">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        className={`w-5 h-5 rounded-full border-2 ${addingColor === c ? "border-ring" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setAddingColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <Input
                  value={addingName}
                  onChange={e => setAddingName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addStage(); if (e.key === "Escape") setAddOpen(false); }}
                  placeholder="Nome da etapa..."
                  className="h-7 text-sm flex-1"
                  autoFocus
                />
                <Button size="sm" className="h-7 px-2" onClick={addStage} disabled={!addingName.trim() || adding}>
                  {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                </Button>
                <button onClick={() => setAddOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 w-full rounded-lg border-2 border-dashed p-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors mt-1"
              >
                <Plus className="w-4 h-4" /> Nova etapa
              </button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive mt-1">{error}</p>}

        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Migrate Modal ───────────────────────────────────────────────────────

interface BulkMigrateModalProps {
  open: boolean;
  onClose: () => void;
  pipelines: PipelineInfo[];
  stages: PipelineStage[];
  deals: Deal[];
  onMigrated: () => void;
}

function BulkMigrateModal({ open, onClose, pipelines, stages, deals, onMigrated }: BulkMigrateModalProps) {
  const { toast } = useToast();
  const [srcPipelineId, setSrcPipelineId] = useState("");
  const [srcStageId, setSrcStageId] = useState("all");
  const [dstPipelineId, setDstPipelineId] = useState("");
  const [dstStageId, setDstStageId] = useState("");
  const [loading, setLoading] = useState(false);

  // Initialize defaults when modal opens
  useEffect(() => {
    if (open && pipelines.length > 0) {
      const def = pipelines.find(p => p.isDefault) ?? pipelines[0];
      setSrcPipelineId(def.id);
      setSrcStageId("all");
      setDstPipelineId(def.id);
      setDstStageId("");
    }
  }, [open, pipelines]);

  // Reset dstStageId when dstPipeline changes
  useEffect(() => { setDstStageId(""); }, [dstPipelineId]);
  // Reset srcStageId when srcPipeline changes
  useEffect(() => { setSrcStageId("all"); }, [srcPipelineId]);

  const stagesByPipeline = useMemo(() => {
    const map = new Map<string, PipelineStage[]>();
    stages.forEach(s => {
      const pid = s.pipelineId ?? "";
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(s);
    });
    return map;
  }, [stages]);

  const srcStages = stagesByPipeline.get(srcPipelineId) ?? [];
  const dstStages = stagesByPipeline.get(dstPipelineId) ?? [];

  const matchingDeals = useMemo(() => {
    const srcStageIdSet = new Set((stagesByPipeline.get(srcPipelineId) ?? []).map(s => s.id));
    let d = deals.filter(deal => srcStageIdSet.has(deal.stageId));
    if (srcStageId !== "all") d = d.filter(deal => deal.stageId === srcStageId);
    return d;
  }, [deals, srcPipelineId, srcStageId, stagesByPipeline]);

  const canMigrate = matchingDeals.length > 0 && !!dstStageId;
  const isSameStage = canMigrate && dstStageId === (srcStageId !== "all" ? srcStageId : null);

  async function handleMigrate() {
    if (!canMigrate) return;
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/pipeline/deals/bulk-move`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: matchingDeals.map(d => d.id), targetStageId: dstStageId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro desconhecido" }));
        toast({ title: "Erro ao migrar", description: err.error ?? "Tente novamente.", variant: "destructive" });
        return;
      }
      const result: { count: number } = await resp.json();
      toast({ title: "Migração concluída!", description: `${result.count} negócio${result.count !== 1 ? "s" : ""} migrado${result.count !== 1 ? "s" : ""} com sucesso.` });
      onClose();
      onMigrated();
    } catch {
      toast({ title: "Erro ao migrar", description: "Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            Migrar Negócios em Lote
          </DialogTitle>
          <DialogDescription>
            Selecione a origem e o destino para mover negócios entre pipelines ou etapas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Source */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Origem</p>
            <div className="space-y-2">
              <div>
                <Label className="text-xs mb-1 block">Pipeline de origem</Label>
                <Select value={srcPipelineId} onValueChange={setSrcPipelineId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecionar pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex items-center gap-2">
                          {p.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                          {p.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Etapa de origem</Label>
                <Select value={srcStageId} onValueChange={setSrcStageId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todas as etapas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as etapas</SelectItem>
                    {srcStages.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${matchingDeals.length > 0 ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-muted text-muted-foreground"}`}>
              <ArrowRightLeft className="w-4 h-4 shrink-0" />
              {matchingDeals.length === 0
                ? "Nenhum negócio encontrado para essa seleção"
                : `${matchingDeals.length} negócio${matchingDeals.length !== 1 ? "s" : ""} serão migrados`}
            </div>
          </div>

          {/* Destination */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Destino</p>
            <div className="space-y-2">
              <div>
                <Label className="text-xs mb-1 block">Pipeline de destino</Label>
                <Select value={dstPipelineId} onValueChange={setDstPipelineId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecionar pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex items-center gap-2">
                          {p.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                          {p.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Etapa de destino</Label>
                <Select value={dstStageId} onValueChange={setDstStageId} disabled={!dstPipelineId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecionar etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {dstStages.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isSameStage && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                A etapa de destino é a mesma da origem — a migração não terá efeito.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            onClick={handleMigrate}
            disabled={!canMigrate || loading}
            className="gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Migrando..." : `Migrar ${matchingDeals.length} negócio${matchingDeals.length !== 1 ? "s" : ""}`}
            {!loading && <ArrowRightLeft className="w-4 h-4" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Pipeline() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterStageId, setFilterStageId] = useState("all");
  const [filterClassification, setFilterClassification] = useState("all");
  const [filterCity, setFilterCity] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string | undefined>(undefined);
  const [activeDragDeal, setActiveDragDeal] = useState<Deal | null>(null);
  const [client360Id, setClient360Id] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pendingMarkDeal, setPendingMarkDeal] = useState<{ deal: Deal; initialMarking?: "perdida" | "follow" | "" } | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [manageStagesOpen, setManageStagesOpen] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [renamingPipeline, setRenamingPipeline] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deletingPipelineLoading, setDeletingPipelineLoading] = useState(false);
  const [bulkMigrateOpen, setBulkMigrateOpen] = useState(false);

  const { data: me } = useGetMe();
  const isAdmin = me?.role === ROLES.SUPER_ADMIN || me?.role === ROLES.AGENCY_ADMIN;

  const { data: pipelines, refetch: refetchPipelines } = useQuery<PipelineInfo[]>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const resp = await fetch(`${API_BASE}/api/pipelines`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    staleTime: 30000,
  });

  const { data: stages, isLoading: loadingStages, refetch: refetchStages } = useListPipelineStages();
  const { data: deals, isLoading: loadingDeals, refetch: refetchDeals } = useListDeals({ status: DEAL_STATUS.OPEN });
  const { data: lostDealsData, refetch: refetchLostDeals } = useListDeals({ status: DEAL_STATUS.LOST });
  const { data: allClients, refetch: refetchClients } = useListClients({ limit: 500, page: 1 });
  const { data: tripsData } = useListTrips({ limit: 200 });
  const moveDeal = useMoveDeal();
  const deleteDeal = useDeleteDeal();
  const updateDeal = useUpdateDeal();

  // Initialize selectedPipelineId to default pipeline
  useEffect(() => {
    if (!selectedPipelineId && pipelines?.length) {
      const def = pipelines.find(p => p.isDefault) ?? pipelines[0];
      setSelectedPipelineId(def.id);
    }
  }, [pipelines, selectedPipelineId]);

  // Fallback: init from stages if pipelines not yet loaded
  useEffect(() => {
    if (!selectedPipelineId && stages?.length) {
      setSelectedPipelineId(stages[0].pipelineId ?? null);
    }
  }, [stages, selectedPipelineId]);

  const handleCreateReservation = (deal: Deal) => {
    const params = new URLSearchParams();
    params.set("new", "true");
    if (deal.clientId) params.set("clientId", deal.clientId);
    if (deal.tripId) params.set("tripId", deal.tripId);
    if (deal.value != null) params.set("amount", String(deal.value));
    params.set("dealId", deal.id);
    navigate(`/reservations?${params.toString()}`);
  };

  const handleViewReservation = (reservationId: string) => {
    navigate(`/reservations?reservationId=${reservationId}`);
  };

  const clientsById = useMemo(() => {
    const map = new Map<string, Client>();
    (allClients?.data ?? []).forEach(c => map.set(c.id, c));
    return map;
  }, [allClients]);

  const tripsById = useMemo(() => {
    const map = new Map<string, string>();
    (tripsData?.data ?? []).forEach(t => map.set(t.id, t.name));
    return map;
  }, [tripsData]);

  // Stages visible in the currently selected pipeline
  const visibleStages = useMemo(() => {
    if (!selectedPipelineId) return stages ?? [];
    return (stages ?? []).filter(s => s.pipelineId === selectedPipelineId);
  }, [stages, selectedPipelineId]);

  const visibleStageIds = useMemo(() => new Set(visibleStages.map(s => s.id)), [visibleStages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const filteredDeals = useMemo(() => {
    let d = deals ?? [];
    // Filter to stages in the selected pipeline
    if (visibleStageIds.size > 0) d = d.filter(x => visibleStageIds.has(x.stageId));
    if (filterStageId !== "all") d = d.filter(x => x.stageId === filterStageId);
    if (search.trim()) {
      const q = search.toLowerCase();
      const digitsQ = q.replace(/\D/g, "");
      d = d.filter(x => {
        const tripName = x.tripId ? (tripsById.get(x.tripId) ?? "") : "";
        return x.title.toLowerCase().includes(q) ||
          (x.clientName ?? "").toLowerCase().includes(q) ||
          (x.leadName ?? "").toLowerCase().includes(q) ||
          (x.leadWhatsapp ?? "").includes(q) ||
          (x.clientWhatsapp ?? "").includes(q) ||
          (x.clientEmail ?? "").toLowerCase().includes(q) ||
          (x.leadEmail ?? "").toLowerCase().includes(q) ||
          (x.clientPhone ?? "").includes(q) ||
          (x.clientCpf ?? "").includes(q) ||
          (digitsQ.length > 0 && (x.clientCpf ?? "").replace(/\D/g, "").includes(digitsQ)) ||
          (x.reservationNumber ?? "").toLowerCase().includes(q) ||
          tripName.toLowerCase().includes(q);
      });
    }
    if (filterClassification !== "all") {
      d = d.filter(x => {
        if (!x.clientId) return false;
        return x.clientClassification === filterClassification;
      });
    }
    if (filterCity) {
      d = d.filter(x => {
        if (!x.clientId) return true;
        return (x.clientCity ?? "").toLowerCase().includes(filterCity.toLowerCase());
      });
    }
    return d;
  }, [deals, search, filterStageId, filterClassification, filterCity, visibleStageIds, tripsById]);

  const perdidoStageId = useMemo(
    () => visibleStages.find(s => s.name.toLowerCase() === "perdido")?.id ?? null,
    [visibleStages],
  );

  const filteredLostDeals = useMemo(() => {
    let d = lostDealsData ?? [];
    // Filter to stages in the selected pipeline
    if (visibleStageIds.size > 0) d = d.filter(x => visibleStageIds.has(x.stageId));
    if (search.trim()) {
      const q = search.toLowerCase();
      const digitsQ = q.replace(/\D/g, "");
      d = d.filter(x => {
        const tripName = x.tripId ? (tripsById.get(x.tripId) ?? "") : "";
        return x.title.toLowerCase().includes(q) ||
          (x.clientName ?? "").toLowerCase().includes(q) ||
          (x.leadName ?? "").toLowerCase().includes(q) ||
          (x.leadWhatsapp ?? "").includes(q) ||
          (x.clientWhatsapp ?? "").includes(q) ||
          (x.clientEmail ?? "").toLowerCase().includes(q) ||
          (x.leadEmail ?? "").toLowerCase().includes(q) ||
          (x.clientPhone ?? "").includes(q) ||
          (x.clientCpf ?? "").includes(q) ||
          (digitsQ.length > 0 && (x.clientCpf ?? "").replace(/\D/g, "").includes(digitsQ)) ||
          (x.reservationNumber ?? "").toLowerCase().includes(q) ||
          tripName.toLowerCase().includes(q);
      });
    }
    return d;
  }, [lostDealsData, search, visibleStageIds, tripsById]);

  const dealsByStage = (stageId: string, isLost: boolean) =>
    isLost ? filteredLostDeals.filter(d => d.stageId === stageId) : filteredDeals.filter(d => d.stageId === stageId);

  const handleDragStart = (event: DragStartEvent) => {
    const allDeals = [...(deals ?? []), ...(lostDealsData ?? [])];
    const deal = allDeals.find(d => d.id === event.active.id);
    setActiveDragDeal(deal ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragDeal(null);
    if (!over) return;
    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const allDeals = [...(deals ?? []), ...(lostDealsData ?? [])];
    const deal = allDeals.find(d => d.id === dealId);
    if (!deal || deal.stageId === targetStageId) return;

    const targetStage = stages?.find(s => s.id === targetStageId);
    if (targetStage?.name.toLowerCase() === "perdido") {
      setPendingMarkDeal({ deal, initialMarking: "perdida" });
      return;
    }

    // If dragging OUT of "Perdido", reset status back to open
    if (deal.status === DEAL_STATUS.LOST) {
      await updateDeal.mutateAsync({
        id: dealId,
        data: { stageId: targetStageId, status: DEAL_STATUS.OPEN as "open", lostReason: null },
      });
    } else {
      await moveDeal.mutateAsync({ id: dealId, data: { stageId: targetStageId } });
    }
    refetchDeals();
    refetchLostDeals();
    refetchStages();
  };

  const handleMarkModalConfirm = async (data: CardMarkData) => {
    if (!pendingMarkDeal) return;
    const { deal: markDeal } = pendingMarkDeal;
    const updates: Parameters<typeof updateDeal.mutateAsync>[0]["data"] = {
      travelReason: data.travelReason.trim() || null,
    };
    if (data.marking === "perdida") {
      updates.stageId = perdidoStageId;
      updates.status = DEAL_STATUS.LOST as "lost";
      updates.lostReason = data.lostReason.trim() || null;
      updates.followUpNote = null;
    } else if (data.marking === "follow") {
      updates.followUpNote = data.followUpNote.trim() || null;
      // Keep status/stage unchanged — "Follow" just records a follow-up note
      // regardless of the current deal status (open or lost)
    }
    await updateDeal.mutateAsync({ id: markDeal.id, data: updates });
    setPendingMarkDeal(null);
    refetchDeals();
    refetchLostDeals();
    refetchStages();
  };

  const handleDelete = async (dealId: string) => {
    if (!confirm("Remover este lead do pipeline?")) return;
    await deleteDeal.mutateAsync({ id: dealId });
    refetchDeals();
    refetchLostDeals();
    refetchStages();
  };

  const handleEditClient = async (clientId: string) => {
    const cached = clientsById.get(clientId);
    if (cached) {
      setEditingClient(cached);
      setIsModalOpen(true);
      return;
    }
    // Client not in the local map (map capped at 500 records) — fetch on demand
    try {
      const resp = await fetch(`${API_BASE}/api/clients/${clientId}`, { credentials: "include" });
      if (resp.ok) {
        const client = await resp.json() as Client;
        setEditingClient(client);
        setIsModalOpen(true);
      }
    } catch {
      // silently ignore network errors
    }
  };

  const openNew = (stageId?: string) => {
    setEditingClient(null);
    setDefaultStageId(stageId ?? visibleStages[0]?.id);
    setIsModalOpen(true);
  };

  const handleRenamePipeline = async () => {
    if (!selectedPipelineId || !renameValue.trim()) return;
    await fetch(`${API_BASE}/api/pipelines/${selectedPipelineId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    await refetchPipelines();
    setRenamingPipeline(false);
  };

  const handleDeletePipeline = async () => {
    if (!selectedPipelineId) return;
    if (!confirm(`Excluir o pipeline "${activePipeline?.name}"? Isso também excluirá todas as etapas (sem negócios ativos).`)) return;
    setDeletingPipelineLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/pipelines/${selectedPipelineId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(data.message ?? "Não foi possível excluir o pipeline");
        return;
      }
      setSelectedPipelineId(null);
      await refetchPipelines();
      await refetchStages();
    } finally {
      setDeletingPipelineLoading(false);
    }
  };

  const handleSetDefault = async (pipelineId: string) => {
    setSettingDefault(true);
    try {
      await fetch(`${API_BASE}/api/pipelines/${pipelineId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      await refetchPipelines();
    } finally {
      setSettingDefault(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingClient(null);
    setDefaultStageId(undefined);
  };

  const handleSave = () => {
    refetchClients();
    refetchDeals();
    refetchStages();
  };

  const totalValue = filteredDeals.reduce((acc, d) => acc + d.value, 0);
  const hasFilters = !!(search || filterStageId !== "all" || filterClassification !== "all" || filterCity);
  const activePipeline = pipelines?.find(p => p.id === selectedPipelineId);
  const pipelineId = selectedPipelineId ?? "";

  return (
    <div className="space-y-5 flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
      <div className="flex items-center justify-between flex-shrink-0 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pipeline de Vendas</h1>
            <p className="text-muted-foreground text-sm">
              {filteredDeals.length} leads · {formatCurrency(totalValue)} no funil
            </p>
          </div>
          {/* Pipeline selector */}
          {pipelines && pipelines.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Select
                value={selectedPipelineId ?? ""}
                onValueChange={val => { setSelectedPipelineId(val); setFilterStageId("all"); }}
              >
                <SelectTrigger className="w-52 h-9 font-medium">
                  <SelectValue placeholder="Selecionar pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        {p.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                        <span className="truncate">{p.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Set default */}
              {activePipeline && !activePipeline.isDefault && (
                <button
                  onClick={() => handleSetDefault(activePipeline.id)}
                  disabled={settingDefault}
                  className="text-xs text-muted-foreground hover:text-amber-500 transition-colors flex items-center gap-1 px-1"
                  title="Definir como pipeline padrão"
                >
                  {settingDefault ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                </button>
              )}
              {activePipeline?.isDefault && (
                <span className="text-xs text-amber-500 flex items-center gap-1 px-1">
                  <Star className="w-3 h-3 fill-amber-500" /> Padrão
                </span>
              )}
              {/* Rename / Delete pipeline */}
              {activePipeline && (
                renamingPipeline ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleRenamePipeline();
                        if (e.key === "Escape") setRenamingPipeline(false);
                      }}
                      className="h-7 text-sm w-44"
                      autoFocus
                    />
                    <Button size="sm" className="h-7 px-2" onClick={handleRenamePipeline}>OK</Button>
                    <button onClick={() => setRenamingPipeline(false)} className="p-1 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 text-muted-foreground hover:text-foreground rounded" title="Opções do pipeline">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem onClick={() => { setRenameValue(activePipeline.name); setRenamingPipeline(true); }}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />
                        Renomear
                      </DropdownMenuItem>
                      {!activePipeline.isDefault && (
                        <DropdownMenuItem onClick={() => handleSetDefault(activePipeline.id)}>
                          <Star className="w-3.5 h-3.5 mr-2" />
                          Definir como Padrão
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={handleDeletePipeline}
                        disabled={deletingPipelineLoading}
                        className="text-destructive focus:text-destructive"
                      >
                        {deletingPipelineLoading ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-2" />}
                        Excluir Pipeline
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (pipelines?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkMigrateOpen(true)}
              className="gap-1.5"
            >
              <ArrowRightLeft className="w-4 h-4" />
              Migrar
            </Button>
          )}
          {selectedPipelineId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManageStagesOpen(true)}
              className="gap-1.5"
            >
              <Settings2 className="w-4 h-4" />
              Etapas
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewPipelineOpen(true)}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Pipeline
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnalyticsOpen(v => !v)}
            className="gap-1.5"
          >
            <BarChart2 className="w-4 h-4" />
            Analytics
            {analyticsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          <Button onClick={() => openNew()}>
            <Plus className="w-4 h-4 mr-2" /> Novo Lead
          </Button>
        </div>
      </div>

      {analyticsOpen && pipelineId && (
        <div className="flex-shrink-0 rounded-xl border bg-card p-4 shadow-sm">
          <AnalyticsPanel pipelineId={pipelineId} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar leads, clientes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStageId} onValueChange={setFilterStageId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Estágio" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os estágios</SelectItem>
            {visibleStages.map(s => (
              <SelectItem key={s.id} value={s.id}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterClassification} onValueChange={setFilterClassification}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Classificação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(CLASSIFICATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Cidade..." value={filterCity} onChange={e => setFilterCity(e.target.value)} className="w-32" />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStageId("all"); setFilterClassification("all"); setFilterCity(""); }}>
            <X className="w-4 h-4 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {(loadingStages || loadingDeals) ? (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-64 shrink-0 space-y-3">
              <Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-6 flex-1">
            {visibleStages.map(stage => {
              const isLostStage = stage.name.toLowerCase() === "perdido";
              const stageDeals = dealsByStage(stage.id, isLostStage);
              const stageValue = stageDeals.reduce((acc, d) => acc + d.value, 0);
              return (
                <div
                  key={stage.id}
                  className={`w-64 shrink-0 flex flex-col rounded-xl border bg-muted/30 ${isLostStage ? "border-red-200 bg-red-50/30" : ""}`}
                >
                  <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-sm font-semibold">{stage.name}</span>
                      <Badge
                        variant={isLostStage ? "destructive" : "secondary"}
                        className="text-xs px-1.5 h-5"
                      >
                        {stageDeals.length}
                      </Badge>
                    </div>
                    {!isLostStage && (
                      <button onClick={() => openNew(stage.id)} className="text-muted-foreground hover:text-primary p-1 rounded">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {stageValue > 0 && (
                    <p className="px-3 pb-1.5 text-xs text-muted-foreground">{formatCurrency(stageValue)}</p>
                  )}

                  <DroppableColumn stage={stage}>
                    {stageDeals.map(deal => (
                      <DraggableCard
                        key={deal.id}
                        deal={deal}
                        tripsById={tripsById}
                        onEditClient={handleEditClient}
                        onView360={setClient360Id}
                        onDelete={handleDelete}
                        onCreateReservation={handleCreateReservation}
                        onViewReservation={handleViewReservation}
                        onOpenMarkModal={d => setPendingMarkDeal({ deal: d })}
                        isFinalStage={stage.isFinal}
                        isLostStage={isLostStage}
                      />
                    ))}
                    {stageDeals.length === 0 && !isLostStage && (
                      <button
                        onClick={() => openNew(stage.id)}
                        className="flex items-center justify-center h-16 rounded-lg border-2 border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full"
                      >
                        + Adicionar lead
                      </button>
                    )}
                    {stageDeals.length === 0 && isLostStage && (
                      <div className="flex flex-col items-center justify-center h-16 text-xs text-muted-foreground gap-1">
                        <XCircle className="w-4 h-4 opacity-40" />
                        <span>Nenhum negócio perdido</span>
                      </div>
                    )}
                  </DroppableColumn>
                </div>
              );
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragDeal ? (
              <div className="w-64 opacity-90 shadow-2xl rotate-1">
                <ClientCardContent
                  deal={activeDragDeal}
                  tripsById={tripsById}
                  onEditClient={() => {}}
                  onView360={() => {}}
                  onDelete={() => {}}
                  onCreateReservation={() => {}}
                  onViewReservation={() => {}}
                  isFinalStage={false}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <ClientModal
        open={isModalOpen}
        onClose={closeModal}
        editClient={editingClient}
        onSave={handleSave}
        defaultStageId={defaultStageId}
        pipelineId={selectedPipelineId}
      />
      <Client360Modal open={!!client360Id} onClose={() => setClient360Id(null)} clientId={client360Id} />

      <CardMarkModal
        deal={pendingMarkDeal?.deal ?? null}
        perdidoStageId={perdidoStageId}
        initialMarking={pendingMarkDeal?.initialMarking}
        onClose={() => setPendingMarkDeal(null)}
        onConfirm={handleMarkModalConfirm}
      />

      <NewPipelineModal
        open={newPipelineOpen}
        onClose={() => setNewPipelineOpen(false)}
        onCreated={pipeline => {
          setNewPipelineOpen(false);
          refetchPipelines();
          refetchStages();
          setSelectedPipelineId(pipeline.id);
        }}
      />

      {selectedPipelineId && activePipeline && (
        <ManageStagesModal
          open={manageStagesOpen}
          onClose={() => setManageStagesOpen(false)}
          pipelineId={selectedPipelineId}
          pipelineName={activePipeline.name}
          onChanged={() => { refetchStages(); refetchDeals(); refetchLostDeals(); }}
        />
      )}

      <BulkMigrateModal
        open={bulkMigrateOpen}
        onClose={() => setBulkMigrateOpen(false)}
        pipelines={pipelines ?? []}
        stages={stages ?? []}
        deals={deals ?? []}
        onMigrated={() => { refetchDeals(); refetchLostDeals(); refetchStages(); }}
      />
    </div>
  );
}
