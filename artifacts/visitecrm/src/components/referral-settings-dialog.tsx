import type { Dispatch, SetStateAction } from "react";
import type { ReferralSettings, ReferralTierConfig } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Loader2, MessageCircle, Phone, Send, Star, XCircle } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

type WhatsAppTemplate = "converted" | "bonusPaid" | "reversed" | "share";
type SettingsDraft = Partial<ReferralSettings>;

interface ReferralSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SettingsDraft;
  setDraft: Dispatch<SetStateAction<SettingsDraft>>;
  defaultTiers: ReferralTierConfig[];
  settingsBonusValue: string | number;
  tenantName: string;
  whatsappTestPhone: string;
  setWhatsappTestPhone: (value: string) => void;
  whatsappTestState: Record<string, { loading?: boolean; success?: boolean; error?: string }>;
  settingsWhatsappTestLoading: boolean;
  updatePending: boolean;
  onSave: () => void;
  sendWhatsAppTest: (type: "converted" | "bonusPaid" | "share") => void;
  testWhatsappTemplate: (type: WhatsAppTemplate) => void;
}

export function ReferralSettingsDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  defaultTiers,
  settingsBonusValue,
  tenantName,
  whatsappTestPhone,
  setWhatsappTestPhone,
  whatsappTestState,
  settingsWhatsappTestLoading,
  updatePending,
  onSave,
  sendWhatsAppTest,
  testWhatsappTemplate,
}: ReferralSettingsDialogProps) {
  const extra = draft as SettingsDraft & Record<string, unknown>;
  const update = (changes: Partial<SettingsDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const updateExtra = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const tiers = draft.tiersConfig ?? defaultTiers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Configurações do Programa de Indicações</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <section className="border rounded-lg p-3 space-y-3">
            <SectionTitle>Ativação do Programa</SectionTitle>
            <ToggleRow label="Programa ativo" description="Ativar ou desativar o programa de indicações" checked={draft.isEnabled ?? true} onChange={(value) => update({ isEnabled: value })} />
          </section>

          <section className="border rounded-lg p-3 space-y-3">
            <SectionTitle>Benefícios para o Indicado</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Tipo de desconto</Label><Select value={draft.discountType ?? "percentage"} onValueChange={(value) => update({ discountType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage">Percentual (%)</SelectItem><SelectItem value="fixed">Valor fixo (R$)</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>{draft.discountType === "fixed" ? "Desconto (R$)" : "Desconto (%)"}</Label><Input type="number" step="0.01" value={draft.discountValue ?? "5.00"} onChange={(event) => update({ discountValue: event.target.value })} /></div>
            </div>
            <NumberField label="Validade do benefício para o indicado (dias)" value={extra.discountExpirationDays ?? 30} onChange={(value) => updateExtra("discountExpirationDays", value)} description="Por quantos dias o desconto gerado pelo código permanece válido após ser aplicado." />
          </section>

          <section className="border rounded-lg p-3 space-y-3">
            <SectionTitle>Recompensa para o Indicador</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Tipo de bônus</Label><Select value={draft.bonusType ?? "credit"} onValueChange={(value) => update({ bonusType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="credit">Cashback</SelectItem><SelectItem value="cash">Dinheiro</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Bônus (R$)</Label><Input type="number" step="0.01" value={draft.bonusValue ?? "10.00"} onChange={(event) => update({ bonusValue: event.target.value })} /></div>
            </div>
            <NumberField label="Período de carência do bônus (dias)" value={extra.gracePeriodDays ?? 30} min={0} onChange={(value) => updateExtra("gracePeriodDays", value)} description="Quantos dias após a conversão o bônus fica retido antes de ser liberado ao indicador." />
            <NumberField label="Validade do cashback/bônus do indicador (dias)" value={extra.bonusValidityDays ?? 30} min={0} onChange={(value) => updateExtra("bonusValidityDays", value)} description="Por quantos dias o bônus permanece válido para resgate após ser liberado. Use 0 para não expirar." />
          </section>

          <section className="border rounded-lg p-3 space-y-3">
            <SectionTitle>Elegibilidade e Limites</SectionTitle>
            <ToggleRow label="Exigir primeira compra" description="Bônus só é liberado após a primeira compra do indicado" checked={draft.requireFirstPurchase ?? true} onChange={(value) => update({ requireFirstPurchase: value })} />
            <ToggleRow label="Permitir auto-indicação" description="Permite que alguém use seu próprio código" checked={draft.allowSelfReferral ?? false} onChange={(value) => update({ allowSelfReferral: value })} />
            <NumberField label="Valor mínimo de compra (R$)" value={extra.minPurchaseAmount ?? ""} onChange={(value) => updateExtra("minPurchaseAmount", value === "" ? null : value)} description="Deixe em branco para não exigir." />
            <NumberField label="Máximo de indicações por indicador" value={extra.maxReferralsPerUser ?? 0} min={0} onChange={(value) => updateExtra("maxReferralsPerUser", value)} description="Use 0 para ilimitado." />
          </section>

          <section className="border rounded-lg p-3 space-y-3 bg-amber-50/60">
            <SectionTitle>Política de Códigos</SectionTitle>
            <NumberField label="Validade de indicação pendente (dias)" value={draft.expirationDays ?? 30} onChange={(value) => update({ expirationDays: Number(value) })} description="Por quantos dias uma indicação pendente aguarda conversão antes de expirar." />
            <div className="rounded-md bg-amber-100/70 border border-amber-200 p-3 text-xs text-amber-900 space-y-1"><p className="font-medium">Códigos são permanentes e gerenciados pela agência</p><p>Cada cliente possui um código único, gerado automaticamente no cadastro. Os códigos não expiram e não podem ser alterados ou regenerados pelo cliente — apenas a agência pode ativar ou bloquear um código.</p></div>
          </section>

          <MessageSetting label="Mensagem de compartilhamento" value={String(draft.shareMessage ?? "")} onChange={(value) => update({ shareMessage: value })} preview={String(draft.shareMessage ?? "").replace(/\{nome\}/g, "João").replace(/\{codigo\}/g, "JOAO123").replace(/\{link\}/g, "https://exemplo.com.br/ind/JOAO123").replace(/\{bonus\}/g, fmtCurrency(settingsBonusValue))} testLabel="Testar mensagem" onTest={() => sendWhatsAppTest("share")} loading={settingsWhatsappTestLoading} />

          <section className="space-y-3 border rounded-lg p-3 bg-indigo-50/50">
            <Label className="flex items-center gap-1.5 font-semibold text-indigo-800"><span>⭐</span>Pontos de fidelidade por indicação</Label>
            <NumberField label="Pontos por indicação confirmada" value={draft.pointsPerReferral ?? 0} min={0} onChange={(value) => update({ pointsPerReferral: Number(value) })} description="Use 0 para desativar." />
          </section>

          <section className="space-y-3 border rounded-lg p-3 bg-amber-50/50">
            <Label className="font-semibold text-amber-800">⏰ Avisos de vencimento por e-mail</Label>
            <ToggleRow label="Aviso 7 dias antes" description="Envia e-mail quando faltam 7 dias para o código vencer" checked={draft.expiryWarning7DaysEnabled ?? true} onChange={(value) => update({ expiryWarning7DaysEnabled: value })} />
            <ToggleRow label="Aviso 1 dia antes" description="Envia e-mail quando falta 1 dia para o código vencer" checked={draft.expiryWarning1DayEnabled ?? true} onChange={(value) => update({ expiryWarning1DayEnabled: value })} />
            <ToggleRow label="Aviso de bônus liberado" description={`Envia e-mail ao indicador após o período de carência de ${extra.gracePeriodDays ?? 30} dias`} checked={draft.bonusReleaseEmailEnabled ?? true} onChange={(value) => update({ bonusReleaseEmailEnabled: value })} />
            <ToggleRow label="Pontos de fidelidade creditados" description="Envia e-mail quando pontos são creditados" checked={draft.loyaltyPointsEmailEnabled !== false} onChange={(value) => update({ loyaltyPointsEmailEnabled: value })} />
          </section>

          <section className="space-y-3 border rounded-lg p-3 bg-green-50/50">
            <div className="flex items-center justify-between"><Label className="font-semibold text-green-800 flex items-center gap-1.5"><Phone className="w-4 h-4" />Notificações WhatsApp</Label><Switch checked={draft.whatsappEnabled ?? false} onCheckedChange={(value) => update({ whatsappEnabled: value })} /></div>
            {draft.whatsappEnabled && <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Número WhatsApp Business da agência</Label><Input value={String(draft.whatsappPhoneNumber ?? "")} onChange={(event) => update({ whatsappPhoneNumber: event.target.value })} placeholder="5511999999999 (código do país + DDD + número)" /></div>
              <div className="space-y-1 border border-dashed rounded-md p-2.5 bg-muted/20"><Label className="text-[11px]">Número de destino para teste</Label><Input className="h-7 text-xs" value={whatsappTestPhone} onChange={(event) => setWhatsappTestPhone(event.target.value)} placeholder="5511999999999 (DDI+DDD+número)" /></div>
              <MessageSetting label="Mensagem — conversão confirmada" multiline value={String(draft.whatsappConvertedMessage ?? "")} onChange={(value) => update({ whatsappConvertedMessage: value })} preview={previewTemplate(String(draft.whatsappConvertedMessage ?? ""), tenantName, settingsBonusValue)} testLabel="Testar envio" onTest={() => testWhatsappTemplate("converted")} testState={whatsappTestState.converted} />
              <MessageSetting label="Mensagem — bônus pago" multiline value={String(draft.whatsappBonusPaidMessage ?? "")} onChange={(value) => update({ whatsappBonusPaidMessage: value })} preview={previewTemplate(String(draft.whatsappBonusPaidMessage ?? ""), tenantName, settingsBonusValue)} testLabel="Testar envio" onTest={() => testWhatsappTemplate("bonusPaid")} testState={whatsappTestState.bonusPaid} />
              <MessageSetting label="Mensagem de estorno (reversão de bônus)" multiline value={String(draft.whatsappReversedMessage ?? "")} onChange={(value) => update({ whatsappReversedMessage: value })} preview={previewTemplate(String(draft.whatsappReversedMessage ?? ""), tenantName, settingsBonusValue)} testLabel="Testar envio" onTest={() => testWhatsappTemplate("reversed")} testState={whatsappTestState.reversed} />
            </div>}
          </section>

          <section className="space-y-2">
            <Label className="flex items-center gap-1.5"><Star className="w-3.5 h-3.5" />Níveis de Gamificação</Label>
            <p className="text-xs text-muted-foreground">Configure os limiares de indicações convertidas e o multiplicador de bônus de cada nível.</p>
            <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="text-left px-3 py-2 text-xs">Nível</th><th className="text-left px-3 py-2 text-xs">Mín. convert.</th><th className="text-left px-3 py-2 text-xs">Multiplicador</th></tr></thead><tbody className="divide-y">{tiers.map((tier, index) => <tr key={tier.level}><td className="px-3 py-2">{tier.label}</td><td className="px-3 py-2"><Input type="number" min={0} disabled={index === 0} className="h-7 w-20 text-xs" value={tier.minReferrals} onChange={(event) => { const next = [...tiers]; next[index] = { ...tier, minReferrals: parseInt(event.target.value) || 0 }; update({ tiersConfig: next }); }} /></td><td className="px-3 py-2"><Input type="number" min={0.1} step={0.05} className="h-7 w-20 text-xs" value={tier.bonusMultiplier} onChange={(event) => { const next = [...tiers]; next[index] = { ...tier, bonusMultiplier: parseFloat(event.target.value) || 1 }; update({ tiersConfig: next }); }} /></td></tr>)}</tbody></table></div>
          </section>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={onSave} disabled={updatePending}>{updatePending ? "Salvando..." : "Salvar"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between"><div><Label>{label}</Label><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function NumberField({ label, value, min, description, onChange }: { label: string; value: string | number; min?: number; description?: string; onChange: (value: string | number) => void }) {
  return <div className="space-y-1"><Label>{label}</Label><Input type="number" min={min} value={String(value)} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} /><>{description && <p className="text-xs text-muted-foreground">{description}</p>}</></div>;
}

function previewTemplate(template: string, agency: string, bonus: string | number) {
  return template.replace(/\{\{?nome\}?\}/g, "Maria").replace(/\{\{?codigo\}?\}/g, "JOAO123").replace(/\{\{?agencia\}?\}/g, agency).replace(/\{\{?(valor|bonus)\}?\}/g, fmtCurrency(bonus)).replace(/\{\{?saldo\}?\}/g, "0,00");
}

function MessageSetting({ label, value, onChange, preview, testLabel, onTest, loading, testState, multiline }: { label: string; value: string; onChange: (value: string) => void; preview: string; testLabel: string; onTest: () => void; loading?: boolean; testState?: { loading?: boolean; success?: boolean; error?: string }; multiline?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{multiline ? <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y" value={value} onChange={(event) => onChange(event.target.value)} /> : <Input value={value} onChange={(event) => onChange(event.target.value)} />}{value.trim() && <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5"><span className="font-medium">Pré-visualização:</span> {preview}</p>}<div className="flex items-center justify-end gap-2">{testState?.success && <span className="text-[11px] text-green-600"><Check className="inline w-3 h-3" /> Enviado com sucesso!</span>}{testState?.error && <span className="text-[11px] text-red-500"><XCircle className="inline w-3 h-3" /> {testState.error}</span>}<Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={loading || testState?.loading} onClick={onTest}>{(loading || testState?.loading) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}{testLabel}</Button></div></div>;
}