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
                <Input type="number" min="1" max="12" value={form.installments} onChange={e => set("installments")(e.target.value)} />
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
      <PageHeader
        title="Clientes"
        description="Gerencie sua carteira de clientes."
        actions={
          <>
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
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
