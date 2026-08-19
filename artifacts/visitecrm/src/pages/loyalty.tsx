import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListLoyaltyPrograms,
  useCreateLoyaltyProgram,
  useUpdateLoyaltyProgram,
  useListLoyaltyMembers,
  useCreateLoyaltyMember,
  useListLoyaltyTransactions,
  useCreateLoyaltyTransaction,
  useSyncLoyaltyPoints,
} from "@workspace/api-client-react";
import { useListClients } from "@workspace/api-client-react";
import type { CreateLoyaltyTransactionBodyType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Star,
  Users,
  ArrowUpCircle,
  ArrowDownCircle,
  Gift,
  Clock,
  Settings2,
  Award,
  Coins,
  RefreshCw,
} from "lucide-react";
import type { LoyaltyProgram, LoyaltyMember } from "@workspace/api-client-react";

const tierConfig: Record<
  string,
  { label: string; className: string; threshold: number }
> = {
  bronze: {
    label: "Bronze",
    className: "bg-amber-100 text-amber-800",
    threshold: 0,
  },
  silver: {
    label: "Prata",
    className: "bg-slate-100 text-slate-700",
    threshold: 500,
  },
  gold: {
    label: "Ouro",
    className: "bg-yellow-100 text-yellow-800",
    threshold: 1500,
  },
  diamond: {
    label: "Diamante",
    className: "bg-blue-100 text-blue-800",
    threshold: 5000,
  },
};

const txTypeConfig: Record<
  string,
  { label: string; icon: React.ReactNode; sign: string; className: string }
> = {
  earn: {
    label: "Ganho",
    icon: <ArrowUpCircle className="w-4 h-4 text-green-500" />,
    sign: "+",
    className: "text-green-600 font-semibold",
  },
  redeem: {
    label: "Resgate",
    icon: <ArrowDownCircle className="w-4 h-4 text-red-500" />,
    sign: "-",
    className: "text-red-600 font-semibold",
  },
  bonus: {
    label: "Bônus",
    icon: <Gift className="w-4 h-4 text-purple-500" />,
    sign: "+",
    className: "text-purple-600 font-semibold",
  },
  expire: {
    label: "Expirado",
    icon: <Clock className="w-4 h-4 text-gray-500" />,
    sign: "-",
    className: "text-gray-500 font-semibold",
  },
};

const TIER_BENEFIT_KEYS = ["bronze", "silver", "gold", "diamond"] as const;
const TIER_BENEFIT_LABELS: Record<string, string> = {
  bronze: "🥉 Bronze",
  silver: "🥈 Prata",
  gold: "🥇 Ouro",
  diamond: "💎 Diamante",
};

