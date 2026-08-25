    msgKey: "pagamentoPendenteMessage" as const,
      label: "Saldo pendente antes da viagem",
      hint: "Lembrete enviado N dias antes da viagem quando há saldo em aberto. Variáveis: {nome}, {viagem}, {data}, {saldo_restante}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.pagamentoPendente,
    },
    {
      key: "boardingReminder" as const,
      msgKey: "boardingReminderMessage" as const,
      label: "Lembrete de embarque",
      hint: "Enviada N dias antes do embarque. Variáveis: {nome}, {viagem}, {data}, {local_saida}, {horario}, {agencia}",
      defaultMsg: WA_DEFAULT_MSGS.boardingReminder,
    },
  ] as const;

  return (
    <div className="rounded-md border p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Notificações automáticas por WhatsApp</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Mensagens enviadas automaticamente para os clientes via WhatsApp quando eventos importantes acontecem.
          Requer WhatsApp configurado em <strong>Integrações</strong>.
        </p>
      </div>

      {TYPES.map((t) => (
        <div key={t.key} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
          <div className="flex items-center justify-between">
            <Label className="cursor-pointer text-sm font-medium">{t.label}</Label>
            <Switch
              checked={settings[t.key] ?? false}
              onCheckedChange={(v) => update({ [t.key]: v })}
            />
          </div>
          {settings[t.key] && (
            <div className="space-y-2">
              {/* Extra numeric config per type */}
              {t.key === "pagamentoPendente" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">Dias antes da viagem (1–30):</Label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="w-20 border rounded px-2 py-1 text-sm"
                    value={settings.pagamentoPendenteDaysBeforeTrip ?? 7}
                    onChange={(e) => update({ pagamentoPendenteDaysBeforeTrip: Math.min(30, Math.max(1, parseInt(e.target.value) || 7)) })}
                  />
                </div>
              )}
              {t.key === "boardingReminder" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground shrink-0">Dias antes do embarque (1–14, ex: 1, 3, 7):</Label>
                    <input
                      type="text"
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      placeholder="1"
                      value={(settings.boardingReminderDaysBeforeTrip ?? [1]).join(", ")}
                      onChange={(e) => {
                        const days = e.target.value
                          .split(",")
                          .map((v) => parseInt(v.trim()))
                          .filter((n) => !isNaN(n) && n >= 1 && n <= 14);
                        update({ boardingReminderDaysBeforeTrip: days.length > 0 ? days : [1] });
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Máximo 14 dias de antecedência.</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t.hint}</p>
              <Textarea
                rows={3}
                placeholder={t.defaultMsg}
                value={settings[t.msgKey] ?? ""}
                onChange={(e) => update({ [t.msgKey]: e.target.value || null })}
                className="text-sm resize-none font-mono"
              />
              <div className="space-y-1.5" aria-label={`Pré-visualização de ${t.label}`}>
                <p className="text-xs font-medium text-muted-foreground">Pré-visualização</p>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-50">
                  {renderWhatsAppPreview(
                    interpolateWhatsAppPreview(settings[t.msgKey] || t.defaultMsg),
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Exemplo com dados de um passageiro. A mensagem acima é atualizada enquanto você digita.
                </p>
              </div>
              {settings[t.msgKey] && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => update({ [t.msgKey]: null })}
                >
                  Usar mensagem padrão
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <Button size="sm" onClick={handleSave} disabled={saving || !dirty} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar configurações de WhatsApp
      </Button>
    </div>
  );
}

/* ──────────────────── Customization Tab ──────────────────── */
function CustomizationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me, refetch: refetchMe } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: fullTenant } = useGetTenant(tenantId ?? "", {
    query: {
      queryKey: getGetTenantQueryKey(tenantId ?? ""),
      enabled: !!tenantId,
    },
  });
  const updateTenant = useUpdateTenant();

  const [primaryColor, setPrimaryColor] = useState(me?.tenant?.primaryColor ?? "#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState(me?.tenant?.secondaryColor ?? "#8B5CF6");
  const [logoUrl, setLogoUrl] = useState(me?.tenant?.logoUrl ?? "");
  const [uploadingCount, setUploadingCount] = useState(0);
  const handleUploadingChange = useCallback((uploading: boolean) => {
    setUploadingCount((n) => Math.max(0, n + (uploading ? 1 : -1)));
  }, []);

  const [storeLogo, setStoreLogo] = useState("");
  const [storeLogoUploading, setStoreLogoUploading] = useState(false);
  const [storeLogoSaving, setStoreLogoSaving] = useState(false);
  const [hasStore, setHasStore] = useState(false);

  useEffect(() => {
    if (fullTenant) {
      setPrimaryColor(fullTenant.primaryColor ?? "#3B82F6");
      setSecondaryColor(fullTenant.secondaryColor ?? "#8B5CF6");
      setLogoUrl(fullTenant.logoUrl ?? "");
    }
  }, [fullTenant?.id]);

  useEffect(() => {
    storeApi.getSettings()
      .then((s) => {
        setStoreLogo(s.logo ?? "");
        setHasStore(true);
      })
      .catch(() => {
        setHasStore(false);
      });
  }, []);

  async function handleSave() {
    if (!tenantId) {
      toast({ title: "Não foi possível identificar a agência", variant: "destructive" });
      return;
    }
    try {
      await updateTenant.mutateAsync({ id: tenantId, data: { primaryColor, secondaryColor, logoUrl } });
      toast({ title: "Personalização salva com sucesso" });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      refetchMe();
    } catch {
      toast({ title: "Erro ao salvar personalização", variant: "destructive" });
    }
  }

  async function handleSaveStoreLogo() {
    setStoreLogoSaving(true);
    try {
      await storeApi.updateSettings({ logo: storeLogo });
      toast({ title: "Logo da loja salvo com sucesso" });
    } catch {
      toast({ title: "Erro ao salvar logo da loja", variant: "destructive" });
    } finally {
      setStoreLogoSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="space-y-4">
        <h3 className="font-semibold text-sm">Cores do sistema</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Cor primária</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="font-mono uppercase"
                maxLength={7}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Cor secundária</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-border"
              />
              <Input
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="font-mono uppercase"
                maxLength={7}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <div className="w-16 h-8 rounded-md" style={{ backgroundColor: primaryColor }} />
          <div className="w-16 h-8 rounded-md" style={{ backgroundColor: secondaryColor }} />
          <div className="w-16 h-8 rounded-md bg-gradient-to-r" style={{ backgroundImage: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})` }} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Logotipo da Agência</h3>
        <p className="text-xs text-muted-foreground">
          Exibido no painel administrativo do sistema.
        </p>
        <CoverImageUpload
          fileSizeMB="2"
          value={logoUrl}
          onChange={setLogoUrl}
          onUploadingChange={handleUploadingChange}
          emptyLabel="Clique ou arraste o logo aqui"
          previewClassName="h-32"
          objectFit="contain"
        />
        <p className="text-xs text-muted-foreground">
          Recomendado: PNG com fundo transparente, tamanho mínimo 200x60px
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Favicon</h3>
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
            V
          </div>
          <p className="text-sm text-muted-foreground">
            Favicon gerado automaticamente a partir das iniciais do nome da agência
          </p>
        </div>
      </div>

      <Button onClick={handleSave} disabled={updateTenant.isPending || uploadingCount > 0}>
        {uploadingCount > 0 ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aguardando upload...</>
        ) : updateTenant.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
        ) : "Salvar personalização"}
      </Button>

      {hasStore && (
        <div className="border-t pt-6 space-y-2">
          <h3 className="font-semibold text-sm">Logo da Loja (Vitrine)</h3>
          <p className="text-xs text-muted-foreground">
            Exibido na vitrine pública, nos vouchers emitidos e no QR code de confirmação de pedidos.
          </p>
          <CoverImageUpload
            fileSizeMB="2"
            value={storeLogo}
            onChange={setStoreLogo}
            onUploadingChange={(uploading) => setStoreLogoUploading(uploading)}
            emptyLabel="Clique ou arraste o logo da loja aqui"
            previewClassName="h-32"
            objectFit="contain"
          />
          <p className="text-xs text-muted-foreground">
            Recomendado: PNG com fundo transparente, tamanho mínimo 200x60px
          </p>
          <Button
            onClick={handleSaveStoreLogo}
            disabled={storeLogoSaving || storeLogoUploading}
            variant="outline"
          >
            {storeLogoUploading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aguardando upload...</>
            ) : storeLogoSaving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
            ) : "Salvar logo da loja"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Team Tab ──────────────────── */
const roleLabels: Record<string, string> = {
  agencia: "Gestor",
  gerente: "Gerente",
  vendedor: "Vendedor",
  suporte: "Suporte",
  superadmin: "Super Admin",
  cliente: "Cliente",
};

const roleColors: Record<string, string> = {
  agencia: "bg-blue-100 text-blue-800",
  gerente: "bg-teal-100 text-teal-800",
  vendedor: "bg-green-100 text-green-800",
  suporte: "bg-orange-100 text-orange-800",
  superadmin: "bg-purple-100 text-purple-800",
  cliente: "bg-gray-100 text-gray-800",
};

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  avatarUrl?: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  accepted: boolean;
  expiresAt: string | null;
  createdAt: string;
}

function TeamTab() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const inviteRole = "vendedor" as const;
  const [inviting, setInviting] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  async function loadTeam() {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`${BASE}/api/team/members`, { credentials: "include" }),
        fetch(`${BASE}/api/team/invites`, { credentials: "include" }),
      ]);
      if (membersRes.ok) {
        const all: TeamMember[] = await membersRes.json();
        setMembers(all.filter((m) => m.role === "vendedor"));
      }
      if (invitesRes.ok) {
        const all: PendingInvite[] = await invitesRes.json();
        setInvites(all.filter((i) => !i.accepted && i.role === "vendedor"));
      }
    } catch {
      toast({ title: "Erro ao carregar equipe", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTeam();
  }, []);

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      toast({ title: "Informe o e-mail do convidado", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`${BASE}/api/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "limit_exceeded") {
          setLimitError(data.message ?? "Limite de usuários atingido. Faça upgrade para adicionar mais membros.");
          setInviteOpen(false);
        } else {
          toast({ title: data.error ?? "Erro ao convidar", variant: "destructive" });
        }
        return;
      }
      toast({
        title: "Convite registrado!",
        description: `${inviteEmail} receberá acesso ao criar uma conta com este e-mail.`,
      });
      setInviteOpen(false);
      setInviteEmail("");
      loadTeam();
    } catch {
      toast({ title: "Erro de conexão", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await fetch(`${BASE}/api/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "Membro desativado" });
      loadTeam();
    } catch {
      toast({ title: "Erro ao remover membro", variant: "destructive" });
    }
  }

  async function handleCancelInvite(id: string) {
    try {
      await fetch(`${BASE}/api/team/invites/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "Convite cancelado" });
      loadTeam();
    } catch {
      toast({ title: "Erro ao cancelar convite", variant: "destructive" });
    }
  }

  const isManager = me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.SUPER_ADMIN;

  return (
    <div className="space-y-4">
      {limitError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-amber-600 mt-0.5">⚠️</span>
          <div className="flex-1">
            <p className="font-medium text-amber-900 text-sm">Limite de usuários atingido</p>
            <p className="text-amber-700 text-sm mt-0.5">{limitError}</p>
            <Button size="sm" variant="outline" className="mt-2 border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => window.location.href = "/configuracoes?tab=plan"}>
              Ver planos
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gerencie os membros da sua equipe e convide vendedores.
          </p>
        </div>
        {isManager && (
          <Button onClick={() => { setLimitError(null); setInviteOpen(true); }}>
            <UserPlus className="w-4 h-4 mr-2" />
            Convidar Membro
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando equipe...
        </div>
      ) : (
        <>
          {members.length === 0 && invites.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum membro na equipe ainda.</p>
              {isManager && (
                <Button variant="outline" className="mt-3" onClick={() => setInviteOpen(true)}>
                  Convidar primeiro membro
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {members.length > 0 && (
                <div className="rounded-md border divide-y">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary text-sm">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {m.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${roleColors[m.role] ?? "bg-gray-100 text-gray-800"}`}>
                          {roleLabels[m.role] ?? m.role}
                        </Badge>
                        <Badge variant={m.isActive ? "default" : "outline"} className={`text-xs ${m.isActive ? "bg-green-100 text-green-800" : ""}`}>
                          {m.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      {isManager && m.id !== me?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleRemove(m.id)}
                          title="Desativar membro"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {invites.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Convites Pendentes
                  </p>
                  <div className="rounded-md border divide-y bg-muted/20">
                    {invites.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                          <Mail className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate text-muted-foreground">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Convite enviado · expira em {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "7 dias"}
                          </p>
                        </div>
                        <Badge className="text-xs bg-amber-100 text-amber-800">
                          {roleLabels[inv.role] ?? inv.role}
                        </Badge>
                        <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                          Aguardando
                        </Badge>
                        {isManager && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleCancelInvite(inv.id)}
                            title="Cancelar convite"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convidar Membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>E-mail do convidado</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="membro@agencia.com"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              O convidado será adicionado como <span className="font-medium text-foreground">Vendedor</span>. Ele deverá criar uma conta no VisiteCRM com este e-mail para ter acesso automático à sua agência.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Convidando...</> : "Convidar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ──────────────────── API Keys Tab ──────────────────── */
function ApiKeysTab() {
  const [keys] = useState([
    { id: "1", name: "Produção", key: "••••••••••••••••••••", createdAt: "2024-01-15", lastUsed: "Hoje" },
    { id: "2", name: "Desenvolvimento", key: "••••••••••••••••••••", createdAt: "2024-02-20", lastUsed: "Ontem" },
  ]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  function toggleVisible(id: string) {
    setVisible((v) => ({ ...v, [id]: !v[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Use chaves de API para integrar o VisiteCRM com sistemas externos.
        </p>
        <Button variant="outline">
          <Key className="w-4 h-4 mr-2" />
          Gerar nova chave
        </Button>
      </div>

      <div className="rounded-md border bg-background divide-y">
        {keys.map((k) => (
          <div key={k.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  Criado em {k.createdAt} · Último uso: {k.lastUsed}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => toggleVisible(k.id)}>
                  {visible[k.id] ? "Ocultar" : "Mostrar"}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive">
                  Revogar
                </Button>
              </div>
            </div>
            {visible[k.id] && (
              <div className="font-mono text-xs bg-muted rounded p-2 break-all">{k.key}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


/* ──────────────────── Club Config Tab ──────────────────── */

const CLUB_TIERS = [
  { value: "bronze", label: "Bronze", icon: "🥉" },
  { value: "silver", label: "Prata", icon: "🥈" },
  { value: "gold", label: "Ouro", icon: "🥇" },
  { value: "diamond", label: "Diamante", icon: "💎" },
] as const;

interface ClubBenefitAdmin {
  id: string;
  tier: string;
  benefitKey: string;
  label: string;
  description: string | null;
  value: string | null;
  sortOrder: number;
}

function ClubConfigTab() {
  const { toast } = useToast();
  const [clubName, setClubName] = useState("Clube Visite");
  const [clubDescription, setClubDescription] = useState("");
  const [benefits, setBenefits] = useState<ClubBenefitAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activeTier, setActiveTier] = useState<string>("bronze");
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addingBenefit, setAddingBenefit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [cfgRes, bnfRes] = await Promise.all([
          fetch(`${BASE}/api/club/config`, { credentials: "include" }),
          fetch(`${BASE}/api/club/benefits`, { credentials: "include" }),
        ]);
        const cfg = await cfgRes.json() as { clubName: string; description: string | null };
        const bnf = await bnfRes.json() as { data: ClubBenefitAdmin[] };
        setClubName(cfg.clubName ?? "Clube Visite");
        setClubDescription(cfg.description ?? "");
        setBenefits(bnf.data ?? []);
      } catch {
        toast({ title: "Erro ao carregar configurações do clube", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      await fetch(`${BASE}/api/club/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubName, description: clubDescription || null }),
      });
      toast({ title: "Configurações do clube salvas!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleAddBenefit() {
    if (!newLabel.trim()) return;
    setAddingBenefit(true);
    try {
      const res = await fetch(`${BASE}/api/club/benefits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: activeTier,
          benefitKey: newLabel.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          value: newValue.trim() || null,
          sortOrder: benefits.filter((b) => b.tier === activeTier).length,
        }),
      });
      const data = await res.json() as { id: string };
      setBenefits((prev) => [
        ...prev,
        {
          id: data.id,
          tier: activeTier,
          benefitKey: newLabel.toLowerCase().replace(/\s+/g, "_").slice(0, 100),
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          value: newValue.trim() || null,
          sortOrder: prev.filter((b) => b.tier === activeTier).length,
        },
      ]);
      setNewLabel("");
      setNewValue("");
      setNewDescription("");
      toast({ title: "Benefício adicionado!" });
    } catch {
      toast({ title: "Erro ao adicionar benefício", variant: "destructive" });
    } finally {
      setAddingBenefit(false);
    }
  }

  async function handleDeleteBenefit(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${BASE}/api/club/benefits/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setBenefits((prev) => prev.filter((b) => b.id !== id));
      toast({ title: "Benefício removido" });
    } catch {
      toast({ title: "Erro ao remover benefício", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  const tierBenefits = benefits.filter((b) => b.tier === activeTier);

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Carregando configurações do clube...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          Identidade do Clube
        </h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nome do Clube</Label>
            <Input
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Ex: Clube Visite Cariri"
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <Label>Descrição <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Input
              value={clubDescription}
              onChange={(e) => setClubDescription(e.target.value)}
              placeholder="Uma frase sobre o clube para os clientes"
              maxLength={500}
            />
          </div>
          <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}>
            {savingConfig ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Salvando...</> : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            Benefícios por Nível
          </h3>
          <Button size="sm" variant="outline" asChild>
            <a href="/embaixadores" className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Ver Ranking de Embaixadores
            </a>
          </Button>
        </div>

        <Tabs value={activeTier} onValueChange={setActiveTier}>
          <TabsList>
            {CLUB_TIERS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1">
                <span>{t.icon}</span>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {CLUB_TIERS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="space-y-3 mt-4">
              {tierBenefits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum benefício cadastrado para {t.label} ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {tierBenefits.map((b) => (
                    <div key={b.id} className="flex items-start gap-3 p-3 border rounded-lg bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{b.label}</span>
                          {b.value && <Badge variant="outline" className="text-xs">{b.value}</Badge>}
                        </div>
                        {b.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0 shrink-0"
                        onClick={() => handleDeleteBenefit(b.id)}
                        disabled={deletingId === b.id}
                      >
                        {deletingId === b.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground">Adicionar benefício para {t.label}</p>
                <Input
                  placeholder="Ex: 5% de desconto em todas as viagens"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="text-sm"
                  maxLength={200}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Valor (ex: 5%)"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="text-sm"
                    maxLength={200}
                  />
                  <Input
                    placeholder="Descrição (opcional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="text-sm"
                    maxLength={500}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleAddBenefit}
                  disabled={addingBenefit || !newLabel.trim()}
                >
                  {addingBenefit ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  + Adicionar
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

/* ──────────────────── Pipeline Settings Tab ──────────────────── */
const PIPELINE_PRESET_COLORS = [
  "#6366F1","#3B82F6","#0EA5E9","#10B981","#06B6D4",
  "#F59E0B","#EF4444","#8B5CF6","#EC4899","#6B7280",
];

type PipelineCfg = { id: string; name: string; isDefault: boolean; hasDeals: boolean; createdAt: string };
type StageCfg = { id: string; name: string; color: string; position: number; pipelineId: string };

function PipelineSettingsTab() {
  const { toast } = useToast();

  const { data: pipelines, refetch: refetchPipelines } = useQuery<PipelineCfg[]>({
    queryKey: ["cfg-pipelines"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pipelines`, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao carregar pipelines");
      return r.json();
    },
  });

  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const activePipeline = pipelines?.find(p => p.id === activePipelineId) ?? pipelines?.[0];

  const { data: stages, refetch: refetchStages } = useQuery<StageCfg[]>({
    queryKey: ["cfg-stages", activePipeline?.id],
    enabled: !!activePipeline?.id,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pipeline/stages?pipelineId=${activePipeline!.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao carregar etapas");
      return r.json();
    },
  });

  // Pipeline CRUD state
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [renamingPipelineId, setRenamingPipelineId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Stage CRUD state
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(PIPELINE_PRESET_COLORS[0]);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageValue, setEditingStageValue] = useState("");

  async function createPipeline() {
    if (!newPipelineName.trim()) return;
    setLoadingAction("create-pipeline");
    try {
      const r = await fetch(`${BASE}/api/pipelines`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPipelineName.trim() }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      const p: PipelineCfg = await r.json();
      setNewPipelineName("");
      setCreatingPipeline(false);
      setActivePipelineId(p.id);
      await refetchPipelines();
    } finally { setLoadingAction(null); }
  }

  async function renamePipeline(id: string) {
    if (!renameValue.trim()) return;
    setLoadingAction(`rename-${id}`);
    try {
      await fetch(`${BASE}/api/pipelines/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setRenamingPipelineId(null);
      await refetchPipelines();
    } finally { setLoadingAction(null); }
  }

  async function setDefault(id: string) {
    setLoadingAction(`default-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      await refetchPipelines();
    } finally { setLoadingAction(null); }
  }

  async function deletePipeline(id: string) {
    setLoadingAction(`delete-${id}`);
    try {
      const r = await fetch(`${BASE}/api/pipelines/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      if (activePipeline?.id === id) setActivePipelineId(null);
      await refetchPipelines();
    } finally { setLoadingAction(null); }
  }

  async function addStage() {
    if (!newStageName.trim() || !activePipeline) return;
    setLoadingAction("add-stage");
    try {
      await fetch(`${BASE}/api/pipeline/stages?pipelineId=${activePipeline.id}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStageName.trim(), color: newStageColor }),
      });
      setNewStageName("");
      await refetchStages();
    } finally { setLoadingAction(null); }
  }

  async function renameStage(stageId: string) {
    if (!editingStageValue.trim()) return;
    setLoadingAction(`rename-stage-${stageId}`);
    try {
      await fetch(`${BASE}/api/pipeline/stages/${stageId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingStageValue.trim() }),
      });
      setEditingStageId(null);
      await refetchStages();
    } finally { setLoadingAction(null); }
  }

  async function deleteStage(stageId: string) {
    setLoadingAction(`delete-stage-${stageId}`);
    try {
      const r = await fetch(`${BASE}/api/pipeline/stages/${stageId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ title: "Erro", description: d.message, variant: "destructive" }); return; }
      await refetchStages();
    } finally { setLoadingAction(null); }
  }

  const sortedStages = [...(stages ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Left: Pipeline list */}
      <div className="md:col-span-1 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</h3>
          <Button size="sm" variant="outline" className="gap-1 h-7 px-2 text-xs" onClick={() => setCreatingPipeline(true)}>
            <Plus className="w-3 h-3" /> Novo
          </Button>
        </div>

        {creatingPipeline && (
          <div className="flex items-center gap-1">
            <Input
              value={newPipelineName}
              onChange={e => setNewPipelineName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createPipeline(); if (e.key === "Escape") setCreatingPipeline(false); }}
              placeholder="Nome do pipeline"
              className="h-7 text-sm"
              autoFocus
            />
            <Button size="sm" className="h-7 px-2 shrink-0" onClick={createPipeline} disabled={loadingAction === "create-pipeline"}>
              {loadingAction === "create-pipeline" ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
            </Button>
            <button onClick={() => setCreatingPipeline(false)} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {pipelines?.map(p => (
            <div
              key={p.id}
              className={`group flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${(activePipeline?.id === p.id) ? "border-primary bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/50"}`}
              onClick={() => setActivePipelineId(p.id)}
            >
              {renamingPipelineId === p.id ? (
                <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                  <Input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") renamePipeline(p.id); if (e.key === "Escape") setRenamingPipelineId(null); }}
                    className="h-6 text-xs flex-1"
                    autoFocus
                  />
                  <Button size="sm" className="h-6 px-1.5 text-xs shrink-0" onClick={() => renamePipeline(p.id)}>OK</Button>
                  <button onClick={() => setRenamingPipelineId(null)} className="p-0.5 text-muted-foreground"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <>
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">{p.name}</span>
                  {p.isDefault && <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 shrink-0">Padrão</Badge>}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setRenameValue(p.name); setRenamingPipelineId(p.id); }}
                      className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                      title="Renomear"
                    ><Pencil className="w-3 h-3" /></button>
                    {!p.isDefault && (
                      <button
                        onClick={() => setDefault(p.id)}
                        disabled={loadingAction === `default-${p.id}`}
                        className="p-0.5 text-muted-foreground hover:text-amber-500 rounded"
                        title="Definir como padrão"
                      >
                        {loadingAction === `default-${p.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                      </button>
                    )}
                    {p.hasDeals ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="p-0.5 text-muted-foreground/40 cursor-not-allowed rounded inline-flex">
                              <Trash2 className="w-3 h-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px] text-center">
                            Mova ou exclua os negócios antes de excluir este pipeline
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="p-0.5 text-muted-foreground hover:text-destructive rounded" title="Excluir">
                            {loadingAction === `delete-${p.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir pipeline "{p.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Isso excluirá permanentemente todas as etapas deste pipeline.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletePipeline(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Stage management for selected pipeline */}
      <div className="md:col-span-2 space-y-3">
        {activePipeline ? (
          <>
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Etapas — {activePipeline.name}</h3>
            </div>

            <div className="space-y-1">
              {sortedStages.map((s, idx) => (
                <div key={s.id} className="group flex items-center gap-2 p-2 rounded-lg border bg-card">
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {editingStageId === s.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        value={editingStageValue}
                        onChange={e => setEditingStageValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") renameStage(s.id); if (e.key === "Escape") setEditingStageId(null); }}
                        className="h-6 text-xs flex-1"
                        autoFocus
                      />
                      <Button size="sm" className="h-6 px-1.5 text-xs shrink-0" onClick={() => renameStage(s.id)}>OK</Button>
                      <button onClick={() => setEditingStageId(null)} className="p-0.5 text-muted-foreground"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm flex-1 truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{idx + 1}</span>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => { setEditingStageValue(s.name); setEditingStageId(s.id); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                        ><Pencil className="w-3 h-3" /></button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="p-0.5 text-muted-foreground hover:text-destructive rounded">
                              {loadingAction === `delete-stage-${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir etapa "{s.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Etapas com negócios ativos não podem ser excluídas.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteStage(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add stage */}
            <div className="flex items-center gap-2 pt-1">
              <div className="flex items-center gap-1 flex-1">
                <Input
                  value={newStageName}
                  onChange={e => setNewStageName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addStage(); }}
                  placeholder="Nome da nova etapa..."
                  className="h-8 text-sm"
                />
                <div className="relative shrink-0">
                  <input
                    type="color"
                    value={newStageColor}
                    onChange={e => setNewStageColor(e.target.value)}
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  />
                  <div className="w-8 h-8 rounded border flex items-center justify-center" style={{ backgroundColor: newStageColor }} />
                </div>
              </div>
              <Button size="sm" className="h-8 gap-1 shrink-0" onClick={addStage} disabled={!newStageName.trim() || loadingAction === "add-stage"}>
                {loadingAction === "add-stage" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Adicionar
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Selecione um pipeline à esquerda
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Main Settings Page ──────────────────── */
export default function Configuracoes() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie as configurações da sua agência</p>
      </div>

      <Tabs defaultValue={new URLSearchParams(window.location.search).get("tab") ?? "agency"}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="agency" className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Agência
          </TabsTrigger>
          <TabsTrigger value="plan" className="flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            Plano
          </TabsTrigger>
          <TabsTrigger value="integrations" className="flex items-center gap-1.5">
            <Puzzle className="w-3.5 h-3.5" />
            Integrações
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="customization" className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" />
            Personalização
          </TabsTrigger>
          <TabsTrigger value="team" className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="apikeys" className="flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" />
            Chaves API
          </TabsTrigger>
          <TabsTrigger value="features" className="flex items-center gap-1.5">
            <ToggleLeft className="w-3.5 h-3.5" />
            Funcionalidades
          </TabsTrigger>
          <TabsTrigger value="clube" className="flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5" />
            Clube
          </TabsTrigger>
          <TabsTrigger value="pipelines" className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Pipelines
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="agency">
            <Card>
              <CardHeader>
                <CardTitle>Perfil da Agência</CardTitle>
                <CardDescription>
                  Informações da agência, logotipo e cores do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AgencyProfileTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plan">
            <Card>
              <CardHeader>
                <CardTitle>Plano e Faturamento</CardTitle>
                <CardDescription>Gerencie seu plano e veja o uso dos recursos</CardDescription>
              </CardHeader>
              <CardContent>
                <PlanTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="integrations">
            <Card>
              <CardHeader>
                <CardTitle>Integrações</CardTitle>
                <CardDescription>
                  Configure WhatsApp, pagamentos e outros serviços
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IntegrationsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Preferências de Notificação</CardTitle>
                <CardDescription>Escolha quais alertas você deseja receber</CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customization">
            <Card>
              <CardHeader>
                <CardTitle>Personalização</CardTitle>
                <CardDescription>
                  Personalize cores, logotipo e aparência do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CustomizationTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team">
            <Card>
              <CardHeader>
                <CardTitle>Equipe da Agência</CardTitle>
                <CardDescription>
                  Gerencie os membros da sua equipe e convide novos vendedores
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TeamTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="apikeys">
            <Card>
              <CardHeader>
                <CardTitle>Chaves de API</CardTitle>
                <CardDescription>
                  Gerencie chaves para integração com sistemas externos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApiKeysTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle>Funcionalidades</CardTitle>
                <CardDescription>
                  Ative ou desative módulos do sistema para a sua agência
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeaturesTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="clube">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-500" />
                  Clube Exclusivo
                </CardTitle>
                <CardDescription>
                  Configure o nome, descrição e benefícios por nível do clube de clientes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClubConfigTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pipelines">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Pipelines de Vendas
                </CardTitle>
                <CardDescription>
                  Gerencie os pipelines e etapas do CRM da sua agência
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineSettingsTab />
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
