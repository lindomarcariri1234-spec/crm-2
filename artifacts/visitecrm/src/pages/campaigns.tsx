import { useState, useCallback } from "react";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useListTrips,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { ListLoadErrorRow } from "@/components/list-load-error";
import {
  Plus,
  Megaphone,
  Trash2,
  Send,
  Users,
  MailOpen,
  MousePointerClick,
  BarChart2,
  PackageCheck,
  Cake,
  Plane,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Wand2,
  Copy,
  Check,
  Loader2,
  Zap,
  Settings2,
  Eye,
  Mail,
  MessageCircle,
  Instagram,
} from "lucide-react";
import type { Campaign } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendada", className: "bg-secondary text-secondary-foreground" },
  sending: { label: "Enviando", className: "bg-accent text-accent-foreground" },
  sent: { label: "Enviada", className: "bg-primary/10 text-primary" },
  cancelled: { label: "Cancelada", className: "bg-destructive/10 text-destructive" },
};

const typeLabels: Record<string, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

interface AutomationTemplate {
  triggerType: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  defaultConfig: Record<string, number>;
  configKey: string;
  configLabel: string;
  configUnit: string;
  defaultSubject: string;
  defaultContent: string;
}

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    triggerType: "birthday",
    name: "Feliz Aniversário",
    description: "Parabenize clientes dias antes do seu aniversário com uma oferta especial.",
    icon: Cake,
    color: "bg-accent text-accent-foreground",
    defaultConfig: { daysAhead: 3 },
    configKey: "daysAhead",
    configLabel: "Dias antes do aniversário",
    configUnit: "dias",
    defaultSubject: "🎂 Feliz Aniversário, {nome}! Um presente especial para você",
    defaultContent: "<h2>Feliz Aniversário, {nome}! 🎂</h2><p>Em seu aniversário especial, queremos celebrar junto com você! Preparamos uma oferta exclusiva para tornar esse dia ainda mais inesquecível.</p><p>Aproveite condições especiais em nossas próximas viagens.</p><p>Com carinho,<br>Equipe</p>",
  },
  {
    triggerType: "post_trip",
    name: "Pós-Viagem",
    description: "Solicite avaliação e incentive a próxima viagem após o retorno do cliente.",
    icon: Plane,
    color: "bg-primary/10 text-primary",
    defaultConfig: { daysAfter: 7 },
    configKey: "daysAfter",
    configLabel: "Dias após a viagem",
    configUnit: "dias",
    defaultSubject: "Como foi sua viagem, {nome}? Já pensando na próxima?",
    defaultContent: "<h2>Olá, {nome}!</h2><p>Esperamos que você tenha adorado a viagem! Gostaríamos muito de saber como foi sua experiência.</p><p>E que tal já se planejar para a próxima aventura? Nossos roteiros exclusivos estão esperando por você.</p>",
  },
  {
    triggerType: "reactivation",
    name: "Reativação",
    description: "Reconquiste clientes inativos há mais de 120 dias com uma proposta irresistível.",
    icon: RefreshCw,
    color: "bg-secondary text-secondary-foreground",
    defaultConfig: { inactiveDays: 120 },
    configKey: "inactiveDays",
    configLabel: "Dias de inatividade",
    configUnit: "dias",
    defaultSubject: "Saudades de você, {nome}! Novas aventuras te esperam",
    defaultContent: "<h2>Olá, {nome}!</h2><p>Já faz um tempo que não viajamos juntos! Preparamos novidades incríveis e queríamos você por dentro.</p><p>Que tal dar uma olhada em nossas próximas viagens? Temos certeza que algo vai te encantar!</p>",
  },
  {
    triggerType: "repurchase",
    name: "Recompra",
    description: "Estimule a próxima reserva 30 dias após a última viagem concluída.",
    icon: ShoppingBag,
    color: "bg-accent/80 text-accent-foreground",
    defaultConfig: { days: 30 },
    configKey: "days",
    configLabel: "Dias após última viagem",
    configUnit: "dias",
    defaultSubject: "Próxima aventura, {nome}? Veja o que preparamos!",
    defaultContent: "<h2>{nome}, já está na hora de uma nova aventura!</h2><p>Você curtiu tanto a última viagem que preparamos algo especial para você viver mais momentos incríveis conosco.</p><p>Confira nossas próximas saídas com condições exclusivas para clientes fiéis.</p>",
  },
  {
    triggerType: "cart_abandonment",
    name: "Abandono de Reserva",
    description: "Recupere clientes que não concluíram a reserva nas últimas 24 horas.",
    icon: ShoppingCart,
    color: "bg-muted text-foreground",
    defaultConfig: { hours: 24 },
    configKey: "hours",
    configLabel: "Horas após abandono",
    configUnit: "horas",
    defaultSubject: "Sua reserva está te esperando, {nome}!",
    defaultContent: "<h2>Olá, {nome}!</h2><p>Percebemos que você se interessou em uma de nossas viagens mas não concluiu a reserva.</p><p>A boa notícia: ainda temos vagas disponíveis! Garanta a sua antes que se esgotem.</p>",
  },
];

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-border/75 bg-card shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 px-4 py-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <Button size="sm" variant="ghost" onClick={handleCopy} aria-label={copied ? "Conteúdo copiado" : "Copiar conteúdo"} className="h-8 w-8 p-0">
      {copied ? (
        <Check className="w-3 h-3 text-green-600" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </Button>
  );
}

