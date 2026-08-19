import { useState, useMemo, useEffect } from "react";
import { localToday } from "@workspace/shared";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListCoupons,
  useCreateCoupon,
  useUpdateCoupon,
  useDeleteCoupon,
  useListClients,
  getListClientsQueryKey,
  useGetBirthdayToday,
  getGetBirthdayTodayQueryKey,
  useGetBirthdayUpcoming,
  getGetBirthdayUpcomingQueryKey,
  useGetBirthdayHistory,
  getGetBirthdayHistoryQueryKey,
  useGetBirthdayStats,
  getGetBirthdayStatsQueryKey,
  useGetBirthdaySettings,
  getGetBirthdaySettingsQueryKey,
  sendBirthdayMessage,
  updateBirthdaySettings,
} from "@workspace/api-client-react";
import type { CreateCouponBodyType, BirthdaySettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Tag,
  Trash2,
  Pencil,
  Cake,
  Ticket,
  CheckCircle2,
  XCircle,
  Send,
  MessageCircle,
  Mail,
  Settings,
  History,
  TrendingUp,
  Users,
  Gift,
  CalendarDays,
  Loader2,
} from "lucide-react";
import type { Coupon } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";


const VALID_MARKETING_TABS = ["coupons", "birthdays"];
const VALID_BIRTHDAY_SUBTABS = ["today", "upcoming7", "upcoming30", "history", "settings"];

