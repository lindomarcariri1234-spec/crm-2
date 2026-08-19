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
  draft: { label: "Rascunho", className: "bg-gray-100 text-gray-800" },
  scheduled: { label: "Agendada", className: "bg-blue-100 text-blue-800" },
  sending: { label: "Enviando", className: "bg-yellow-100 text-yellow-800" },
  sent: { label: "Enviada", className: "bg-green-100 text-green-800" },
  cancelled: { label: "Cancelada", className: "bg-red-100 text-red-800" },
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
    color: "bg-pink-100 text-pink-700",
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
    color: "bg-blue-100 text-blue-700",
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
    color: "bg-orange-100 text-orange-700",
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
    color: "bg-green-100 text-green-700",
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
    color: "bg-purple-100 text-purple-700",
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
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
          </div>
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
    <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2">
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
    <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Segmentação Inteligente
        </span>
        <Button size="sm" variant="outline" onClick={onPreview} disabled={isPreviewing} className="h-7 text-xs gap-1.5">
          {isPreviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
          {isPreviewing ? "Calculando..." : "Pré-visualizar Audiência"}
          {previewCount !== null && !isPreviewing && (
            <Badge className="ml-1 h-5 text-xs bg-primary/15 text-primary border-0">
              {previewCount.toLocaleString("pt-BR")} clientes
            </Badge>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
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
        <div className="col-span-2 space-y-1">
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
  const [campaignType, setCampaignType] = useState("email");
  const [segment, setSegment] = useState<Record<string, unknown>>({});
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const { data: campaigns, isLoading, refetch } = useListCampaigns();
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
        subject: (fd.get("subject") as string) || undefined,
        content: fd.get("content") as string,
        targetSegment: segment,
        scheduledAt: fd.get("scheduledAt") ? (fd.get("scheduledAt") as string) : undefined,
        triggerType: "manual",
      },
    });
    setIsOpen(false);
    setCampaignType("email");
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Campanhas Manuais</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Envios pontuais para segmentos de clientes.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Criar Campanha</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nome da Campanha</Label>
                <Input name="name" required placeholder="Ex: Promoção Verão — Pacotes Nordeste" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Canal</Label>
                  <Select value={campaignType} onValueChange={setCampaignType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Agendar para</Label>
                  <Input name="scheduledAt" type="datetime-local" />
                </div>
              </div>
              {campaignType === "email" && (
                <div className="space-y-2">
                  <Label>Assunto do e-mail</Label>
                  <Input name="subject" placeholder="Assunto do e-mail" required />
                </div>
              )}
              <SegmentPanel
                value={segment}
                onChange={(v) => { setSegment(v); setPreviewCount(null); }}
                onPreview={handleSegmentPreview}
                isPreviewing={isPreviewing}
                previewCount={previewCount}
                trips={trips?.data ?? []}
              />
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea
                  name="content"
                  required
                  rows={5}
                  placeholder="Olá {nome}, temos uma oferta exclusiva para você..."
                />
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Megaphone} label="Campanhas" value={manualCampaigns.length} color="bg-blue-100 text-blue-700" />
        <StatCard icon={Users} label="Destinatários" value={totalRecipients.toLocaleString("pt-BR")} color="bg-purple-100 text-purple-700" />
        <StatCard icon={Send} label="Enviados" value={totalSent.toLocaleString("pt-BR")} color="bg-green-100 text-green-700" />
        <StatCard icon={PackageCheck} label="Entregues" value={totalDelivered.toLocaleString("pt-BR")} color="bg-teal-100 text-teal-700" />
        <StatCard icon={MailOpen} label="Taxa Abertura" value={avgOpen === "—" ? "—" : `${avgOpen}%`} color="bg-orange-100 text-orange-700" />
      </div>

      {analyticsTarget && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Análise: {analyticsTarget.name}
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
                <div key={label} className="text-center">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
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

      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
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
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : manualCampaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                  <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Nenhuma campanha criada.</p>
                  <p className="text-sm mt-1">Crie sua primeira campanha para engajar clientes.</p>
                </TableCell>
              </TableRow>
            ) : (
              manualCampaigns.map((c) => {
                const st = statusConfig[c.status] ?? { label: c.status, className: "" };
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
        <h2 className="text-xl font-semibold">Automações de Marketing</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Campanhas disparadas automaticamente com base no comportamento dos clientes, no horário configurado em cada automação.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((template) => {
          const existing = getExisting(template.triggerType);
          const isEnabled = existing?.autoEnabled ?? false;
          const isConfiguring =
            configuringType === template.triggerType &&
            (createCampaign.isPending || updateCampaign.isPending);

          return (
            <Card key={template.triggerType} className={`relative transition-all ${isEnabled ? "border-primary/40 shadow-sm" : ""}`}>
              {isEnabled && (
                <div className="absolute top-3 right-3">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                    <Zap className="w-3 h-3" /> Ativa
                  </span>
                </div>
              )}
              <CardHeader className="pb-2 pr-24">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${template.color}`}>
                  <template.icon className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-1">
                {existing && (
                  <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5">
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
                    className="flex-1 gap-1.5 text-xs h-8"
                    onClick={() => setConfiguringType(template.triggerType)}
                  >
                    <Settings2 className="w-3 h-3" />
                    {existing ? "Editar" : "Configurar"}
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Switch
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

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-muted-foreground text-center">
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
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-primary" /> Criador de Conteúdo com IA
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Gere e-mail, mensagem de WhatsApp e legenda do Instagram simultaneamente — otimizados para agências de turismo.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
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
            <div className="col-span-2 space-y-2">
              <Label>Público-alvo <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Ex: casais, famílias com crianças, aposentados que viajam em grupo"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !topic.trim()}
              className="gap-2"
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
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="grid gap-4 lg:grid-cols-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-600" /> E-mail Marketing
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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-green-600" /> WhatsApp
                  </span>
                  <CopyButton text={result.whatsapp} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-[#dcf8c6] rounded-2xl rounded-tl-none p-3 text-sm whitespace-pre-wrap max-w-sm leading-relaxed">
                  {result.whatsapp}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Instagram className="w-4 h-4 text-pink-600" /> Instagram
                  </span>
                  <CopyButton text={result.instagram} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-3 border whitespace-pre-wrap leading-relaxed">
                  {result.instagram}
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Use <code className="bg-muted px-1 rounded">{"{nome}"}</code> nos textos para personalizar automaticamente com o nome de cada cliente.
          </p>
        </div>
      )}

      {!result && !isGenerating && !error && (
        <div className="text-center py-16 text-muted-foreground">
          <Wand2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">Preencha os campos acima e clique em Gerar Conteúdo</p>
          <p className="text-sm mt-1">A IA criará e-mail, WhatsApp e legenda do Instagram ao mesmo tempo.</p>
        </div>
      )}
    </div>
  );
}

export default function Campaigns() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Marketing Automatizado</h1>
        <p className="text-muted-foreground mt-1">
          Campanhas inteligentes, automações e criação de conteúdo com IA para sua agência.
        </p>
      </div>

      <Tabs defaultValue="campanhas">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="campanhas" className="gap-1.5">
            <Megaphone className="w-3.5 h-3.5" /> Campanhas
          </TabsTrigger>
          <TabsTrigger value="automacoes" className="gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Automações
          </TabsTrigger>
          <TabsTrigger value="ia" className="gap-1.5">
            <Wand2 className="w-3.5 h-3.5" /> Conteúdo IA
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
