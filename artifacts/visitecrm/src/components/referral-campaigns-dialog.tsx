import type { Dispatch, SetStateAction } from "react";
import type { ReferralCampaign } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Ban, Flame, Megaphone, Pencil, XCircle } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

export interface CampaignDraft {
  name: string; startsAt: string; endsAt: string;
  bonusType: "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  bonusValue: string; bannerText: string; eligibleStoreProductIds: string; eligibleTierLevels: string[];
  conversionCap: string; budgetAmount: string; shareMessage: string; materialUrl: string; publicRanking: boolean;
  eligibleActivitySegments: Array<"active" | "occasional" | "inactive">; eligibleChannels: string;
  commissionType: "none" | "fixed" | "bonus_percentage"; commissionValue: string;
  commissionRecipientType: "ambassador" | "partner"; eligiblePartnerIds: string;
}
interface Props {
  open: boolean; onOpenChange: (value: boolean) => void; campaigns: ReferralCampaign[];
  activeCampaign: ReferralCampaign | undefined; showForm: boolean; setShowForm: (value: boolean) => void;
  draft: CampaignDraft; setDraft: Dispatch<SetStateAction<CampaignDraft>>;
  editingId: string | null; onEditingIdChange: (id: string | null) => void;
  onSave: () => void; onEdit: (campaign: ReferralCampaign) => void; onDelete: (id: string) => void;
  deletePending: boolean;
}

const emptyDraft = (): CampaignDraft => ({ name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "", eligibleStoreProductIds: "", eligibleTierLevels: [], conversionCap: "", budgetAmount: "", shareMessage: "", materialUrl: "", publicRanking: true, eligibleActivitySegments: [], eligibleChannels: "", commissionType: "none", commissionValue: "0", commissionRecipientType: "ambassador", eligiblePartnerIds: "" });
const tierLabels: Record<string, string> = { bronze: "Bronze", silver: "Prata", gold: "Ouro", diamond: "Diamante" };