export default function Marketing() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    return VALID_MARKETING_TABS.includes(t ?? "") ? t! : "coupons";
  });
  const [birthdaySubTab, setBirthdaySubTab] = useState(() => {
    const s = new URLSearchParams(searchStr).get("subtab");
    return VALID_BIRTHDAY_SUBTABS.includes(s ?? "") ? s! : "today";
  });

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const t = params.get("tab");
    if (t && VALID_MARKETING_TABS.includes(t)) setTab(t);
    const s = params.get("subtab");
    if (s && VALID_BIRTHDAY_SUBTABS.includes(s)) setBirthdaySubTab(s);
  }, [searchStr]);

  function handleTabChange(value: string) {
    setTab(value);
    const params = new URLSearchParams(searchStr);
    params.set("tab", value);
    params.delete("subtab");
    navigate(`?${params.toString()}`, { replace: true });
  }

  function handleSubTabChange(value: string) {
    setBirthdaySubTab(value);
    const params = new URLSearchParams(searchStr);
    params.set("subtab", value);
    navigate(`?${params.toString()}`, { replace: true });
  }
  const [isOpen, setIsOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [couponType, setCouponType] = useState<CreateCouponBodyType>("percentage");
  const [sendingClientId, setSendingClientId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<Partial<BirthdaySettings>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [manualSendOpen, setManualSendOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const qc = useQueryClient();

  const { data: coupons, isLoading: loadingCoupons, refetch } = useListCoupons();

  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const deleteCoupon = useDeleteCoupon();

  const { data: bdToday, isLoading: loadingToday, refetch: refetchToday } = useGetBirthdayToday({
    query: { enabled: tab === "birthdays", queryKey: getGetBirthdayTodayQueryKey() },
  });
  const { data: bdUpcoming7, isLoading: loadingUpcoming7 } = useGetBirthdayUpcoming(
    { days: 7 },
    { query: { enabled: tab === "birthdays" && birthdaySubTab === "upcoming7", queryKey: getGetBirthdayUpcomingQueryKey({ days: 7 }) } }
  );
  const { data: bdUpcoming30, isLoading: loadingUpcoming30 } = useGetBirthdayUpcoming(
    { days: 30 },
    { query: { enabled: tab === "birthdays" && birthdaySubTab === "upcoming30", queryKey: getGetBirthdayUpcomingQueryKey({ days: 30 }) } }
  );
  const { data: bdHistory, isLoading: loadingHistory } = useGetBirthdayHistory(
    { year: Number(localToday().slice(0, 4)) },
    { query: { enabled: tab === "birthdays" && birthdaySubTab === "history", queryKey: getGetBirthdayHistoryQueryKey({ year: Number(localToday().slice(0, 4)) }) } }
  );
  const { data: bdStats } = useGetBirthdayStats({
    query: { enabled: tab === "birthdays", queryKey: getGetBirthdayStatsQueryKey() },
  });
  const { data: bdSettings, isLoading: loadingSettings } = useGetBirthdaySettings({
    query: { enabled: tab === "birthdays" && birthdaySubTab === "settings", refetchOnWindowFocus: false, queryKey: getGetBirthdaySettingsQueryKey() },
  });

  const { data: allClientsData } = useListClients({ limit: 1000, page: 1 }, {
    query: { enabled: manualSendOpen, queryKey: getListClientsQueryKey({ limit: 1000, page: 1 }) },
  });

  const filteredClients = useMemo(() => {
    const clients = allClientsData?.data ?? [];
    if (!clientSearch.trim()) return clients.slice(0, 20);
    const q = clientSearch.toLowerCase();
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.whatsapp ?? "").includes(q))
      .slice(0, 20);
  }, [allClientsData, clientSearch]);

  const saveSettings = useMutation({
    mutationFn: (data: BirthdaySettings) => updateBirthdaySettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/birthday/settings"] });
      setSettingsDirty(false);
      toast({ title: "Configurações salvas com sucesso" });
    },
    onError: () => toast({ title: "Erro ao salvar configurações", variant: "destructive" }),
  });

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = (fd.get("code") as string).toUpperCase();
    const value = fd.get("value") as string;
    const minOrderValue = (fd.get("minOrderValue") as string) || undefined;
    const maxUsesRaw = fd.get("maxUses") as string;
    const maxUses = maxUsesRaw ? parseInt(maxUsesRaw, 10) : undefined;
    const validFrom = (fd.get("validFrom") as string) || undefined;
    const validUntil = (fd.get("validUntil") as string) || undefined;
    if (editingCoupon) {
      await updateCoupon.mutateAsync({
        id: editingCoupon.id,
        data: {
          code,
          value,
          type: couponType,
          isActive: editingCoupon.isActive,
          minOrderValue,
          maxUses,
          validFrom,
          validUntil,
        },
      });
    } else {
      await createCoupon.mutateAsync({
        data: {
          code,
          type: couponType,
          value,
          minOrderValue,
          maxUses,
          isActive: true,
          validFrom,
          validUntil,
        },
      });
    }
    setIsOpen(false);
    setEditingCoupon(null);
    setCouponType("percentage");
    refetch();
  };

  const handleToggle = async (c: Coupon) => {
    await updateCoupon.mutateAsync({
      id: c.id,
      data: {
        code: c.code,
        value: c.value,
        type: c.type as CreateCouponBodyType,
        isActive: !c.isActive,
      },
    });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteCoupon.mutateAsync({ id });
    refetch();
  };

  const openEdit = (c: Coupon) => {
    setEditingCoupon(c);
    setCouponType(c.type as CreateCouponBodyType);
    setIsOpen(true);
  };

  const handleSendBirthday = async (clientId: string) => {
    setSendingClientId(clientId);
    try {
      const result = await sendBirthdayMessage(clientId);
      if (result.success) {
        toast({ title: `Mensagem enviada! Cupom: ${result.couponCode ?? ""}` });
      } else {
        toast({ title: result.error ?? "Falha ao enviar", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["/api/birthday/today"] });
      refetchToday();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Erro ao enviar", variant: "destructive" });
    } finally {
      setSendingClientId(null);
    }
  };

  const handleSettingsChange = (key: keyof BirthdaySettings, value: unknown) => {
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
    setSettingsDirty(true);
  };

  const mergedSettings: BirthdaySettings = {
    enabled: true,
    discountPercent: 10,
    validDays: 30,
    sendWhatsapp: true,
    sendEmail: true,
    ...(bdSettings ?? {}),
    ...settingsForm,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="text-muted-foreground mt-1">
            Cupons de desconto e calendário de aniversariantes.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="coupons">
            <Ticket className="w-4 h-4 mr-1.5" /> Cupons
          </TabsTrigger>
          <TabsTrigger value="birthdays">
            <Cake className="w-4 h-4 mr-1.5" /> Aniversariantes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="coupons" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog
              open={isOpen}
              onOpenChange={(o) => {
                setIsOpen(o);
                if (!o) setEditingCoupon(null);
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Novo Cupom
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {editingCoupon ? "Editar Cupom" : "Criar Cupom"}
                  </DialogTitle>
                </DialogHeader>
                <form
                  key={editingCoupon?.id ?? "new"}
                  onSubmit={handleSave}
                  className="space-y-4 mt-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Código</label>
                      <Input
                        name="code"
                        required
                        placeholder="VERAO2025"
                        defaultValue={editingCoupon?.code ?? ""}
                        className="uppercase"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tipo</label>
                      <Select
                        value={couponType}
                        onValueChange={(v) =>
                          setCouponType(v as CreateCouponBodyType)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentual (%)</SelectItem>
                          <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        {couponType === "percentage" ? "Desconto (%)" : "Desconto (R$)"}
                      </label>
                      <Input
                        name="value"
                        required
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={couponType === "percentage" ? "10" : "50"}
                        defaultValue={editingCoupon?.value ?? ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pedido mínimo (R$)</label>
                      <Input
                        name="minOrderValue"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        defaultValue={editingCoupon?.minOrderValue ?? ""}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Usos máximos</label>
                      <Input
                        name="maxUses"
                        type="number"
                        min="1"
                        placeholder="Ilimitado"
                        defaultValue={editingCoupon?.maxUses ?? ""}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Válido de</label>
                      <Input
                        name="validFrom"
                        type="date"
                        defaultValue={editingCoupon?.validFrom?.split("T")[0] ?? ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Válido até</label>
                      <Input
                        name="validUntil"
                        type="date"
                        defaultValue={editingCoupon?.validUntil?.split("T")[0] ?? ""}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsOpen(false);
                        setEditingCoupon(null);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={createCoupon.isPending || updateCoupon.isPending}
                    >
                      {createCoupon.isPending || updateCoupon.isPending
                        ? "Salvando..."
                        : editingCoupon
                        ? "Salvar"
                        : "Criar Cupom"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 mb-2">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total de Cupons</p>
                    <p className="text-xl font-bold">{(coupons ?? []).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 text-green-700">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ativos</p>
                    <p className="text-xl font-bold">
                      {(coupons ?? []).filter((c) => c.isActive).length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-100 text-orange-700">
                    <Ticket className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Utilizações</p>
                    <p className="text-xl font-bold">
                      {(coupons ?? []).reduce((s, c) => s + c.usedCount, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Desconto</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCoupons ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (coupons ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground"
                    >
                      <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">Nenhum cupom cadastrado.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  (coupons ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <code className="font-mono font-semibold tracking-wider bg-muted px-2 py-0.5 rounded text-sm">
                          {c.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {c.type === "percentage" ? "Percentual" : "Valor Fixo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.type === "percentage"
                          ? `${c.value}%`
                          : `R$ ${parseFloat(c.value).toFixed(2)}`}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {c.usedCount}
                          {c.maxUses ? (
                            <span className="text-muted-foreground">/{c.maxUses}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.validUntil
                          ? new Date(c.validUntil).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={c.isActive}
                          onCheckedChange={() => handleToggle(c)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(c.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="birthdays" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Cake className="w-4 h-4 text-pink-500" />
                  <span className="text-xs text-muted-foreground">Hoje</span>
                </div>
                <p className="text-2xl font-bold">{bdStats?.todayCount ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Próx. 7 dias</span>
                </div>
                <p className="text-2xl font-bold">{bdStats?.upcomingWeek ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Send className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Enviados (mês)</span>
                </div>
                <p className="text-2xl font-bold">{bdStats?.sentThisMonth ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-sky-500" />
                  <span className="text-xs text-muted-foreground">Emails abertos</span>
                </div>
                <p className="text-2xl font-bold">{bdStats?.emailOpened ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">Taxa conversão</span>
                </div>
                <p className="text-2xl font-bold">{bdStats?.conversionRate ?? 0}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground">Receita gerada</span>
                </div>
                <p className="text-2xl font-bold">
                  R$ {(bdStats?.revenueGenerated ?? 0).toFixed(0)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Dialog open={manualSendOpen} onOpenChange={(v) => { setManualSendOpen(v); if (!v) setClientSearch(""); }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Send className="w-3.5 h-3.5 mr-1.5" /> Enviar para qualquer cliente
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Enviar mensagem de aniversário</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                  <Input
                    placeholder="Buscar por nome, email ou WhatsApp..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                  />
                  <div className="max-h-72 overflow-y-auto divide-y border rounded-md">
                    {filteredClients.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-8">
                        {clientSearch ? "Nenhum cliente encontrado" : "Carregando clientes..."}
                      </p>
                    ) : filteredClients.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50">
                        <div>
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email ?? c.whatsapp ?? "Sem contato"}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs shrink-0"
                          disabled={sendingClientId === c.id}
                          onClick={async () => {
                            await handleSendBirthday(c.id);
                            setManualSendOpen(false);
                            setClientSearch("");
                          }}
                        >
                          {sendingClientId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3 mr-1" />Enviar</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Tabs value={birthdaySubTab} onValueChange={handleSubTabChange}>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="today" className="text-xs">
                <Cake className="w-3 h-3 mr-1" /> Hoje
              </TabsTrigger>
              <TabsTrigger value="upcoming7" className="text-xs">
                <CalendarDays className="w-3 h-3 mr-1" /> Próximos 7 dias
              </TabsTrigger>
              <TabsTrigger value="upcoming30" className="text-xs">
                <Users className="w-3 h-3 mr-1" /> Próximos 30 dias
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs">
                <History className="w-3 h-3 mr-1" /> Histórico
              </TabsTrigger>
              <TabsTrigger value="settings" className="text-xs">
                <Settings className="w-3 h-3 mr-1" /> Configurações
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Aniversariantes de hoje — {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingToday ? (
                    <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                  ) : !bdToday?.length ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Cake className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhum aniversariante hoje.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bdToday.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-pink-200 bg-pink-50">
                          <div className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-muted-foreground">{c.whatsapp}</span>
                              {c.birthdayMessage ? (
                                <div className="flex items-center gap-1">
                                  {c.birthdayMessage.sentWhatsapp && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-green-400 text-green-700">
                                      <MessageCircle className="w-2.5 h-2.5 mr-0.5" /> WhatsApp
                                    </Badge>
                                  )}
                                  {c.birthdayMessage.sentEmail && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-blue-400 text-blue-700">
                                      <Mail className="w-2.5 h-2.5 mr-0.5" /> Email
                                    </Badge>
                                  )}
                                  {c.birthdayMessage.couponCode && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-purple-400 text-purple-700">
                                      <Gift className="w-2.5 h-2.5 mr-0.5" /> {c.birthdayMessage.couponCode}
                                    </Badge>
                                  )}
                                  {c.birthdayMessage.converted && (
                                    <Badge className="text-[10px] py-0 px-1.5 bg-emerald-500 hover:bg-emerald-500">
                                      <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Convertido
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">
                                  Não enviado
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={c.birthdayMessage ? "outline" : "default"}
                            className={c.birthdayMessage ? "text-xs" : "text-xs bg-pink-500 hover:bg-pink-600"}
                            disabled={sendingClientId === c.id}
                            onClick={() => handleSendBirthday(c.id)}
                          >
                            {sendingClientId === c.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <><Send className="w-3 h-3 mr-1" />{c.birthdayMessage ? "Reenviar" : "Enviar"}</>
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upcoming7" className="mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Próximos 7 dias
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingUpcoming7 ? (
                    <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                  ) : !bdUpcoming7?.length ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhum aniversariante nos próximos 7 dias.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bdUpcoming7.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                            {c.daysUntil}d
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.whatsapp} • {c.email}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            Em {c.daysUntil} dia{c.daysUntil !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upcoming30" className="mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Próximos 30 dias
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingUpcoming30 ? (
                    <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                  ) : !bdUpcoming30?.length ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhum aniversariante nos próximos 30 dias.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bdUpcoming30.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold text-sm shrink-0">
                            {c.daysUntil}d
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.whatsapp} • {c.email}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            Em {c.daysUntil} dias
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Histórico de envios — {Number(localToday().slice(0, 4))}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingHistory ? (
                    <div className="space-y-2 p-4">{[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : !bdHistory?.length ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhum envio registrado este ano.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Canais</TableHead>
                          <TableHead>Cupom</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Origem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bdHistory.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">{m.client?.name ?? m.clientId}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {m.sentWhatsapp ? (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-green-400 text-green-700">
                                    <MessageCircle className="w-2.5 h-2.5 mr-0.5" /> WA
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">WA ✗</Badge>
                                )}
                                {m.sentEmail ? (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-blue-400 text-blue-700">
                                    <Mail className="w-2.5 h-2.5 mr-0.5" /> Email
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">Email ✗</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{m.couponCode ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(m.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={m.isManual ? "secondary" : "outline"} className="text-[10px] py-0">
                                {m.isManual ? "Manual" : "Auto"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settings" className="mt-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Configurações de Aniversário</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {loadingSettings ? (
                    <div className="space-y-4">{[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium">Envios automáticos</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Ativar envio automático diário de mensagens de aniversário
                          </p>
                        </div>
                        <Switch
                          checked={mergedSettings.enabled}
                          onCheckedChange={(v) => handleSettingsChange("enabled", v)}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Desconto (%)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={mergedSettings.discountPercent}
                            onChange={(e) => handleSettingsChange("discountPercent", parseInt(e.target.value, 10))}
                          />
                          <p className="text-xs text-muted-foreground">Percentual de desconto do cupom</p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Validade do cupom (dias)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            value={mergedSettings.validDays}
                            onChange={(e) => handleSettingsChange("validDays", parseInt(e.target.value, 10))}
                          />
                          <p className="text-xs text-muted-foreground">Quantos dias o cupom é válido</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label className="text-sm font-medium">Canais de envio</Label>
                        <div className="flex items-center justify-between py-2 border-b">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="w-4 h-4 text-green-600" />
                            <span className="text-sm">WhatsApp (Evolution API)</span>
                          </div>
                          <Switch
                            checked={mergedSettings.sendWhatsapp}
                            onCheckedChange={(v) => handleSettingsChange("sendWhatsapp", v)}
                          />
                        </div>
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-blue-600" />
                            <span className="text-sm">Email</span>
                          </div>
                          <Switch
                            checked={mergedSettings.sendEmail}
                            onCheckedChange={(v) => handleSettingsChange("sendEmail", v)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Nome do remetente</Label>
                        <Input
                          placeholder="Ex: Agência Visita Brasil"
                          value={mergedSettings.senderName ?? ""}
                          onChange={(e) => handleSettingsChange("senderName", e.target.value || null)}
                        />
                        <p className="text-xs text-muted-foreground">Nome exibido no email e no WhatsApp</p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Mensagem WhatsApp personalizada</Label>
                        <Textarea
                          rows={4}
                          placeholder={`Deixe em branco para usar a mensagem padrão.\n\nVariáveis: {{name}}, {{coupon_code}}, {{discount}}, {{valid_until}}, {{agency_name}}`}
                          value={mergedSettings.whatsappMessage ?? ""}
                          onChange={(e) => handleSettingsChange("whatsappMessage", e.target.value || null)}
                          className="text-sm font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Variáveis: {"{{name}}"} {"{{coupon_code}}"} {"{{discount}}"} {"{{valid_until}}"} {"{{agency_name}}"}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Assunto do email</Label>
                        <Input
                          placeholder="Ex: Feliz aniversário, {{name}}! Seu cupom especial te espera"
                          value={mergedSettings.emailSubject ?? ""}
                          onChange={(e) => handleSettingsChange("emailSubject", e.target.value || null)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Variáveis: {"{{name}}"} {"{{coupon_code}}"} {"{{discount}}"} {"{{valid_until}}"} {"{{agency_name}}"}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Mensagem do email personalizada</Label>
                        <Textarea
                          rows={4}
                          placeholder={`Deixe em branco para usar o template padrão.\n\nVariáveis: {{name}}, {{coupon_code}}, {{discount}}, {{valid_until}}, {{agency_name}}`}
                          value={mergedSettings.emailMessage ?? ""}
                          onChange={(e) => handleSettingsChange("emailMessage", e.target.value || null)}
                          className="text-sm font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Variáveis: {"{{name}}"} {"{{coupon_code}}"} {"{{discount}}"} {"{{valid_until}}"} {"{{agency_name}}"}
                        </p>
                      </div>

                      <Button
                        onClick={() => saveSettings.mutate(mergedSettings)}
                        disabled={!settingsDirty || saveSettings.isPending}
                      >
                        {saveSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Salvar Configurações
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
