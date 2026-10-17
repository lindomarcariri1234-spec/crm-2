import { useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ReferralCampaign } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Ban, Flame, Megaphone, Pencil, XCircle } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

export interface CampaignDraft {
  name: string; startsAt: string; endsAt: string;
  bonusType: "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  bonusValue: string; bannerText: string; eligibleStoreProductIds: string[]; eligibleTierLevels: string[];
  conversionCap: string; budgetAmount: string; shareMessage: string; materialUrl: string;
  eligibleActivitySegments: Array<"active" | "occasional" | "inactive">; eligibleChannels: string;
  commissionType: "none" | "fixed" | "bonus_percentage"; commissionValue: string;
  commissionRecipientType: "ambassador" | "partner"; eligiblePartnerIds: string[];
}
interface CampaignOption { id: string; name: string }
interface Props {
  open: boolean; onOpenChange: (value: boolean) => void; campaigns: ReferralCampaign[];
  activeCampaign: ReferralCampaign | undefined; showForm: boolean; setShowForm: (value: boolean) => void;
  draft: CampaignDraft; setDraft: Dispatch<SetStateAction<CampaignDraft>>;
  editingId: string | null; onEditingIdChange: (id: string | null) => void;
  onSave: () => void; onEdit: (campaign: ReferralCampaign) => void; onDelete: (id: string) => void;
  deletePending: boolean;
  loading: boolean; error: boolean; onRetry: () => void; canEdit: boolean;
  productOptions?: CampaignOption[]; partnerOptions?: CampaignOption[];
  productsLoading?: boolean; partnersLoading?: boolean;
  productsError?: boolean; partnersError?: boolean;
}

const emptyDraft = (): CampaignDraft => ({ name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "", eligibleStoreProductIds: [], eligibleTierLevels: [], conversionCap: "", budgetAmount: "", shareMessage: "", materialUrl: "", eligibleActivitySegments: [], eligibleChannels: "", commissionType: "none", commissionValue: "0", commissionRecipientType: "ambassador", eligiblePartnerIds: [] });
const tierLabels: Record<string, string> = { bronze: "Bronze", silver: "Prata", gold: "Ouro", diamond: "Diamante" };
const bonusDetails: Record<CampaignDraft["bonusType"], { label: string; hint: string; min?: number; max?: number; step?: number }> = {
  multiplier: { label: "Multiplicador (x)", hint: "Ex.: 2 dobra o bônus-base. O multiplicador do tier também pode se aplicar.", min: 1, step: 0.1 },
  fixed_extra: { label: "Bônus adicional (R$)", hint: "Soma ao bônus padrão, depois do multiplicador do tier.", min: 0.01, step: 0.01 },
  fixed_bonus: { label: "Bônus total fixo (R$)", hint: "Substitui o bônus padrão; o valor fixo não é multiplicado pelo tier.", min: 0.01, step: 0.01 },
  percentage_bonus: { label: "Percentual do bônus-base (%)", hint: "Ex.: 50 corresponde a 50% do bônus-base; o multiplicador do tier também se aplica.", min: 0.01, step: 0.1 },
  reduced_bonus: { label: "Fator do bônus (0 a 1)", hint: "Ex.: 0,5 corresponde à metade do bônus-base. O multiplicador do tier também se aplica.", min: 0.01, max: 1, step: 0.01 },
  no_reward: { label: "", hint: "" },
};
const bonusValueDefaults: Record<CampaignDraft["bonusType"], string> = {
  multiplier: "2",
  fixed_extra: "10",
  fixed_bonus: "20",
  percentage_bonus: "50",
  reduced_bonus: "0.5",
  no_reward: "0",
};