export function ReferralCampaignsDialog({ open, onOpenChange, campaigns, activeCampaign, showForm, setShowForm, draft, setDraft, editingId, onEditingIdChange, onSave, onEdit, onDelete, deletePending }: Props) {
  const update = (value: Partial<CampaignDraft>) => setDraft((current) => ({ ...current, ...value }));
  const toggle = (key: "eligibleTierLevels" | "eligibleActivitySegments", value: string) => {
    const current = draft[key] as string[];
    update({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] } as Partial<CampaignDraft>);
  };
  const closeForm = () => { setShowForm(false); onEditingIdChange(null); setDraft(emptyDraft()); };
  const status = (campaign: ReferralCampaign) => new Date(campaign.endsAt) < new Date() ? "Encerrada" : new Date(campaign.startsAt) > new Date() ? "Agendada" : "Ativa";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5 text-primary" />Campanhas de Indicação</DialogTitle><DialogDescription>Crie promoções temporárias de bônus — apenas uma campanha pode estar ativa por vez.</DialogDescription></DialogHeader>
    <div className="space-y-4 pt-1">
      {activeCampaign && <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"><Flame className="w-4 h-4 mt-0.5 text-green-600" /><span><b>Campanha ativa agora:</b> {activeCampaign.name} — termina em {new Date(activeCampaign.endsAt).toLocaleString("pt-BR")}</span></div>}
      {!showForm ? <Button variant="outline" onClick={() => setShowForm(true)}><Megaphone className="w-4 h-4 mr-2" />Nova campanha</Button> :
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between"><p className="font-semibold text-sm">{editingId ? "Editar campanha" : "Nova campanha"}</p><Button variant="ghost" size="sm" onClick={closeForm}><XCircle className="w-4 h-4" /></Button></div>
          <Field label="Nome da campanha *" value={draft.name} onChange={(name) => update({ name })} placeholder="Ex: Bônus Duplo de Maio, Promoção Férias" />
          <div className="grid grid-cols-2 gap-2"><Field label="Início *" type="datetime-local" value={draft.startsAt} onChange={(startsAt) => update({ startsAt })} /><Field label="Término *" type="datetime-local" value={draft.endsAt} onChange={(endsAt) => update({ endsAt })} /></div>
          <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Tipo de bônus *</Label><Select value={draft.bonusType} onValueChange={(bonusType) => update({ bonusType: bonusType as CampaignDraft["bonusType"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="multiplier">Multiplicador</SelectItem><SelectItem value="fixed_extra">Bônus extra fixo</SelectItem><SelectItem value="fixed_bonus">Bônus fixo</SelectItem><SelectItem value="percentage_bonus">Percentual do bônus</SelectItem><SelectItem value="reduced_bonus">Bônus reduzido</SelectItem><SelectItem value="no_reward">Sem recompensa</SelectItem></SelectContent></Select></div>{draft.bonusType !== "no_reward" && <Field label={draft.bonusType === "multiplier" ? "Multiplicador *" : "Valor/Percentual *"} type="number" value={draft.bonusValue} onChange={(bonusValue) => update({ bonusValue })} />}</div>
          <div className="grid grid-cols-2 gap-2"><Field label="Limite de conversões" type="number" value={draft.conversionCap} onChange={(conversionCap) => update({ conversionCap })} placeholder="Ilimitado" /><Field label="Orçamento máximo (R$)" type="number" value={draft.budgetAmount} onChange={(budgetAmount) => update({ budgetAmount })} placeholder="Sem limite" /></div>
          <div className="space-y-1"><Label>Tiers elegíveis</Label><Select value={draft.eligibleTierLevels.length ? "custom" : "all"} onValueChange={(value) => { if (value === "all") update({ eligibleTierLevels: [] }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os tiers</SelectItem><SelectItem value="custom">Selecionar tiers abaixo</SelectItem></SelectContent></Select>{draft.eligibleTierLevels.length > 0 && <div className="flex gap-3 flex-wrap pt-1">{Object.entries(tierLabels).map(([id, label]) => <label key={id} className="flex items-center gap-1 text-sm"><Checkbox checked={draft.eligibleTierLevels.includes(id)} onCheckedChange={() => toggle("eligibleTierLevels", id)} />{label}</label>)}</div>}</div>
          <Field label="Produtos elegíveis (IDs separados por vírgula)" value={draft.eligibleStoreProductIds} onChange={(eligibleStoreProductIds) => update({ eligibleStoreProductIds })} />
          <div className="space-y-1"><Label>Segmentos de atividade</Label><div className="flex gap-3">{[["active", "Ativos"], ["occasional", "Ocasionais"], ["inactive", "Inativos"]].map(([id, label]) => <label key={id} className="flex items-center gap-1 text-sm"><Checkbox checked={draft.eligibleActivitySegments.includes(id as CampaignDraft["eligibleActivitySegments"][number])} onCheckedChange={() => toggle("eligibleActivitySegments", id)} />{label}</label>)}</div></div>
          <Field label="Canais elegíveis (separados por vírgula)" value={draft.eligibleChannels} onChange={(eligibleChannels) => update({ eligibleChannels })} placeholder="instagram, whatsapp" />
          <Field label="Texto do banner" value={draft.bannerText} onChange={(bannerText) => update({ bannerText })} />
          <Field label="Mensagem de compartilhamento" value={draft.shareMessage} onChange={(shareMessage) => update({ shareMessage })} />
          <Field label="URL do material" value={draft.materialUrl} onChange={(materialUrl) => update({ materialUrl })} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.publicRanking} onCheckedChange={(publicRanking) => update({ publicRanking: publicRanking === true })} />Exibir ranking público</label>
          <div className="border-t pt-3 space-y-2"><Label>Comissão</Label><div className="grid grid-cols-2 gap-2"><Select value={draft.commissionType} onValueChange={(commissionType) => update({ commissionType: commissionType as CampaignDraft["commissionType"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem comissão</SelectItem><SelectItem value="fixed">Valor fixo</SelectItem><SelectItem value="bonus_percentage">Percentual do bônus</SelectItem></SelectContent></Select>{draft.commissionType !== "none" && <Field label="Valor" type="number" value={draft.commissionValue} onChange={(commissionValue) => update({ commissionValue })} />}</div>{draft.commissionType !== "none" && <><Select value={draft.commissionRecipientType} onValueChange={(commissionRecipientType) => update({ commissionRecipientType: commissionRecipientType as CampaignDraft["commissionRecipientType"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ambassador">Divulgador</SelectItem><SelectItem value="partner">Parceiro</SelectItem></SelectContent></Select>{draft.commissionRecipientType === "partner" && <Field label="IDs de parceiros (separados por vírgula)" value={draft.eligiblePartnerIds} onChange={(eligiblePartnerIds) => update({ eligiblePartnerIds })} />}</>}</div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={closeForm}>Cancelar</Button><Button onClick={onSave}>{editingId ? "Salvar alterações" : "Criar campanha"}</Button></div>
        </div>}
      {campaigns.length > 0 && <div className="space-y-2"><Label>Campanhas cadastradas</Label>{campaigns.map((campaign) => <div key={campaign.id} className="border rounded-lg p-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="font-medium">{campaign.name}</p><Badge variant={status(campaign) === "Ativa" ? "default" : "outline"}>{status(campaign)}</Badge></div><p className="text-xs text-muted-foreground">{new Date(campaign.startsAt).toLocaleDateString("pt-BR")} — {new Date(campaign.endsAt).toLocaleDateString("pt-BR")} · {campaign.referralsCount ?? 0} conversões · {fmtCurrency(campaign.bonusPaidAmount ?? 0)} pagos</p><div className="flex flex-wrap gap-1 mt-2">{campaign.commissionType && campaign.commissionType !== "none" && <Badge variant="outline">Comissão: {campaign.commissionType === "fixed" ? fmtCurrency(Number(campaign.commissionValue)) : `${Number(campaign.commissionValue)}% do bônus`}</Badge>}{campaign.eligibleTierLevels?.length ? <Badge variant="outline">Tiers: {campaign.eligibleTierLevels.map((tier) => tierLabels[tier] || tier).join(", ")}</Badge> : null}{campaign.conversionCap ? <Badge variant="outline">Máx: {campaign.conversionCap} conv.</Badge> : null}{campaign.materialUrl && <Badge variant="outline">Com material</Badge>}</div></div><div className="flex gap-1 shrink-0"><Button variant="ghost" size="sm" onClick={() => onEdit(campaign)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(campaign.id)} disabled={deletePending}><Ban className="w-4 h-4" /></Button></div></div>)}</div>}
    </div>
  </DialogContent></Dialog>;
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <div className="space-y-1"><Label>{label}</Label><Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}