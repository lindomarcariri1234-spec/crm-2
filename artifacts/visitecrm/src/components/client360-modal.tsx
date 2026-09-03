o com sucesso!" });
      } catch {
        toast({ title: "Erro ao salvar documento no servidor", variant: "destructive" });
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: () => {
      toast({ title: "Erro ao enviar documento", variant: "destructive" });
    },
    onCancel: () => {
      toast({ title: "Envio cancelado. O arquivo não foi salvo." });
    },
  });

  useEffect(() => {
    setLoadingDocs(true);
    fetch(`${API_BASE_ADMIN}/api/admin/clients/${clientId}/documents`, { credentials: "include" })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        return Array.isArray(data) ? data as ServerDocument[] : [];
      })
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [clientId]);

  async function handleDelete(doc: ServerDocument) {
    setDeletingId(doc.id);
    try {
      const resp = await fetch(`${API_BASE_ADMIN}/api/admin/clients/${clientId}/documents/${doc.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Failed to delete");
      setDocs(prev => prev.filter(d => d.id !== doc.id));
      toast({ title: "Documento removido." });
    } catch {
      toast({ title: "Erro ao remover documento", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (files[0].size > 16 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 16 MB.", variant: "destructive" });
      return;
    }
    startUpload(files[0]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3 mt-2">
      {hasLocalData && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs">
            Documentos salvos localmente neste navegador foram encontrados. Re-envie-os aqui para salvá-los no servidor e acessá-los de qualquer dispositivo.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {loadingDocs ? "Carregando…" : `${docs.length} documento(s)`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={isUploading}>
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {isUploading ? (isRetrying ? "Tentando novamente..." : uploadProgress > 0 ? `Enviando ${uploadProgress}%` : "Enviando...") : "Enviar Documento"}
          </Button>
          {isUploading && (
            <Button type="button" size="sm" variant="ghost" onClick={cancelUpload} className="text-muted-foreground hover:text-destructive px-2" title="Cancelar envio">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {loadingDocs ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg bg-muted/20">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Nenhum documento enviado ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                {doc.mimeType?.startsWith("image/")
                  ? <span className="text-xs font-bold text-blue-600">IMG</span>
                  : doc.mimeType === "application/pdf"
                  ? <span className="text-xs font-bold text-red-600">PDF</span>
                  : <FileText className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDocSize(doc.sizeBytes)}{doc.sizeBytes ? " · " : ""}
                  {format(parseISO(doc.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" title="Visualizar / Baixar">
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(doc)}
                  disabled={deletingId === doc.id}
                  title="Remover"
                >
                  {deletingId === doc.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {guardDialog}
    </div>
  );
}

function ClientReferralTab({ clientId }: { clientId: string }) {
  const { data, refetch } = useGetClientReferral(clientId, { query: { enabled: !!clientId, queryKey: getGetClientReferralQueryKey(clientId) } });
  const generate = useGenerateClientReferralCode();
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [showAttemptLog, setShowAttemptLog] = useState(false);

  const isAdmin = MANAGEMENT_ROLES.includes(me?.role ?? "");

  async function handleSetCodeStatus(newStatus: "active" | "blocked" | "cancelled") {
    if (!data?.referralCode) return;
    setTogglingStatus(true);
    try {
      const res = await fetch(`${API_BASE_ADMIN}/api/clients/${clientId}/referral-code`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      const json = await res.json() as { emailSent?: boolean };
      const labels: Record<string, string> = { active: "ativado", blocked: "bloqueado", cancelled: "cancelado" };
      toast({ title: `Código de indicação ${labels[newStatus] ?? newStatus}` });
      if ((newStatus === "blocked" || newStatus === "cancelled") && json.emailSent === false) {
        toast({
          title: "Aviso: e-mail não enviado",
          description: "O cliente pode não ter recebido a notificação de suspensão do código.",
          variant: "destructive",
        });
      }
      refetch();
    } catch {
      toast({ title: "Erro ao alterar status do código", variant: "destructive" });
    } finally {
      setTogglingStatus(false);
    }
  }

  const storeSlug = (me as { tenant?: { slug?: string } } | undefined)?.tenant?.slug ?? "";
  const shareLink = data?.referralCode && storeSlug
    ? `${window.location.origin}/loja/${storeSlug}/ref/${data.referralCode}`
    : null;

  async function handleGenerate() {
    try {
      await generate.mutateAsync({ clientId });
      toast({ title: "Código de indicação gerado!" });
      refetch();
    } catch {
      toast({ title: "Erro ao gerar código", variant: "destructive" });
    }
  }

  function copyCode() {
    if (!data?.referralCode) return;
    navigator.clipboard.writeText(data.referralCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyLink() {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopiedLink(true);
      toast({ title: "Link copiado!" });
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  const STATUS_COLORS: Record<string, string> = {
    [REFERRAL_STATUS.PENDING]: "text-yellow-600",
    [REFERRAL_STATUS.COMPLETED]: "text-green-600",
    [REFERRAL_STATUS.EXPIRED]: "text-red-500",
    [REFERRAL_STATUS.CONVERTED]: "text-green-600",
  };

  return (
    <div className="space-y-4 mt-2">
      {/* Referral code card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Código de indicação</p>
            {data?.referralCode ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-2xl font-mono font-bold ${(data?.referralCodeStatus ?? "active") === "active" ? "text-primary" : "text-muted-foreground line-through"}`}>{data.referralCode}</span>
                <Button size="sm" variant="outline" onClick={copyCode} title="Copiar código" disabled={(data?.referralCodeStatus ?? "active") !== "active"}>
                  {copied ? <CheckSquare className="w-4 h-4 text-green-500" /> : <FileText className="w-4 h-4" />}
                </Button>
                {(data?.referralCodeStatus ?? "active") === "active" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    <ShieldCheck className="w-3 h-3" /> Ativo
                  </span>
                ) : (data?.referralCodeStatus) === "blocked" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
                    <Ban className="w-3 h-3" /> Bloqueado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    <XCircle className="w-3 h-3" /> Cancelado
                  </span>
                )}
                {(data?.referralCodeStatus ?? "active") !== "active" && data?.referralSuspendedAttemptAt && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200" title="Última tentativa de uso após suspensão">
                    <Clock className="w-3 h-3" />
                    Tentativa: {new Date(data.referralSuspendedAttemptAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {(data?.referralSuspendedAttemptCount ?? 0) > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center px-1.5 rounded-full bg-orange-200 text-orange-800 font-semibold" title="Total de tentativas de uso após suspensão">
                        {data.referralSuspendedAttemptCount}x
                      </span>
                    )}
                  </span>
                )}
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    {(data?.referralCodeStatus ?? "active") !== "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                        onClick={() => handleSetCodeStatus("active")}
                        disabled={togglingStatus}
                      >
                        {togglingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                        Ativar
                      </Button>
                    )}
                    {(data?.referralCodeStatus ?? "active") === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                        onClick={() => handleSetCodeStatus("blocked")}
                        disabled={togglingStatus}
                      >
                        {togglingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3 mr-1" />}
                        Bloquear
                      </Button>
                    )}
                    {(data?.referralCodeStatus ?? "active") !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-red-600 border-red-300 hover:bg-red-50"
                        onClick={() => handleSetCodeStatus("cancelled")}
                        disabled={togglingStatus}
                      >
                        {togglingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3 mr-1" />}
                        Cancelar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Button size="sm" onClick={handleGenerate} disabled={generate.isPending}>
                <Gift className="w-4 h-4 mr-2" />
                {generate.isPending ? "Gerando..." : "Gerar código"}
              </Button>
            )}
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs text-muted-foreground">Indicações bem-sucedidas</p>
            <p className="text-2xl font-bold text-green-600">{data?.successfulReferrals ?? 0}</p>
          </div>
        </div>
        {shareLink && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-1">Link de compartilhamento</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareLink}
                className="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono truncate"
              />
              <Button size="sm" variant="outline" onClick={copyLink} title="Copiar link">
                {copiedLink ? <CheckSquare className="w-4 h-4 text-green-500" /> : <FileText className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Attempt log */}
      {(data?.referralCodeStatus ?? "active") !== "active" && (data?.attemptLogs ?? []).length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowAttemptLog(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAttemptLog ? "rotate-180" : ""}`} />
            {showAttemptLog ? "Ocultar" : "Ver"} histórico de tentativas
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">
              {(data?.attemptLogs ?? []).length}
            </span>
          </button>
          {showAttemptLog && (
            <div className="rounded-md border bg-orange-50/50 divide-y divide-border text-xs">
              {(data?.attemptLogs ?? []).map((log) => (
                <div key={log.id} className="flex items-center justify-between px-3 py-2 gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{log.storeSlug}</span>
                    {log.ipAddress && <span className="text-muted-foreground truncate">{log.ipAddress}</span>}
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(log.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-xl font-bold">{data?.totalReferrals ?? 0}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Convertidas</p>
          <p className="text-xl font-bold text-green-600">{data?.successfulReferrals ?? 0}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Bônus ganho</p>
          <p className="text-xl font-bold">{formatCurrency(data?.referralEarnings ?? 0)}</p>
        </Card>
      </div>

      {/* Referrals list */}
      {(data?.referrals ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhuma indicação registrada</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Histórico de indicações</p>
          {(data?.referrals ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{r.referredName ?? r.referredEmail ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-medium ${STATUS_COLORS[r.status] ?? ""}`}>
                  {r.status === REFERRAL_STATUS.PENDING ? "Pendente" : r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED ? "Convertida" : "Expirada"}
                </p>
                {r.discountApplied && (
                  <p className="text-xs text-muted-foreground">Desconto: {formatCurrency(Number(r.discountAmount ?? 0))}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Client360ModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string | null;
}

export function Client360Modal({ open, onClose, clientId }: Client360ModalProps) {
  const id = clientId ?? "";

  const { data: client, isLoading: loadingClient } = useGetClient(id, {
    query: { enabled: open && !!id, queryKey: getGetClientQueryKey(id) },
  });

  const { data: reservations } = useListReservations(
    { clientId: id, limit: 20 },
    { query: { enabled: open && !!id, queryKey: getListReservationsQueryKey({ clientId: id, limit: 20 }) } }
  );

  const { data: payments } = useListPayments(
    { clientId: id, limit: 20 },
    { query: { enabled: open && !!id, queryKey: getListPaymentsQueryKey({ clientId: id, limit: 20 }) } }
  );

  const { data: loyaltyInfo } = useGetClientLoyalty(id, {
    query: { enabled: open && !!id, queryKey: getGetClientLoyaltyQueryKey(id) },
  });

  const { data: loyaltyMembers } = useListLoyaltyMembers({
    query: { enabled: open && !!id, queryKey: getListLoyaltyMembersQueryKey() },
  });

  const { data: loyaltyTransactions } = useListLoyaltyTransactions({
    query: { enabled: open && !!id && !!loyaltyInfo?.memberId, queryKey: getListLoyaltyTransactionsQueryKey() },
  });

  const member = useMemo(() => {
    if (!loyaltyMembers || !id) return null;
    return (loyaltyMembers as { id: string; clientId: string; tier: string; totalPoints: number; availablePoints: number; joinedAt: string }[]).find(m => m.clientId === id) ?? null;
  }, [loyaltyMembers, id]);

  const memberTransactions = useMemo(() => {
    const memberId = loyaltyInfo?.memberId ?? member?.id;
    if (!loyaltyTransactions || !memberId) return [];
    return (loyaltyTransactions as { id: string; memberId: string; type: string; points: number; description: string; createdAt: string }[])
      .filter(t => t.memberId === memberId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [loyaltyTransactions, loyaltyInfo, member]);

  const isOpen = open && !!id;
  const [activeTab, setActiveTab] = useState("data");
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const [recalculating, setRecalculating] = useState(false);

  interface RecommendedTrip {
    tripId: string;
    name: string;
    destination: string;
    departureDate: string;
    returnDate: string | null;
    availableSeats: number;
    priceAdult: number;
    reason: string;
  }
  const [recommendations, setRecommendations] = useState<RecommendedTrip[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsSource, setRecsSource] = useState<string>("");

  const [dealDialogTrip, setDealDialogTrip] = useState<RecommendedTrip | null>(null);
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState<number>(0);
  const [dealStageId, setDealStageId] = useState<string>("");
  const [dealStages, setDealStages] = useState<Array<{ id: string; name: string; order: number }>>([]);
  const [dealStagesLoading, setDealStagesLoading] = useState(false);
  const [dealSubmitting, setDealSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || activeTab !== "ia" || !id) return;
    setRecsLoading(true);
    setRecommendations([]);
    setRecsSource("");
    fetch(`${API_BASE_ADMIN}/api/admin/clients/${id}/recommendations`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.json(); })
      .then((d: { recommendations?: RecommendedTrip[]; source?: string }) => {
        setRecommendations(d.recommendations ?? []);
        setRecsSource(d.source ?? "");
      })
      .catch(() => {
        setRecommendations([]);
        setRecsSource("");
      })
      .finally(() => setRecsLoading(false));
  }, [isOpen, activeTab, id]);

  const openDealDialog = async (trip: RecommendedTrip) => {
    setDealDialogTrip(trip);
    setDealTitle(`${trip.name} — ${client?.name ?? ""}`);
    setDealValue(trip.priceAdult);
    setDealStageId("");
    setDealStagesLoading(true);
    try {
      const resp = await fetch(`${API_BASE_ADMIN}/api/admin/pipeline/stages`, { credentials: "include" });
      if (!resp.ok) throw new Error();
      const stages: Array<{ id: string; name: string; order: number }> = await resp.json();
      const sorted = stages.sort((a, b) => a.order - b.order);
      setDealStages(sorted);
      setDealStageId(sorted[0]?.id ?? "");
    } catch {
      setDealStages([]);
    } finally {
      setDealStagesLoading(false);
    }
  };

  const handleConfirmDeal = async () => {
    if (!dealDialogTrip || !dealStageId) return;
    setDealSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE_ADMIN}/api/admin/deals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageId: dealStageId,
          clientId: id,
          tripId: dealDialogTrip.tripId,
          title: dealTitle,
          value: dealValue,
        }),
      });
      if (!resp.ok) throw new Error("Falha ao criar negócio");
      toast({ title: "Negócio criado!", description: `"${dealDialogTrip.name}" adicionado ao pipeline.` });
      setDealDialogTrip(null);
    } catch (err) {
      toast({ title: "Erro ao criar negócio", description: err instanceof Error ? err.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setDealSubmitting(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const resp = await fetch(`${API_BASE_ADMIN}/api/admin/clients/${id}/recalculate-score`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Failed");
      toast({ title: "Recálculo iniciado!", description: "Os scores serão atualizados em instantes." });
    } catch {
      toast({ title: "Erro ao iniciar recálculo", variant: "destructive" });
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {loadingClient || !client ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-lg font-bold">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <DialogTitle className="text-left">{client.name}</DialogTitle>
                  <p className="text-sm text-muted-foreground">{client.email}</p>
                  {client.customerCode && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">Código de Registro:</span>
                      <button
                        type="button"
                        className="flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded bg-muted border hover:bg-muted/70 transition-colors text-muted-foreground"
                        title="Copiar código do cliente"
                        onClick={() => {
                          navigator.clipboard.writeText(client.customerCode!);
                          toast({ title: "Código copiado!" });
                        }}
                      >
                        {client.customerCode}
                        <Copy className="w-3 h-3 ml-0.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {(() => {
                    const s = STATUS_LABELS[client.status];
                    return s ? <Badge className={`${s.color} border`}>{s.label}</Badge> : null;
                  })()}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded border bg-muted hover:bg-muted/70 transition-colors text-muted-foreground"
                        title="Copiar link direto para uma aba do perfil do cliente"
                      >
                        <Link className="w-3 h-3" />
                        Link perfil
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Copiar link para aba</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {([
                        { tab: "inicio",       label: "Início" },
                        { tab: "reservas",     label: "Reservas" },
                        { tab: "dados",        label: "Dados pessoais" },
                        { tab: "indicacoes",   label: "Indicações" },
                        { tab: "fidelidade",   label: "Fidelidade" },
                        { tab: "preferencias", label: "Preferências" },
                        { tab: "favoritos",    label: "Favoritos" },
                        { tab: "conquistas",   label: "Conquistas" },
                        { tab: "mapa",         label: "Mapa de viagens" },
                        { tab: "sonhos",       label: "Lista de sonhos" },
                        { tab: "memorias",     label: "Memórias" },
                        { tab: "clube",        label: "Clube" },
                      ] as const).map(({ tab, label }) => (
                        <DropdownMenuItem
                          key={tab}
                          onClick={() => {
                            const url = `${window.location.origin}/perfil?tab=${tab}`;
                            navigator.clipboard.writeText(url).catch(() => {});
                            toast({ title: "Link copiado!", description: `Link para a aba "${label}" do perfil.` });
                          }}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </DialogHeader>

            {(() => {
              const financialSummaries = (reservations?.data ?? []).map(r =>
                getReservationFinancialSummary(r as ReservationWithFinancialLinks)
              );
              const totalReservationsValue = financialSummaries.reduce((sum, summary) => sum + summary.subtotal, 0);
              const totalReservationsPaid = financialSummaries.reduce((sum, summary) => sum + summary.paid, 0);
              const totalReservationsBalance = financialSummaries.reduce((sum, summary) => sum + summary.balance, 0);
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-2">
                  <Card className="p-3">
                    <p className="text-xs text-muted-foreground">Valor Total</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(totalReservationsValue)}</p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-xs text-muted-foreground">Valor Pago</p>
                    <p className="text-lg font-bold text-green-600">{formatCurrency(totalReservationsPaid)}</p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-xs text-muted-foreground">Saldo Devedor</p>
                    <p className={`text-lg font-bold ${totalReservationsBalance > 0 ? "text-destructive" : "text-green-600"}`}>
                      {formatCurrency(totalReservationsBalance)}
                    </p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-xs text-muted-foreground">NPS</p>
                    <p className="text-lg font-bold">{(client.companyNps ?? client.npsScore) != null ? `${client.companyNps ?? client.npsScore}/10` : "—"}</p>
                  </Card>
                </div>
              );
            })()}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-9">
                <TabsTrigger value="data">Dados</TabsTrigger>
                <TabsTrigger value="trips">Viagens</TabsTrigger>
                <TabsTrigger value="financial">Financeiro</TabsTrigger>
                <TabsTrigger value="loyalty">Fidelidade</TabsTrigger>
                <TabsTrigger value="referral">Indicações</TabsTrigger>
                <TabsTrigger value="history">Histórico</TabsTrigger>
                <TabsTrigger value="documents">Docs</TabsTrigger>
                <TabsTrigger value="sonhos">Sonhos</TabsTrigger>
                <TabsTrigger value="ia">IA</TabsTrigger>
              </TabsList>

              <TabsContent value="data" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "WhatsApp", value: client.whatsapp, icon: Phone },
                    { label: "E-mail", value: client.email, icon: Mail },
                    { label: "Cidade", value: client.addressCity ? `${client.addressCity}${client.addressState ? `/${client.addressState}` : ""}` : "—", icon: MapPin },
                    { label: "Aniversário", value: client.birthDate ? format(parseISO(client.birthDate), "dd/MM/yyyy", { locale: ptBR }) : "—", icon: Calendar },
                    { label: "CPF", value: client.cpf ?? "—", icon: null },
                    { label: "RG", value: client.rg ?? "—", icon: null },
                    { label: "Instagram", value: client.instagram ?? "—", icon: null },
                    { label: "Classificação", value: CLASSIFICATION_LABELS[client.classification] ?? client.classification, icon: null },
                    { label: "Pipeline", value: client.pipelineStage ?? "—", icon: null },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="flex items-center gap-2">
                      {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>
                    </div>
                  ))}
                </div>
                {(client.tags ?? []).length > 0 && (
                  <div><p className="text-xs text-muted-foreground mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">{client.tags.map(tag => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}</div>
                  </div>
                )}
                {client.observations && (
                  <div><p className="text-xs text-muted-foreground mb-1">Observações</p>
                    <p className="text-sm bg-muted/50 rounded-lg p-3">{client.observations}</p>
                  </div>
                )}
                {(
                  client.musicalPreferences ||
                  client.favoriteDrink ||
                  (client.dreamDestinations ?? []).length > 0 ||
                  client.foodPreferences ||
                  (client.preferredDestinationTypes ?? []).length > 0 ||
                  (client.travelInterests ?? []).length > 0 ||
                  client.travelPreference ||
                  client.likesPhotosVideos != null
                ) && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preferências de viagem</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {client.musicalPreferences && (
                        <div>
                          <p className="text-xs text-muted-foreground">Estilo musical</p>
                          <p className="font-medium">{client.musicalPreferences}</p>
                        </div>
                      )}
                      {client.favoriteDrink && (
                        <div>
                          <p className="text-xs text-muted-foreground">Bebida favorita</p>
                          <p className="font-medium">{client.favoriteDrink}</p>
                        </div>
                      )}
                      {client.foodPreferences && (
                        <div>
                          <p className="text-xs text-muted-foreground">Comida favorita</p>
                          <p className="font-medium">{client.foodPreferences}</p>
                        </div>
                      )}
                      {client.travelPreference && (
                        <div>
                          <p className="text-xs text-muted-foreground">Estilo de viagem</p>
                          <p className="font-medium">{client.travelPreference}</p>
                        </div>
                      )}
                      {client.likesPhotosVideos != null && (
                        <div>
                          <p className="text-xs text-muted-foreground">Gosta de fotos/vídeos</p>
                          <p className="font-medium">{client.likesPhotosVideos ? "Sim" : "Não"}</p>
                        </div>
                      )}
                    </div>
                    {(client.dreamDestinations ?? []).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Destinos dos sonhos</p>
                        <div className="flex flex-wrap gap-1">{client.dreamDestinations.map(d => <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>)}</div>
                      </div>
                    )}
                    {(client.preferredDestinationTypes ?? []).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Tipo de destino preferido</p>
                        <div className="flex flex-wrap gap-1">{(client.preferredDestinationTypes ?? []).map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div>
                      </div>
                    )}
                    {(client.travelInterests ?? []).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Interesses</p>
                        <div className="flex flex-wrap gap-1">{(client.travelInterests ?? []).map(i => <Badge key={i} variant="outline" className="text-xs">{i}</Badge>)}</div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="trips" className="mt-4">
                {!reservations?.data.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhuma viagem encontrada.</p>
                ) : (
                  <div className="space-y-2">
                    {reservations.data.map(r => {
                      const financial = getReservationFinancialSummary(r as ReservationWithFinancialLinks);
                      const birthDate = r.client?.birthDate ? new Date(r.client.birthDate) : null;
                      const ageYears = birthDate ? Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
                      const ageCategory = ageYears == null ? "adult" : ageYears < 12 ? "child" : ageYears >= 60 ? "senior" : "adult";
                      const ageCategoryLabel: Record<string, { label: string; color: string }> = {
                        child:  { label: "Criança", color: "bg-blue-100 text-blue-800" },
                        senior: { label: "Sênior",  color: "bg-purple-100 text-purple-800" },
                        adult:  { label: "Adulto",  color: "bg-gray-100 text-gray-700" },
                      };
                      const catInfo = ageCategoryLabel[ageCategory];
                      const firstSeat = r.seats?.[0] ?? null;
                      return (
                        <div key={r.id} className="p-3 rounded-lg border space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm">{r.trip.name}</p>
                            <Badge
                              variant={r.status === RESERVATION_STATUS.CONFIRMED || r.status === RESERVATION_STATUS.COMPLETED ? "default" : r.status === RESERVATION_STATUS.CANCELLED ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {r.status === RESERVATION_STATUS.CONFIRMED ? "Confirmada" : r.status === RESERVATION_STATUS.PENDING ? "Pendente" : r.status === RESERVATION_STATUS.COMPLETED ? "Concluída" : r.status === RESERVATION_STATUS.CANCELLED ? "Cancelada" : r.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{format(parseISO(r.trip.departureDate), "dd/MM/yyyy", { locale: ptBR })} · {r.seats.length} lugar(es)</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {firstSeat && (
                              <span className="font-mono text-xs bg-gray-100 border border-gray-300 px-2 py-0.5 rounded font-bold">Assento {firstSeat}</span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${catInfo.color}`}>{catInfo.label}</span>
                            {r.client?.cpf && (
                              <span className="text-xs text-muted-foreground">CPF: {r.client.cpf}</span>
                            )}
                          </div>
                          {financial.discount > 0 ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold line-through text-muted-foreground">
                                  {formatCurrency(financial.subtotal)}
                                </p>
                                <span className="text-xs text-destructive font-medium">
                                  − {formatCurrency(financial.discount)}
                                </span>
                              </div>
                              <p className="text-sm font-semibold">Total líquido: {formatCurrency(financial.total)}</p>
                            </div>
                          ) : (
                            <p className="text-sm font-semibold">Total líquido: {formatCurrency(financial.total)}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                            <span className="text-green-600 font-medium">Pago: {formatCurrency(financial.paid)}</span>
                            <span className={`font-medium ${financial.balance > 0 ? "text-destructive" : "text-green-600"}`}>
                              Saldo devedor: {formatCurrency(financial.balance)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="financial" className="mt-4">
                {!payments?.data.length ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum pagamento encontrado.</p>
                ) : (
                  <div className="space-y-2">
                    {payments.data.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                        <div>
                          <p className="font-medium text-sm">{p.description ?? p.category}</p>
                          <p className="text-xs text-muted-foreground">
                            Vence {format(parseISO(p.dueDate), "dd/MM/yyyy", { locale: ptBR })}
                            {p.paidAt && ` · Pago ${format(parseISO(p.paidAt), "dd/MM/yyyy", { locale: ptBR })}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-sm">{formatCurrency(p.amount)}</p>
                          <Badge variant={p.status === PAYMENT_STATUS.PAID ? "default" : p.status === PAYMENT_STATUS.OVERDUE ? "destructive" : "secondary"} className="text-xs">
                            {p.status === PAYMENT_STATUS.PAID ? "Pago" : p.status === PAYMENT_STATUS.OVERDUE ? "Vencido" : "Pendente"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="loyalty" className="mt-4 space-y-4">
                {!loyaltyInfo && !member ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Gift className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">Cliente não inscrito no programa de fidelidade</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {loyaltyInfo && (
                        <Card className="p-4 space-y-1">
                          <p className="text-xs text-muted-foreground">Programa</p>
                          <p className="font-semibold">{loyaltyInfo.programName}</p>
                          <p className="text-xs text-muted-foreground mt-2">Pontos Disponíveis</p>
                          <p className="text-2xl font-bold text-primary">{loyaltyInfo.availablePoints.toLocaleString("pt-BR")}</p>
                          <p className="text-xs text-muted-foreground">≈ {formatCurrency(loyaltyInfo.availablePoints * loyaltyInfo.realPerPoint)}</p>
                        </Card>
                      )}
                      {member && (
                        <Card className="p-4 space-y-1">
                          <p className="text-xs text-muted-foreground">Tier</p>
                          {(() => {
                            const tier = TIER_LABELS[member.tier] ?? { label: member.tier, color: "bg-gray-100 text-gray-700" };
                            return (
                              <div className="flex items-center gap-2 mt-1">
                                <Award className="w-5 h-5 text-primary" />
                                <Badge className={`${tier.color} border font-semibold`}>{tier.label}</Badge>
                              </div>
                            );
                          })()}
                          <p className="text-xs text-muted-foreground mt-2">Total Acumulado</p>
                          <p className="text-xl font-bold">{member.totalPoints.toLocaleString("pt-BR")} pts</p>
                          <p className="text-xs text-muted-foreground">Membro desde {format(parseISO(member.joinedAt), "dd/MM/yyyy", { locale: ptBR })}</p>
                        </Card>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-semibold mb-2">Histórico de Transações</p>
                      {memberTransactions.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Nenhuma transação encontrada.</p>
                      ) : (
                        <div className="space-y-2">
                          {memberTransactions.slice(0, 20).map(t => (
                            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${t.type === "earn" || t.type === "bonus" ? "bg-green-100" : "bg-red-100"}`}>
                                  {t.type === "earn" || t.type === "bonus"
                                    ? <Star className="w-3.5 h-3.5 text-green-600" />
                                    : <TrendingUp className="w-3.5 h-3.5 text-red-500" />}
                                </div>
                                <div>
                                  <p className="text-sm font-medium">{t.description}</p>
                                  <p className="text-xs text-muted-foreground">{format(parseISO(t.createdAt), "dd/MM/yyyy", { locale: ptBR })}</p>
                                </div>
                              </div>
                              <span className={`text-sm font-bold ${t.type === "earn" || t.type === "bonus" ? "text-green-600" : "text-red-600"}`}>
                                {t.type === "earn" || t.type === "bonus" ? "+" : "-"}{Math.abs(t.points)} pts
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="referral" className="mt-4">
                <ClientReferralTab clientId={id} />
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                <ClientHistoryTab clientId={id} isOpen={isOpen} />
              </TabsContent>

              <TabsContent value="documents" className="mt-4">
                <ClientDocumentsTab clientId={id} />
              </TabsContent>

              <TabsContent value="sonhos">
                <ClientDreamsTab clientId={id} isOpen={activeTab === "sonhos"} />
              </TabsContent>

              <TabsContent value="ia" className="mt-4 space-y-4">
                {client.purchaseScore == null ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">Scores ainda não calculados.</p>
                    <p className="text-xs text-muted-foreground mt-1">Serão gerados automaticamente na próxima análise diária (3h00).</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Card className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Prob. Compra</p>
                        <p className={`text-2xl font-bold ${
                          client.purchaseScore >= 70 ? "text-green-600" :
                          client.purchaseScore >= 40 ? "text-yellow-600" : "text-red-600"
                        }`}>{client.purchaseScore}%</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {client.purchaseScore >= 70 ? "Alta" : client.purchaseScore >= 40 ? "Média" : "Baixa"}
                        </p>
                      </Card>
                      <Card className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Prob. Recompra</p>
                        <p className={`text-2xl font-bold ${
                          (client.recompraScore ?? 0) >= 70 ? "text-green-600" :
                          (client.recompraScore ?? 0) >= 40 ? "text-yellow-600" : "text-red-600"
                        }`}>{client.recompraScore ?? 0}%</p>
                      </Card>
                      <Card className="p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Risco de Churn</p>
                        <p className={`text-2xl font-bold ${
                          (client.churnScore ?? 0) >= 70 ? "text-red-600" :
                          (client.churnScore ?? 0) >= 40 ? "text-yellow-600" : "text-green-600"
                        }`}>{client.churnScore ?? 0}%</p>
                      </Card>
                    </div>

                    {client.nboReasoning && (
                      <div className="p-4 rounded-lg border bg-blue-50/50 space-y-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-blue-600" />
                          <p className="text-sm font-semibold text-blue-800">Próxima Melhor Oferta</p>
                        </div>
                        {client.nboTripName && (
                          <p className="font-medium text-sm">🗺️ {client.nboTripName}{client.nboTripDestination ? ` — ${client.nboTripDestination}` : ""}</p>
                        )}
                        <p className="text-sm text-muted-foreground">{client.nboReasoning}</p>
                      </div>
                    )}

                    {client.scoresCalculatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Atualizado em {format(parseISO(client.scoresCalculatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    )}
                  </>
                )}

                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold">Próximas Viagens Recomendadas</p>
                    {recsSource === "ai" && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">IA</span>
                    )}
                    {recsSource === "popular" && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Populares</span>
                    )}
                  </div>
                  {recsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : recommendations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhuma viagem disponível para recomendar no momento.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {recommendations.map((trip) => (
                        <div key={trip.tripId} className="p-3 rounded-lg border bg-muted/30 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{trip.name}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="w-3 h-3 shrink-0" />
                                {trip.destination}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 text-xs h-7 px-2"
                              onClick={() => openDealDialog(trip)}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Criar negócio
                            </Button>
                          </div>
                          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(parseISO(trip.departureDate), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                            <span>{trip.availableSeats} vagas</span>
                            <span className="font-semibold text-foreground">{formatCurrency(trip.priceAdult)}</span>
                          </div>
                          <p className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 italic">{trip.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {MANAGEMENT_ROLES.includes(me?.role ?? "") && (
                  <div className="pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={recalculating}>
                      {recalculating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                      Recalcular agora
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <Dialog open={!!dealDialogTrip} onOpenChange={o => { if (!o) setDealDialogTrip(null); }}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Criar negócio no pipeline</DialogTitle>
                </DialogHeader>
                {dealDialogTrip && (
                  <div className="space-y-4 py-1">
                    <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                      <p className="font-medium">{dealDialogTrip.name}</p>
                      <p className="text-xs text-muted-foreground">{dealDialogTrip.destination} · {format(parseISO(dealDialogTrip.departureDate), "dd/MM/yyyy", { locale: ptBR })}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deal-title" className="text-xs">Título do negócio</Label>
                      <Input id="deal-title" value={dealTitle} onChange={e => setDealTitle(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deal-value" className="text-xs">Valor (R$)</Label>
                      <Input id="deal-value" type="number" value={dealValue} onChange={e => setDealValue(Number(e.target.value))} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Etapa do pipeline</Label>
                      {dealStagesLoading ? (
                        <Skeleton className="h-8 w-full" />
                      ) : (
                        <Select value={dealStageId} onValueChange={setDealStageId}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Selecione a etapa" />
                          </SelectTrigger>
                          <SelectContent>
                            {dealStages.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                )}
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDealDialogTrip(null)}>Cancelar</Button>
                  <Button size="sm" onClick={handleConfirmDeal} disabled={dealSubmitting || !dealStageId || !dealTitle.trim()}>
                    {dealSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                    Criar negócio
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {(() => {
              const financialSummaries = (reservations?.data ?? []).map(r =>
                getReservationFinancialSummary(r as ReservationWithFinancialLinks)
              );
              const totalReservationsValue = financialSummaries.reduce((sum, summary) => sum + summary.subtotal, 0);
              const totalReservationsPaid = financialSummaries.reduce((sum, summary) => sum + summary.paid, 0);
              const totalReservationsBalance = financialSummaries.reduce((sum, summary) => sum + summary.balance, 0);
              return (
                <div className="border-t pt-3 mt-2 grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Valor Total:</span>
                    <span className="text-sm font-bold text-foreground">{formatCurrency(totalReservationsValue)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Valor Pago:</span>
                    <span className="text-sm font-bold text-green-600">{formatCurrency(totalReservationsPaid)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Saldo Devedor:</span>
                    <span className={`text-sm font-bold ${totalReservationsBalance > 0 ? "text-destructive" : "text-green-600"}`}>
                      {formatCurrency(totalReservationsBalance)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