export function ReferralCampaignsDialog({
  open, onOpenChange, campaigns, activeCampaign, showForm, setShowForm, draft, setDraft,
  editingId, onEditingIdChange, onSave, onEdit, onDelete, deletePending, loading, error, onRetry,
  canEdit, productOptions = [], partnerOptions = [], productsLoading = false, partnersLoading = false,
  productsError = false, partnersError = false,
}: Props) {
  const update = (value: Partial<CampaignDraft>) => setDraft((current) => ({ ...current, ...value }));
  const toggle = (key: "eligibleTierLevels" | "eligibleActivitySegments", value: string) => {
    const current = draft[key] as string[];
    update({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] } as Partial<CampaignDraft>);
  };
  const toggleId = (key: "eligibleStoreProductIds" | "eligiblePartnerIds", id: string) => {
    const current = draft[key];
    update({ [key]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  };
  const closeForm = () => { setShowForm(false); onEditingIdChange(null); setDraft(emptyDraft()); };
  const status = (campaign: ReferralCampaign) => new Date(campaign.endsAt) < new Date() ? "Encerrada" : new Date(campaign.startsAt) > new Date() ? "Agendada" : "Ativa";
  const parsedBonusValue = draft.bonusValue.trim() ? Number(draft.bonusValue.replace(",", ".")) : Number.NaN;
  const bonusPreview = useMemo(() => {
    if (draft.bonusType === "no_reward" || !Number.isFinite(parsedBonusValue)) return null;
    const baseBonus = 10;
    const amount = draft.bonusType === "multiplier"
      ? baseBonus * parsedBonusValue
      : draft.bonusType === "fixed_extra"
        ? baseBonus + parsedBonusValue
        : draft.bonusType === "fixed_bonus"
          ? parsedBonusValue
          : draft.bonusType === "percentage_bonus"
            ? baseBonus * parsedBonusValue / 100
            : baseBonus * parsedBonusValue;
    return fmtCurrency(amount);
  }, [draft.bonusType, parsedBonusValue]);

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5 text-primary" />Campanhas de Indicação</DialogTitle><DialogDescription>Configure o período, a recompensa e quem pode participar. Campanhas não podem ter períodos sobrepostos, mesmo quando ainda estão agendadas.</DialogDescription></DialogHeader>
    <div className="space-y-4 pt-1">
      {error ? <div role="alert" className="space-y-2"><p>Não foi possível carregar as campanhas.</p><Button variant="outline" onClick={onRetry}>Tentar novamente</Button></div> : loading ? <p role="status">Carregando campanhas…</p> : <>
      {activeCampaign && <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"><Flame className="w-4 h-4 mt-0.5 text-green-600" /><span><b>Campanha ativa agora:</b> {activeCampaign.name} — termina em {new Date(activeCampaign.endsAt).toLocaleString("pt-BR")}</span></div>}
      {canEdit && (!showForm ? <Button variant="outline" onClick={() => setShowForm(true)}><Megaphone className="w-4 h-4 mr-2" />Nova campanha</Button> :
        <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
          <div className="flex items-center justify-between"><p className="font-semibold text-sm">{editingId ? "Editar campanha" : "Nova campanha"}</p><Button variant="ghost" size="sm" onClick={closeForm}><XCircle className="w-4 h-4" /></Button></div>
          <FormSection title="Identificação e período" description="As datas usam o fuso local do navegador. Campanhas com períodos sobrepostos não são permitidas.">
            <Field label="Nome da campanha *" value={draft.name} onChange={(name) => update({ name })} placeholder="Ex.: Bônus em dobro nas férias" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Início *" type="datetime-local" value={draft.startsAt} onChange={(startsAt) => update({ startsAt })} />
              <Field label="Término *" type="datetime-local" value={draft.endsAt} onChange={(endsAt) => update({ endsAt })} />
            </div>
          </FormSection>

          <FormSection title="Recompensa" description="Escolha como a campanha altera o bônus padrão de indicação.">
            <div className="space-y-1">
              <Label>Tipo de recompensa *</Label>
              <Select value={draft.bonusType} onValueChange={(bonusType) => {
                const type = bonusType as CampaignDraft["bonusType"];
                update({ bonusType: type, bonusValue: bonusValueDefaults[type] });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="multiplier">Multiplicador do bônus</SelectItem>
                  <SelectItem value="fixed_extra">Valor adicional fixo</SelectItem>
                  <SelectItem value="fixed_bonus">Bônus total fixo</SelectItem>
                  <SelectItem value="percentage_bonus">Percentual do bônus-base</SelectItem>
                  <SelectItem value="reduced_bonus">Fator do bônus-base</SelectItem>
                  <SelectItem value="no_reward">Sem recompensa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.bonusType === "no_reward" ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">As indicações podem continuar convertendo, mas não recebem bônus durante a campanha.</p>
            ) : (
              <Field
                label={`${bonusDetails[draft.bonusType].label} *`}
                type="number"
                min={bonusDetails[draft.bonusType].min}
                max={bonusDetails[draft.bonusType].max}
                step={bonusDetails[draft.bonusType].step}
                value={draft.bonusValue}
                onChange={(bonusValue) => update({ bonusValue })}
                helper={bonusDetails[draft.bonusType].hint}
              />
            )}
            {bonusPreview && <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">Exemplo com bônus-base de R$ 10 e tier padrão: <strong>{bonusPreview}</strong>. Tiers superiores podem alterar o resultado, exceto no bônus total fixo.</p>}
          </FormSection>

          <FormSection title="Público elegível" description="Deixe as seleções vazias para incluir todos.">
            <div className="space-y-1">
              <Label>Tiers</Label>
              <Select value={draft.eligibleTierLevels.length ? "custom" : "all"} onValueChange={(value) => { if (value === "all") update({ eligibleTierLevels: [] }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Todos os tiers</SelectItem><SelectItem value="custom">Escolher tiers</SelectItem></SelectContent>
              </Select>
              {draft.eligibleTierLevels.length > 0 && <div className="flex gap-3 flex-wrap pt-1">{Object.entries(tierLabels).map(([id, label]) => <label key={id} className="flex items-center gap-1 text-sm"><Checkbox checked={draft.eligibleTierLevels.includes(id)} onCheckedChange={() => toggle("eligibleTierLevels", id)} />{label}</label>)}</div>}
            </div>
            <MultiSelectField
              label="Produtos da loja"
              helper="Sem seleção, o bônus vale para qualquer produto. A regra se aplica a compras na loja online."
              options={productOptions}
              values={draft.eligibleStoreProductIds}
              onToggle={(id) => toggleId("eligibleStoreProductIds", id)}
              loading={productsLoading}
              error={productsError}
              emptyLabel="Nenhum produto da loja cadastrado."
            />
            <div className="space-y-1">
              <Label>Atividade do indicador</Label>
              <p className="text-xs text-muted-foreground">Ativo: 3 ou mais conversões; ocasional: 1–2; inativo: nenhuma.</p>
              <div className="flex gap-3 flex-wrap">{[["active", "Ativos"], ["occasional", "Ocasionais"], ["inactive", "Inativos"]].map(([id, label]) => <label key={id} className="flex items-center gap-1 text-sm"><Checkbox checked={draft.eligibleActivitySegments.includes(id as CampaignDraft["eligibleActivitySegments"][number])} onCheckedChange={() => toggle("eligibleActivitySegments", id)} />{label}</label>)}</div>
              {draft.eligibleActivitySegments.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma seleção: todos os segmentos.</p>}
            </div>
            <Field label="Canais elegíveis" value={draft.eligibleChannels} onChange={(eligibleChannels) => update({ eligibleChannels })} placeholder="Ex.: instagram, whatsapp" helper="Separe os canais por vírgula. Sem seleção, todos os canais são aceitos." />
          </FormSection>

          <FormSection title="Limites" description="Os limites encerram o pagamento de bônus, mas não impedem o registro ou a conversão da indicação.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Máximo de conversões" type="number" min={1} step={1} value={draft.conversionCap} onChange={(conversionCap) => update({ conversionCap })} placeholder="Sem limite" helper="Conta conversões concluídas dentro do período." />
              <Field label="Teto de bônus (R$)" type="number" min={0.01} step={0.01} value={draft.budgetAmount} onChange={(budgetAmount) => update({ budgetAmount })} placeholder="Sem limite" helper="Considera bônus, não comissão. Ao atingir o teto, as próximas conversões ficam sem bônus." />
            </div>
          </FormSection>

          <FormSection title="Comunicação com o cliente" description="Esses conteúdos aparecem no portal de indicação durante a campanha.">
            <Field label="Texto do banner" value={draft.bannerText} onChange={(bannerText) => update({ bannerText })} placeholder="Ex.: Bônus em dobro até domingo" helper="Se ficar vazio, o portal mostra uma chamada padrão." />
            <TextAreaField label="Mensagem para compartilhar" value={draft.shareMessage} onChange={(shareMessage) => update({ shareMessage })} placeholder="Ex.: Convide um amigo e ganhe bônus na próxima viagem." helper="Usada no botão de compartilhamento enquanto esta campanha estiver ativa." />
            <Field label="Link do material da campanha" type="url" value={draft.materialUrl} onChange={(materialUrl) => update({ materialUrl })} placeholder="https://..." helper="Opcional. O portal exibirá um link para abrir o material." />
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">O ranking público geral não é configurado por campanha. Essa opção foi retirada para não sugerir uma ação que ainda não existe.</p>
          </FormSection>

          <FormSection title="Comissão" description="A comissão extra vale para conversões da loja online. Reservas criadas pela equipe seguem somente a regra de bônus da campanha.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tipo de comissão</Label>
                <Select value={draft.commissionType} onValueChange={(commissionType) => update({ commissionType: commissionType as CampaignDraft["commissionType"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sem comissão</SelectItem><SelectItem value="fixed">Valor fixo</SelectItem><SelectItem value="bonus_percentage">Percentual do bônus</SelectItem></SelectContent>
                </Select>
              </div>
              {draft.commissionType !== "none" && <Field
                label={draft.commissionType === "fixed" ? "Comissão por conversão (R$)" : "Percentual do bônus (%)"}
                type="number" min={0.01} step={draft.commissionType === "fixed" ? 0.01 : 0.1}
                value={draft.commissionValue} onChange={(commissionValue) => update({ commissionValue })}
              />}
            </div>
            {draft.commissionType !== "none" && <>
              <div className="space-y-1">
                <Label>Quem recebe</Label>
                <Select value={draft.commissionRecipientType} onValueChange={(commissionRecipientType) => update({ commissionRecipientType: commissionRecipientType as CampaignDraft["commissionRecipientType"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ambassador">Indicador</SelectItem><SelectItem value="partner">Parceiro</SelectItem></SelectContent>
                </Select>
              </div>
              {draft.commissionRecipientType === "partner" && <MultiSelectField
                label="Parceiros elegíveis"
                helper="Sem seleção, qualquer parceiro pode receber a comissão."
                options={partnerOptions}
                values={draft.eligiblePartnerIds}
                onToggle={(id) => toggleId("eligiblePartnerIds", id)}
                loading={partnersLoading}
                error={partnersError}
                emptyLabel="Nenhum parceiro cadastrado."
              />}
            </>}
          </FormSection>

          <div className="flex justify-end gap-2"><Button variant="outline" onClick={closeForm}>Cancelar</Button><Button onClick={onSave}>{editingId ? "Salvar alterações" : "Criar campanha"}</Button></div>
        </div>)}
      {campaigns.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma campanha cadastrada.</p>}
      {campaigns.length > 0 && <div className="space-y-2"><Label>Campanhas cadastradas</Label>{campaigns.map((campaign) => <div key={campaign.id} className="border rounded-lg p-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="font-medium">{campaign.name}</p><Badge variant={status(campaign) === "Ativa" ? "default" : "outline"}>{status(campaign)}</Badge></div><p className="text-xs text-muted-foreground">{new Date(campaign.startsAt).toLocaleDateString("pt-BR")} — {new Date(campaign.endsAt).toLocaleDateString("pt-BR")} · {campaign.referralsCount ?? 0} conversões · {fmtCurrency(campaign.bonusPaidAmount ?? 0)} pagos</p><div className="flex flex-wrap gap-1 mt-2">{campaign.commissionType && campaign.commissionType !== "none" && <Badge variant="outline">Comissão: {campaign.commissionType === "fixed" ? fmtCurrency(Number(campaign.commissionValue)) : `${Number(campaign.commissionValue)}% do bônus`}</Badge>}{campaign.eligibleTierLevels?.length ? <Badge variant="outline">Tiers: {campaign.eligibleTierLevels.map((tier) => tierLabels[tier] || tier).join(", ")}</Badge> : null}{campaign.conversionCap ? <Badge variant="outline">Máx: {campaign.conversionCap} conv.</Badge> : null}{campaign.materialUrl && <Badge variant="outline">Com material</Badge>}</div></div>{canEdit && <div className="flex gap-1 shrink-0"><Button variant="ghost" size="sm" onClick={() => onEdit(campaign)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(campaign.id)} disabled={deletePending}><Ban className="w-4 h-4" /></Button></div>}</div>)}</div>}
      </>}
    </div>
  </DialogContent></Dialog>;
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="space-y-3 rounded-lg border bg-background p-4">
    <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
    {children}
  </section>;
}

function Field({
  label, value, onChange, type = "text", placeholder, helper, min, max, step,
}: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string;
  helper?: string; min?: number; max?: number; step?: number;
}) {
  const id = useId();
  return <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} value={value} placeholder={placeholder} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />
    {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
  </div>;
}

function TextAreaField({ label, value, onChange, placeholder, helper }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; helper?: string }) {
  const id = useId();
  return <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Textarea id={id} value={value} placeholder={placeholder} maxLength={500} rows={3} onChange={(event) => onChange(event.target.value)} />
    {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
  </div>;
}

function MultiSelectField({
  label, helper, options, values, onToggle, loading, error, emptyLabel,
}: {
  label: string; helper: string; options: CampaignOption[]; values: string[]; onToggle: (id: string) => void;
  loading: boolean; error: boolean; emptyLabel: string;
}) {
  const [search, setSearch] = useState("");
  const visibleOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return options.filter((option) => !query || option.name.toLocaleLowerCase("pt-BR").includes(query));
  }, [options, search]);
  const optionIds = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const selectedOptions = options.filter((option) => values.includes(option.id));
  const missingIds = !loading ? values.filter((id) => !optionIds.has(id)) : [];

  return <div className="space-y-2">
    <Label>{label}</Label>
    <div className="rounded-md border p-2 space-y-2">
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${label.toLocaleLowerCase("pt-BR")}...`} aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`} />
      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
        {loading ? <p role="status" className="px-2 py-2 text-xs text-muted-foreground">Carregando opções…</p>
          : error ? <p role="alert" className="px-2 py-2 text-xs text-destructive">Não foi possível carregar as opções. Você ainda pode salvar sem aplicar este filtro.</p>
            : visibleOptions.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">{options.length ? "Nenhum resultado para a busca." : emptyLabel}</p>
              : visibleOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={values.includes(option.id)} onCheckedChange={() => onToggle(option.id)} />
                <span className="min-w-0 truncate">{option.name}</span>
              </label>)}
      </div>
    </div>
    {values.length === 0
      ? <p className="text-xs text-muted-foreground">{helper}</p>
      : <div className="flex flex-wrap gap-1.5">
        {selectedOptions.map((option) => <Badge key={option.id} variant="secondary" className="gap-1">
          {option.name}<button type="button" aria-label={`Remover ${option.name}`} onClick={() => onToggle(option.id)}><XCircle className="h-3 w-3" /></button>
        </Badge>)}
        {missingIds.map((id) => <Badge key={id} variant="outline" className="gap-1">
          ID não encontrado: {id}<button type="button" aria-label={`Remover ID ${id}`} onClick={() => onToggle(id)}><XCircle className="h-3 w-3" /></button>
        </Badge>)}
        <p className="basis-full text-xs text-muted-foreground">{values.length} selecionado(s).</p>
      </div>}
  </div>;
}