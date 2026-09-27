import type { Referral } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Copy, Wallet, XCircle } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency, formatDate as fmtDate, formatDateTime as fmtDateTime } from "@/lib/utils";

type DetailReferral = Referral & { referrerWhatsapp?: string | null; bonusBlocked?: boolean; bonusReleasesAt?: string | null };
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; referral: DetailReferral | null;
  copiedLink: boolean; shareLink?: string; onCopyLink: () => void;
  onPay: () => void; onReverse: () => void; canPay: boolean; canReverse: boolean;
  expiryStatus?: any; bonusStatus?: any;
  onResendExpiry?: (kind: "7" | "1") => void; onResendBonus?: () => void; resendPending?: boolean;
}

export function ReferralDetailDialog({ open, onOpenChange, referral, copiedLink, shareLink, onCopyLink, onPay, onReverse, canPay, canReverse, expiryStatus, bonusStatus, onResendExpiry, onResendBonus, resendPending }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Detalhes da Indicação</DialogTitle><DialogDescription>Dados da indicação, bônus e notificações.</DialogDescription></DialogHeader>
        {referral && <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Dados do indicador · {referral.code}</p>
            <p>{referral.referrerName ?? "—"} · {referral.referrerEmail ?? "—"}</p>
            {referral.referrerWhatsapp
              ? <a className="text-green-700" href={`https://wa.me/55${referral.referrerWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">WhatsApp: {referral.referrerWhatsapp}</a>
              : referral.referrerPhone && <p>Telefone: {referral.referrerPhone}</p>}
            <p>Indicado: {referral.referredName ?? "—"} · {referral.referredEmail ?? "—"}</p>
            <p>Status: {referral.status === "reversed" ? "Revertida" : referral.status === "completed" ? "Convertida" : referral.status === "expired" ? "Expirada" : "Pendente"}</p>
            <p>Criado em {fmtDate(referral.createdAt)} · expira em {referral.expiresAt ? fmtDate(referral.expiresAt) : "—"}</p>
            <p>Visitas: {referral.visitsCount ?? 0} · última visita: {fmtDateTime(referral.lastVisit)}</p>
            <p>Desconto: {referral.discountApplied ? fmtCurrency(referral.discountAmount ?? 0) : `${referral.discountValue}%`}</p>
          </div>
          <div className="border rounded-lg p-4 space-y-2 text-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Bônus</p>
            <p>Valor: <strong>{fmtCurrency(referral.bonusAmount)}</strong></p>
            <Badge variant={referral.bonusPaid ? "default" : "secondary"}>{referral.bonusPaid ? "Pago" : referral.status === "reversed" ? "Revertido" : referral.bonusBlocked ? "Bloqueado" : "Pendente"}</Badge>
            {referral.bonusBlocked && <p className="text-amber-700">Bônus bloqueado · disponível em {referral.bonusReleasesAt ? fmtDate(referral.bonusReleasesAt) : "data ainda não informada"}</p>}
            {referral.bonusPaidAt && <p>Pago em {fmtDateTime(referral.bonusPaidAt)}</p>}
          </div>
          {(expiryStatus || bonusStatus) && <div className="border rounded-lg p-3 text-xs space-y-1">
            <p className="font-semibold">Notificações por e-mail</p>
            {expiryStatus?.warning7SentAt && <p>Aviso D-7 enviado em {fmtDateTime(expiryStatus.warning7SentAt)}</p>}
            {expiryStatus?.warning1SentAt && <p>Aviso D-1 enviado em {fmtDateTime(expiryStatus.warning1SentAt)}</p>}
            {bonusStatus?.sentAt && <p>Liberação de bônus enviada em {fmtDateTime(bonusStatus.sentAt)}</p>}
            <div className="flex gap-2 flex-wrap">
              {onResendExpiry && <><Button size="sm" variant="outline" disabled={resendPending} onClick={() => onResendExpiry("7")}>Reenviar D-7</Button><Button size="sm" variant="outline" disabled={resendPending} onClick={() => onResendExpiry("1")}>Reenviar D-1</Button></>}
              {onResendBonus && <Button size="sm" variant="outline" disabled={resendPending} onClick={onResendBonus}>Reenviar liberação</Button>}
            </div>
          </div>}
          {shareLink && <div className="flex items-center gap-2"><code className="text-xs truncate flex-1">{shareLink}</code><Button aria-label="Copiar link" size="sm" variant="outline" onClick={onCopyLink}>{copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}</Button></div>}
        </div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {canPay && referral?.status === "completed" && !referral.bonusPaid && <Button onClick={onPay} disabled={referral.bonusBlocked}><Wallet className="w-4 h-4 mr-2" />Pagar Bônus</Button>}
          {canReverse && referral?.status === "completed" && <Button variant="outline" onClick={onReverse} className="text-red-700"><XCircle className="w-4 h-4 mr-2" />Reverter bônus</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}