function ProgramConfig({ program }: { program: LoyaltyProgram }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isBenefitsOpen, setIsBenefitsOpen] = useState(false);
  const updateProgram = useUpdateLoyaltyProgram();
  const { toast } = useToast();

  const existingBenefits = (program.tierBenefits ?? {}) as Record<string, string[]>;
  const [benefitDrafts, setBenefitDrafts] = useState<Record<string, string>>({
    bronze: (existingBenefits.bronze ?? []).join("\n"),
    silver: (existingBenefits.silver ?? []).join("\n"),
    gold: (existingBenefits.gold ?? []).join("\n"),
    diamond: (existingBenefits.diamond ?? []).join("\n"),
  });

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await updateProgram.mutateAsync({
      id: program.id,
      data: {
        name: (fd.get("name") as string) || program.name,
        description: (fd.get("description") as string) || undefined,
        pointsPerReal: (fd.get("pointsPerReal") as string) || undefined,
        realPerPoint: (fd.get("realPerPoint") as string) || undefined,
        minRedeemPoints: fd.get("minRedeemPoints")
          ? parseInt(fd.get("minRedeemPoints") as string, 10)
          : undefined,
      },
    });
    setIsEditOpen(false);
  };

  const handleSaveBenefits = async () => {
    const tierBenefits: Record<string, string[]> = {};
    for (const key of TIER_BENEFIT_KEYS) {
      const lines = benefitDrafts[key]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      tierBenefits[key] = lines;
    }
    try {
      await updateProgram.mutateAsync({
        id: program.id,
        data: { tierBenefits },
      });
      toast({ title: "Benefícios salvos!", description: "Os benefícios de tier foram atualizados." });
      setIsBenefitsOpen(false);
    } catch {
      toast({ title: "Erro ao salvar benefícios", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">{program.name}</CardTitle>
            {program.description && (
              <CardDescription className="mt-0.5">{program.description}</CardDescription>
            )}
          </div>
          <div className="flex gap-2">
            <Dialog open={isBenefitsOpen} onOpenChange={setIsBenefitsOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Star className="w-3.5 h-3.5 mr-1.5" /> Benefícios
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Benefícios por Nível</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Digite um benefício por linha para cada nível. Esses textos aparecem no portal do cliente.
                  </p>
                  {TIER_BENEFIT_KEYS.map((key) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-sm font-semibold">{TIER_BENEFIT_LABELS[key]}</label>
                      <Textarea
                        rows={3}
                        placeholder={`Ex: Atendimento prioritário\nDesconto exclusivo em pacotes`}
                        value={benefitDrafts[key]}
                        onChange={(e) =>
                          setBenefitDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsBenefitsOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveBenefits} disabled={updateProgram.isPending}>
                      {updateProgram.isPending ? "Salvando..." : "Salvar benefícios"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Configurar
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Configurar Programa</DialogTitle>
                </DialogHeader>
                <form key={program.id} onSubmit={handleUpdate} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome</label>
                    <Input name="name" defaultValue={program.name} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Descrição</label>
                    <Textarea name="description" defaultValue={program.description ?? ""} rows={2} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pontos por R$ gasto</label>
                      <Input name="pointsPerReal" type="number" step="0.01" min="0" defaultValue={program.pointsPerReal} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">R$ por ponto</label>
                      <Input name="realPerPoint" type="number" step="0.01" min="0" defaultValue={program.realPerPoint} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mínimo para resgate</label>
                    <Input name="minRedeemPoints" type="number" min="1" defaultValue={program.minRedeemPoints} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={updateProgram.isPending}>
                      {updateProgram.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-xl font-bold">{program.pointsPerReal}</p>
            <p className="text-xs text-muted-foreground mt-0.5">pts/R$</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-xl font-bold">R$ {program.realPerPoint}</p>
            <p className="text-xs text-muted-foreground mt-0.5">por ponto</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-xl font-bold">{program.minRedeemPoints}</p>
            <p className="text-xs text-muted-foreground mt-0.5">mín. resgate</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {Object.entries(tierConfig).map(([tier, cfg]) => {
            const benefits = ((program.tierBenefits ?? {}) as Record<string, string[]>)[tier] ?? [];
            return (
              <div key={tier} className={`p-2 rounded-lg text-xs font-medium ${cfg.className}`}>
                <Award className="w-4 h-4 mx-auto mb-0.5" />
                <p className="text-center">{cfg.label}</p>
                <p className="font-normal opacity-75 text-center">{cfg.threshold}+ pts</p>
                {benefits.length > 0 && (
                  <p className="font-normal opacity-60 text-center mt-0.5">{benefits.length} benefício{benefits.length !== 1 ? "s" : ""}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

const VALID_LOYALTY_TABS = ["members", "transactions"];

export default function Loyalty() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    return VALID_LOYALTY_TABS.includes(t ?? "") ? t! : "members";
  });

  useEffect(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    if (t && VALID_LOYALTY_TABS.includes(t)) setTab(t);
  }, [searchStr]);

  function handleTabChange(value: string) {
    setTab(value);
    const params = new URLSearchParams(searchStr);
    params.set("tab", value);
    navigate(`?${params.toString()}`, { replace: true });
  }

  const [isProgramOpen, setIsProgramOpen] = useState(false);
  const [isMemberOpen, setIsMemberOpen] = useState(false);
  const [isTxOpen, setIsTxOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<LoyaltyMember | null>(null);
  const [txType, setTxType] = useState<CreateLoyaltyTransactionBodyType>("earn");
  const [memberProgramId, setMemberProgramId] = useState("");
  const [txProgramId, setTxProgramId] = useState("");
  const [txMemberId, setTxMemberId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [memberTier, setMemberTier] = useState("bronze");

  const { data: programs, isLoading: loadingPrograms, refetch: refetchPrograms } =
    useListLoyaltyPrograms();
  const { data: members, isLoading: loadingMembers, refetch: refetchMembers } =
    useListLoyaltyMembers();
  const { data: transactions, refetch: refetchTx } = useListLoyaltyTransactions();
  const { data: clients } = useListClients({ limit: 200 });

  const { toast } = useToast();

  const createProgram = useCreateLoyaltyProgram();
  const createMember = useCreateLoyaltyMember();
  const createTransaction = useCreateLoyaltyTransaction();
  const syncPoints = useSyncLoyaltyPoints();

  const handleCreateProgram = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createProgram.mutateAsync({
      data: {
        name: fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        pointsPerReal: (fd.get("pointsPerReal") as string) || undefined,
        realPerPoint: (fd.get("realPerPoint") as string) || undefined,
        minRedeemPoints: fd.get("minRedeemPoints")
          ? parseInt(fd.get("minRedeemPoints") as string, 10)
          : undefined,
      },
    });
    setIsProgramOpen(false);
    refetchPrograms();
  };

  const handleAddMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await createMember.mutateAsync({
      data: {
        programId: memberProgramId,
        clientId: selectedClientId,
        tier: memberTier,
      },
    });
    setIsMemberOpen(false);
    setMemberProgramId("");
    setSelectedClientId("");
    setMemberTier("bronze");
    refetchMembers();
  };

  const handleTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createTransaction.mutateAsync({
      data: {
        memberId: txMemberId,
        programId: txProgramId,
        type: txType,
        points: parseInt(fd.get("points") as string, 10),
        description: (fd.get("description") as string) || undefined,
      },
    });
    setIsTxOpen(false);
    setTxMemberId("");
    setTxProgramId("");
    setTxType("earn");
    refetchTx();
    refetchMembers();
  };

  const openTx = (member: LoyaltyMember) => {
    setSelectedMember(member);
    setTxMemberId(member.id);
    setTxProgramId(member.programId);
    setIsTxOpen(true);
  };

  const handleSync = async () => {
    try {
      const result = await syncPoints.mutateAsync();
      toast({
        title: result.transactionsCreated > 0 ? "Pontos sincronizados" : "Tudo sincronizado",
        description: `${result.membersUpdated} membro(s) atualizado(s), ${result.transactionsCreated} transação(ões) criada(s).`,
      });
      refetchMembers();
      refetchTx();
    } catch {
      toast({
        title: "Erro ao sincronizar pontos",
        variant: "destructive",
      });
    }
  };

  const totalPoints = (members ?? []).reduce((s, m) => s + m.totalPoints, 0);
  const availablePoints = (members ?? []).reduce((s, m) => s + m.availablePoints, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fidelidade</h1>
          <p className="text-muted-foreground mt-1">
            Programa de pontos e recompensas para clientes.
          </p>
        </div>
        <div className="flex gap-2">
          {(programs ?? []).length === 0 && (
            <Dialog open={isProgramOpen} onOpenChange={setIsProgramOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Settings2 className="w-4 h-4 mr-2" /> Criar Programa
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Criar Programa de Fidelidade</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateProgram} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome</label>
                    <Input
                      name="name"
                      required
                      placeholder="Ex: Programa Viajantes"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Descrição</label>
                    <Textarea name="description" rows={2} placeholder="Descrição do programa" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pontos por R$</label>
                      <Input
                        name="pointsPerReal"
                        type="number"
                        step="0.01"
                        defaultValue="1"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">R$ por ponto</label>
                      <Input
                        name="realPerPoint"
                        type="number"
                        step="0.01"
                        defaultValue="0.01"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mínimo para resgate (pts)</label>
                    <Input name="minRedeemPoints" type="number" defaultValue="100" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsProgramOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={createProgram.isPending}>
                      {createProgram.isPending ? "Criando..." : "Criar"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncPoints.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncPoints.isPending ? "animate-spin" : ""}`} />
            {syncPoints.isPending ? "Sincronizando..." : "Sincronizar Pontos"}
          </Button>
          <Dialog open={isMemberOpen} onOpenChange={setIsMemberOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" /> Adicionar Membro
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar Membro</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddMember} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Programa</label>
                  <Select value={memberProgramId} onValueChange={setMemberProgramId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar programa..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(programs ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cliente</label>
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients?.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nível Inicial</label>
                  <Select value={memberTier} onValueChange={setMemberTier}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(tierConfig).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsMemberOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      createMember.isPending ||
                      !memberProgramId ||
                      !selectedClientId
                    }
                  >
                    {createMember.isPending ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Membros</p>
                <p className="text-xl font-bold">{(members ?? []).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 text-yellow-700">
                <Star className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total de Pontos</p>
                <p className="text-xl font-bold">
                  {totalPoints.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 text-green-700">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pontos Disponíveis</p>
                <p className="text-xl font-bold">
                  {availablePoints.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {loadingPrograms ? (
        <Skeleton className="h-40 w-full" />
      ) : (programs ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Star className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum programa criado.</p>
            <p className="text-sm mt-1">
              Crie um programa de fidelidade para recompensar clientes.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setIsProgramOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" /> Criar Programa
            </Button>
          </CardContent>
        </Card>
      ) : (
        (programs ?? []).map((p) => <ProgramConfig key={p.id} program={p} />)
      )}

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="members">
            <Users className="w-4 h-4 mr-1.5" /> Membros
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <Coins className="w-4 h-4 mr-1.5" /> Transações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead className="text-right">Total Pts</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead>Membro desde</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMembers ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (members ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-10 text-muted-foreground"
                    >
                      Nenhum membro cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  (members ?? []).map((m) => {
                    const tier = tierConfig[m.tier] ?? {
                      label: m.tier,
                      className: "",
                    };
                    const client = (clients?.data ?? []).find(
                      (c) => c.id === m.clientId
                    );
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">
                          {client?.name ?? m.clientId}
                        </TableCell>
                        <TableCell>
                          <Badge className={tier.className} variant="secondary">
                            <Award className="w-3 h-3 mr-1" />
                            {tier.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {m.totalPoints.toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium">
                          {m.availablePoints.toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(m.joinedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openTx(m)}
                          >
                            <Gift className="w-3.5 h-3.5 mr-1" /> Ajustar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Pontos</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transactions ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-10 text-muted-foreground"
                    >
                      Nenhuma transação registrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  (transactions ?? []).map((tx) => {
                    const cfg = txTypeConfig[tx.type] ?? {
                      label: tx.type,
                      icon: null,
                      sign: "",
                      className: "",
                    };
                    return (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </TableCell>
                        <TableCell className={cfg.className}>
                          {cfg.sign}
                          {tx.points.toLocaleString("pt-BR")} pts
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                          {tx.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isTxOpen} onOpenChange={setIsTxOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Pontos</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransaction} className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de Transação</label>
              <Select
                value={txType}
                onValueChange={(v) =>
                  setTxType(v as CreateLoyaltyTransactionBodyType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="earn">Ganho de Pontos</SelectItem>
                  <SelectItem value="redeem">Resgate de Pontos</SelectItem>
                  <SelectItem value="bonus">Bônus</SelectItem>
                  <SelectItem value="expire">Expirar Pontos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantidade de Pontos</label>
              <Input
                name="points"
                type="number"
                min="1"
                required
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição</label>
              <Input
                name="description"
                placeholder="Ex: Compra de pacote de viagem"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsTxOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createTransaction.isPending || !txMemberId}
              >
                {createTransaction.isPending ? "Salvando..." : "Registrar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