function SegmentPanel({
  value,
  onChange,
  onPreview,
  isPreviewing,
  previewCount,
  trips,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onPreview: () => void;
  isPreviewing: boolean;
  previewCount: number | null;
  trips: Array<{ id: string; name: string; departureDate: string }>;
}) {
  const set = (key: string, val: unknown) => {
    onChange({ ...value, [key]: val || undefined });
  };
  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-secondary/25 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
          Segmentação Inteligente
        </span>
        <Button size="sm" variant="outline" onClick={onPreview} disabled={isPreviewing} className="h-8 gap-1.5 text-xs">
          {isPreviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
          {isPreviewing ? "Calculando..." : "Pré-visualizar Audiência"}
          {previewCount !== null && !isPreviewing && (
            <Badge className="ml-1 h-5 border-0 bg-primary/10 text-[10px] text-primary">
              {previewCount.toLocaleString("pt-BR")} clientes
            </Badge>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Gênero</label>
          <Select value={(value.gender as string) ?? "__all__"} onValueChange={(v) => set("gender", v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="M">Masculino</SelectItem>
              <SelectItem value="F">Feminino</SelectItem>
              <SelectItem value="other">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tier de Fidelidade</label>
          <Select value={(value.tier as string) ?? "__all__"} onValueChange={(v) => set("tier", v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="bronze">Bronze</SelectItem>
              <SelectItem value="silver">Prata</SelectItem>
              <SelectItem value="gold">Ouro</SelectItem>
              <SelectItem value="platinum">Platina</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Idade mínima</label>
          <Input
            type="number"
            min={0}
            max={120}
            placeholder="Ex: 18"
            value={(value.ageMin as string) ?? ""}
            onChange={(e) => set("ageMin", e.target.value ? Number(e.target.value) : "")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Idade máxima</label>
          <Input
            type="number"
            min={0}
            max={120}
            placeholder="Ex: 65"
            value={(value.ageMax as string) ?? ""}
            onChange={(e) => set("ageMax", e.target.value ? Number(e.target.value) : "")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Inativo há (dias)</label>
          <Input
            type="number"
            min={0}
            placeholder="Ex: 90"
            value={(value.inactiveDays as string) ?? ""}
            onChange={(e) => set("inactiveDays", e.target.value ? Number(e.target.value) : "")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Score mínimo (IA)</label>
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="Ex: 60"
            value={(value.minPurchaseScore as string) ?? ""}
            onChange={(e) => set("minPurchaseScore", e.target.value ? Number(e.target.value) : "")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cidade</label>
          <Input
            placeholder="São Paulo"
            value={(value.city as string) ?? ""}
            onChange={(e) => set("city", e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Preferência de Viagem</label>
          <Input
            placeholder="praia, aventura, cultura..."
            value={(value.travelPreference as string) ?? ""}
            onChange={(e) => set("travelPreference", e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="col-span-1 space-y-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Viagem específica</label>
          <Select
            value={(value.tripId as string) ?? "__all__"}
            onValueChange={(v) => set("tripId", v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Todas as viagens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as viagens</SelectItem>
              {trips.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} — {new Date(t.departureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function CampaignsTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [analyticsId, setAnalyticsId] = useState<string | null>(null);
  const [campaignType, setCampaignType] = useState("unified");
  const [segment, setSegment] = useState<Record<string, unknown>>({});
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const { data: campaigns, isLoading, isError, refetch } = useListCampaigns();
  const { data: trips } = useListTrips({ limit: 100 });
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const manualCampaigns = (campaigns ?? []).filter((c) => c.triggerType === "manual" || !c.triggerType);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createCampaign.mutateAsync({
      data: {
        name: fd.get("name") as string,
        type: campaignType,
        subject: (fd.get("emailSubject") as string) || undefined,
        content: fd.get("emailContent") as string,
        triggerConfig: {
          channels: {
            email: {
              subject: (fd.get("emailSubject") as string) || "",
              html: (fd.get("emailContent") as string) || "",
            },
            whatsapp: { text: (fd.get("whatsappContent") as string) || "" },
          },
        },
        targetSegment: segment,
        scheduledAt: fd.get("scheduledAt") ? (fd.get("scheduledAt") as string) : undefined,
        triggerType: "manual",
      },
    });
    setIsOpen(false);
    setCampaignType("unified");
    setSegment({});
    setPreviewCount(null);
    refetch();
  };

  const handleSend = async (id: string) => {
    await updateCampaign.mutateAsync({ id, data: { status: "sending" } });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteCampaign.mutateAsync({ id });
    refetch();
  };

  const handleSegmentPreview = async () => {
    setIsPreviewing(true);
    try {
      const res = await fetch(`${BASE}/api/campaigns/segment-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(segment),
      });
      if (res.ok) {
        const data = await res.json() as { count: number };
        setPreviewCount(data.count);
      }
    } finally {
      setIsPreviewing(false);
    }
  };

  const analyticsTarget = analyticsId
    ? (manualCampaigns).find((c) => c.id === analyticsId)
    : undefined;

  const getDelivered = (c: Campaign) => c.deliveredCount ?? 0;
  const totalRecipients = manualCampaigns.reduce((s, c) => s + c.recipientsCount, 0);
  const totalSent = manualCampaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalDelivered = manualCampaigns.reduce((s, c) => s + getDelivered(c), 0);
  const totalOpened = manualCampaigns.reduce((s, c) => s + c.openedCount, 0);
  const avgOpen = totalDelivered > 0 ? ((totalOpened / totalDelivered) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Relacionamento e alcance</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Campanhas manuais</h2>
          <p className="mt-1 text-sm text-muted-foreground">Envios pontuais para segmentos de clientes.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 w-full rounded-lg sm:w-auto">
              <Plus className="w-4 h-4 mr-2" /> Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input name="name" required placeholder="Ex: Promoção Verão — Pacotes Nordeste" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Canal</Label>
                  <Select value={campaignType} onValueChange={setCampaignType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unified">E-mail + WhatsApp</SelectItem>
                      <SelectItem value="email">Somente E-mail</SelectItem>
                      <SelectItem value="whatsapp">Somente WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Agendar para</Label>
                  <Input name="scheduledAt" type="datetime-local" />
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-secondary/35 p-3 text-xs leading-relaxed text-muted-foreground">
                Uma campanha unificada cria uma entrega independente por canal para cada destinatário. Uma falha não duplica nem bloqueia a outra.
              </div>
              <SegmentPanel
                value={segment}
                onChange={(v) => { setSegment(v); setPreviewCount(null); }}
                onPreview={handleSegmentPreview}
                isPreviewing={isPreviewing}
                previewCount={previewCount}
                trips={trips?.data ?? []}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                <Label>Assunto e conteúdo do E-mail</Label>
                <Input name="emailSubject" placeholder="Assunto do e-mail" required={campaignType !== "whatsapp"} />
                <Textarea
                  name="emailContent"
                  required={campaignType !== "whatsapp"}
                  rows={5}
                  placeholder="HTML/texto do e-mail..."
                />
                </div>
                <div className="space-y-2">
                <Label>Conteúdo do WhatsApp</Label>
                <Textarea name="whatsappContent" required={campaignType !== "email"} rows={7} placeholder="Texto do WhatsApp..." />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createCampaign.isPending}>
                  {createCampaign.isPending ? "Criando..." : "Criar Campanha"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={Megaphone} label="Campanhas" value={manualCampaigns.length} color="bg-primary/10 text-primary" />
        <StatCard icon={Users} label="Destinatários" value={totalRecipients.toLocaleString("pt-BR")} color="bg-secondary text-secondary-foreground" />
        <StatCard icon={Send} label="Enviados" value={totalSent.toLocaleString("pt-BR")} color="bg-accent/80 text-accent-foreground" />
        <StatCard icon={PackageCheck} label="Entregues" value={totalDelivered.toLocaleString("pt-BR")} color="bg-primary/10 text-primary" />
        <StatCard icon={MailOpen} label="Taxa Abertura" value={avgOpen === "—" ? "—" : `${avgOpen}%`} color="bg-accent text-accent-foreground" />
      </div>

      {analyticsTarget && (
        <Card className="overflow-hidden rounded-xl border-primary/25 bg-primary/[0.035] shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <BarChart2 className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">Análise: {analyticsTarget.name}</span>
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setAnalyticsId(null)}>
                Fechar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {[
                { label: "Destinatários", value: analyticsTarget.recipientsCount, base: null },
                { label: "Enviados", value: analyticsTarget.sentCount, base: analyticsTarget.recipientsCount },
                { label: "Entregues", value: getDelivered(analyticsTarget), base: analyticsTarget.sentCount },
                { label: "Abertos", value: analyticsTarget.openedCount, base: getDelivered(analyticsTarget) },
                { label: "Cliques", value: analyticsTarget.clickedCount, base: analyticsTarget.openedCount },
              ].map(({ label, value, base }) => (
                <div key={label} className="rounded-lg border border-border/60 bg-card/80 px-2 py-3 text-center">
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
                  {base !== null && base > 0 && (
                    <p className="text-xs text-primary font-medium">
                      {((value / base) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Destinatários</TableHead>
                <TableHead className="text-right">Enviados</TableHead>
                <TableHead className="text-right">Entregues</TableHead>
                <TableHead className="text-right">Abertos</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead>Data</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <ListLoadErrorRow
                  colSpan={10}
                  onRetry={refetch}
                  message="Não foi possível carregar as campanhas."
                />
              ) : manualCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    <Megaphone className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p className="font-medium text-foreground">Nenhuma campanha criada.</p>
                    <p className="mt-1 text-sm">Crie sua primeira campanha para engajar clientes.</p>
                  </TableCell>
                </TableRow>
              ) : (
                manualCampaigns.map((c) => {
                  const st = statusConfig[c.status] ?? { label: c.status, className: "" };
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                      <TableCell><Badge variant="outline">{typeLabels[c.type] ?? c.type}</Badge></TableCell>
                      <TableCell><Badge className={st.className} variant="secondary">{st.label}</Badge></TableCell>
                      <TableCell className="text-right">{c.recipientsCount}</TableCell>
                      <TableCell className="text-right">{c.sentCount}</TableCell>
                      <TableCell className="text-right">
                        {getDelivered(c)}
                        {c.sentCount > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">({((getDelivered(c) / c.sentCount) * 100).toFixed(0)}%)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.openedCount}
                        {getDelivered(c) > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">({((c.openedCount / getDelivered(c)) * 100).toFixed(0)}%)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.clickedCount}
                        {c.openedCount > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">({((c.clickedCount / c.openedCount) * 100).toFixed(0)}%)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.sentAt ? new Date(c.sentAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setAnalyticsId(analyticsId === c.id ? null : c.id)} title="Ver análise">
                            <BarChart2 className="w-4 h-4" />
                          </Button>
                          {c.status === "draft" && (
                            <Button size="sm" variant="ghost" onClick={() => handleSend(c.id)} title="Enviar agora">
                              <Send className="w-4 h-4 text-primary" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)} title="Excluir">
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

interface AutomationConfigState {
  subject: string;
  content: string;
  configValue: number;
  sendHour: number;
}

function AutomationConfigDialog({
  template,
  existing,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  template: AutomationTemplate;
  existing?: Campaign;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (data: AutomationConfigState) => void;
  isSaving: boolean;
}) {
  const defaultVal = existing?.triggerConfig?.[template.configKey] as number | undefined;
  const defaultSendHour = existing?.triggerConfig?.["sendHour"] as number | undefined;
  const [subject, setSubject] = useState(existing?.subject ?? template.defaultSubject);
  const [content, setContent] = useState(existing?.content ?? template.defaultContent);
  const [configValue, setConfigValue] = useState<number>(
    defaultVal ?? Object.values(template.defaultConfig)[0]!
  );
  const [sendHour, setSendHour] = useState<number>(defaultSendHour ?? 8);

  const handleSave = () => {
    onSave({ subject, content, configValue, sendHour });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <template.icon className="w-5 h-5" />
            Configurar: {template.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>{template.configLabel}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={configValue}
                onChange={(e) => setConfigValue(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">{template.configUnit}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Horário de envio</Label>
            <Select value={String(sendHour)} onValueChange={(v) => setSendHour(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Horário em que os e-mails serão disparados (fuso de Brasília).</p>
          </div>
          <div className="space-y-2">
            <Label>Assunto do e-mail</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto..." />
            <p className="text-xs text-muted-foreground">Use {"{nome}"} para personalizar com o nome do cliente.</p>
          </div>
          <div className="space-y-2">
            <Label>Conteúdo / Mensagem</Label>
            <Textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Conteúdo do e-mail ou mensagem..."
            />
            <p className="text-xs text-muted-foreground">Suporta HTML para e-mail. Use {"{nome}"} para personalizar.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar Automação"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AutomationsTab() {
  const { data: campaigns, refetch } = useListCampaigns();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const [configuringType, setConfiguringType] = useState<string | null>(null);

  const automationCampaigns = (campaigns ?? []).filter((c) => c.triggerType && c.triggerType !== "manual");
  const getExisting = (triggerType: string) => automationCampaigns.find((c) => c.triggerType === triggerType);

  const handleToggle = async (triggerType: string, currentEnabled: boolean) => {
    const existing = getExisting(triggerType);
    if (existing) {
      await updateCampaign.mutateAsync({ id: existing.id, data: { autoEnabled: !currentEnabled } });
      refetch();
    }
  };

  const handleSaveConfig = async (template: AutomationTemplate, data: AutomationConfigState) => {
    const existing = getExisting(template.triggerType);
    const triggerConfig = { [template.configKey]: data.configValue, sendHour: data.sendHour };

    if (existing) {
      await updateCampaign.mutateAsync({
        id: existing.id,
        data: {
          subject: data.subject,
          content: data.content,
          triggerConfig,
        },
      });
    } else {
      await createCampaign.mutateAsync({
        data: {
          name: template.name,
          type: "email",
          subject: data.subject,
          content: data.content,
          targetSegment: {},
          triggerType: template.triggerType,
          triggerConfig,
          autoEnabled: false,
        },
      });
    }
    setConfiguringType(null);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Relacionamento recorrente</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Automações de marketing</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Campanhas disparadas automaticamente com base no comportamento dos clientes, no horário configurado em cada automação.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((template) => {
          const existing = getExisting(template.triggerType);
          const isEnabled = existing?.autoEnabled ?? false;
          const isConfiguring =
            configuringType === template.triggerType &&
            (createCampaign.isPending || updateCampaign.isPending);

          return (
            <Card key={template.triggerType} className={`relative overflow-hidden rounded-xl border-border/75 bg-card shadow-sm transition-all hover:shadow-md ${isEnabled ? "border-primary/35" : ""}`}>
              {isEnabled && (
                <div className="absolute top-3 right-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    <Zap className="h-3 w-3" aria-hidden="true" /> Ativa
                  </span>
                </div>
              )}
              <CardHeader className="pb-2 pr-24">
                <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl ${template.color}`}>
                  <template.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle className="text-base tracking-tight">{template.name}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-1">
                {existing && (
                  <div className="rounded-lg border border-border/60 bg-secondary/35 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium">{template.configLabel}:</span>{" "}
                    {(existing.triggerConfig?.[template.configKey] as number | undefined) ??
                      Object.values(template.defaultConfig)[0]}{" "}
                    {template.configUnit}
                    {existing.sentCount > 0 && (
                      <span className="ml-2 text-primary">· {existing.sentCount} envios</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 gap-1.5 text-xs"
                    onClick={() => setConfiguringType(template.triggerType)}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    {existing ? "Editar" : "Configurar"}
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      aria-label={`${isEnabled ? "Desativar" : "Ativar"} automação ${template.name}`}
                      checked={isEnabled}
                      disabled={!existing || updateCampaign.isPending}
                      onCheckedChange={() => handleToggle(template.triggerType, isEnabled)}
                    />
                  </div>
                </div>
              </CardContent>

              {configuringType === template.triggerType && (
                <AutomationConfigDialog
                  template={template}
                  existing={existing}
                  open={true}
                  onOpenChange={(v) => { if (!v) setConfiguringType(null); }}
                  onSave={(data) => handleSaveConfig(template, data)}
                  isSaving={isConfiguring}
                />
              )}
            </Card>
          );
        })}
      </div>

      <Card className="rounded-xl border-dashed border-border bg-secondary/30 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Como funciona:</strong> Configure cada automação com o conteúdo desejado, ative o toggle e o sistema enviará automaticamente para os clientes elegíveis a cada dia às 8h (horário de Brasília). Cada cliente recebe a mensagem apenas uma vez por campanha.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface AiContentResult {
  email: string;
  whatsapp: string;
  instagram: string;
}

function AiContentTab() {
  const [topic, setTopic] = useState("");
  const [destination, setDestination] = useState("");
  const [tone, setTone] = useState("entusiástico");
  const [audience, setAudience] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<AiContentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE}/api/ai-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic, destination, tone, audience }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Erro ao gerar conteúdo");
        return;
      }
      const data = await res.json() as AiContentResult;
      setResult(data);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Laboratório de conteúdo</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <Wand2 className="h-5 w-5 text-primary" aria-hidden="true" /> Criador de conteúdo com IA
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Gere e-mail, mensagem de WhatsApp e legenda do Instagram simultaneamente — otimizados para agências de turismo.
        </p>
      </div>

      <Card className="overflow-hidden rounded-xl border-border/75 bg-card shadow-sm">
        <CardContent className="space-y-4 px-4 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Tema / Produto <span className="text-destructive">*</span></Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ex: Pacote 5 dias em Fernando de Noronha com mergulho"
              />
            </div>
            <div className="space-y-2">
              <Label>Destino <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ex: Fernando de Noronha, PE"
              />
            </div>
            <div className="space-y-2">
              <Label>Tom da Comunicação</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entusiástico">Entusiástico e animado</SelectItem>
                  <SelectItem value="formal">Formal e profissional</SelectItem>
                  <SelectItem value="casual">Casual e descontraído</SelectItem>
                  <SelectItem value="urgente">Urgente — oferta por tempo limitado</SelectItem>
                  <SelectItem value="emocional">Emocional — sonho e experiência</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Público-alvo <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Ex: casais, famílias com crianças, aposentados que viajam em grupo"
              />
            </div>
          </div>
          <div className="flex justify-stretch sm:justify-end">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !topic.trim()}
              className="h-10 w-full gap-2 rounded-lg sm:w-auto"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Gerando conteúdo...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" /> Gerar Conteúdo
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="rounded-xl border-destructive/30 bg-destructive/5 shadow-none" role="alert">
          <CardContent className="px-4 py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="grid gap-4 lg:grid-cols-1">
          <Card className="overflow-hidden rounded-xl border-border/75 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" /> E-mail Marketing
                </span>
                <CopyButton text={result.email} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <iframe
                srcDoc={result.email}
                sandbox=""
                className="w-full rounded-lg border bg-white"
                style={{ height: "280px" }}
                title="Prévia do e-mail"
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="rounded-xl border-border/75 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-primary" /> WhatsApp
                  </span>
                  <CopyButton text={result.whatsapp} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-w-full rounded-2xl rounded-tl-md border border-border/60 bg-secondary/45 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground sm:max-w-sm">
                  {result.whatsapp}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl border-border/75 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Instagram className="h-4 w-4 text-primary" /> Instagram
                  </span>
                  <CopyButton text={result.instagram} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border/60 bg-accent/25 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {result.instagram}
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{"{nome}"}</code> nos textos para personalizar automaticamente com o nome de cada cliente.
          </p>
        </div>
      )}

      {!result && !isGenerating && !error && (
        <div className="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-5 py-10 text-center text-muted-foreground">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <Wand2 className="h-5 w-5" />
          </span>
          <p className="font-medium text-foreground">Preencha os campos acima e clique em Gerar Conteúdo</p>
          <p className="mt-1 text-sm">A IA criará e-mail, WhatsApp e legenda do Instagram ao mesmo tempo.</p>
        </div>
      )}
    </div>
  );
}

export default function Campaigns() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-accent/35" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">VisiteCRM · Relacionamento</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Marketing e campanhas</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Campanhas inteligentes, automações e criação de conteúdo com IA para sua agência.
          </p>
        </div>
      </div>

      <Tabs defaultValue="campanhas">
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-3 gap-1 rounded-xl border border-border/70 bg-secondary/45 p-1">
          <TabsTrigger value="campanhas" className="min-h-10 gap-1.5 rounded-lg px-2 text-[11px] sm:text-sm">
            <Megaphone className="h-3.5 w-3.5 shrink-0" /> Campanhas
          </TabsTrigger>
          <TabsTrigger value="automacoes" className="min-h-10 gap-1.5 rounded-lg px-2 text-[11px] sm:text-sm">
            <Zap className="h-3.5 w-3.5 shrink-0" /> Automações
          </TabsTrigger>
          <TabsTrigger value="ia" className="min-h-10 gap-1.5 rounded-lg px-2 text-[11px] sm:text-sm">
            <Wand2 className="h-3.5 w-3.5 shrink-0" /> Conteúdo IA
          </TabsTrigger>
        </TabsList>
        <TabsContent value="campanhas" className="mt-6">
          <CampaignsTab />
        </TabsContent>
        <TabsContent value="automacoes" className="mt-6">
          <AutomationsTab />
        </TabsContent>
        <TabsContent value="ia" className="mt-6">
          <AiContentTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
