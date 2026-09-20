import { Link } from "wouter";
import type { Referral, ReferralTierConfig } from "@workspace/api-client-react";
import { REFERRAL_STATUS, ROLES } from "@workspace/permissions";
import { formatCurrencyBRL as fmtCurrency, formatDate as _formatDate, formatDateTime as _formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Ban,
  BarChart3,
  Check,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Mail,
  MessageCircle,
  Phone,
  ShieldAlert,
  Share2,
  Star,
  Wallet,
  XCircle,
} from "lucide-react";
import type { LinkedData } from "@/lib/linked-data";

export type ReferralTableRow = Referral & LinkedData & {
  referrerWhatsapp?: string | null;
  bonusReleasesAt?: string | null;
  bonusBlocked?: boolean;
  referrerSuccessfulReferrals?: number | null;
  reversalReason?: string | null;
  reversalAt?: string | null;
};

type BonusNotifiedFilter = "all" | "notified" | "not_notified";

interface ReferralTableSectionProps {
  referrals: ReferralTableRow[];
  settingsTiers?: ReferralTierConfig[] | null;
  currentUserRole?: string | null;
  activeTab: string;
  searchQuery: string;
  bonusNotifiedFilter: BonusNotifiedFilter;
  onBonusNotifiedFilterChange: (value: BonusNotifiedFilter) => void;
  referralsLoading: boolean;
  referralsFetching: boolean;
  referralsError: boolean;
  referralTotal: number;
  referralPageCount: number;
  referralsPage: number;
  expiringSoonCount: number | null;
  pendingBonusCount: number | null;
  suspiciousCount: number | null;
  bonusNotifiedCount: number | null;
  bonusNotNotifiedCount: number | null;
  selectedBonusIds: Set<string>;
  onSearchChange: (value: string) => void;
  onApplyTab: (tab: string) => void;
  onSelectedBonusIdsChange: (ids: Set<string>) => void;
  onPageChange: (page: number) => void;
  onOpenDetail: (referral: ReferralTableRow) => void;
  onOpenShare: (referral: ReferralTableRow) => void;
  onOpenPayBonus: (referral: ReferralTableRow) => void;
  onOpenReverseBonus: (referral: ReferralTableRow) => void;
  onDeactivate: (referral: ReferralTableRow) => void;
  onBulkPay: () => void;
}

const DEFAULT_TIERS: ReferralTierConfig[] = [
  { level: "bronze", label: "Bronze", minReferrals: 0, bonusMultiplier: 1 },
  { level: "silver", label: "Prata", minReferrals: 5, bonusMultiplier: 1.25 },
  { level: "gold", label: "Ouro", minReferrals: 15, bonusMultiplier: 1.5 },
  { level: "diamond", label: "Diamante", minReferrals: 30, bonusMultiplier: 2 },
];

const TIER_VISUAL: Record<string, { bg: string; color: string }> = {
  bronze: { bg: "bg-amber-100", color: "text-amber-700" },
  silver: { bg: "bg-slate-100", color: "text-slate-600" },
  gold: { bg: "bg-yellow-100", color: "text-yellow-700" },
  diamond: { bg: "bg-cyan-100", color: "text-cyan-700" },
};

const STATUS_LABELS: Record<string, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}> = {
  [REFERRAL_STATUS.PENDING]: { label: "Pendente", variant: "secondary" },
  [REFERRAL_STATUS.COMPLETED]: { label: "Convertida", variant: "default" },
  [REFERRAL_STATUS.EXPIRED]: { label: "Expirada", variant: "destructive" },
  [REFERRAL_STATUS.CONVERTED]: { label: "Convertida", variant: "default" },
  [REFERRAL_STATUS.REVERSED]: { label: "Revertida", variant: "destructive" },
};

const fmtDate = (value: string | null | undefined) => value ? _formatDate(value) : "—";
const fmtDateTime = (value: string | null | undefined) => value ? _formatDateTime(value) : "—";

function computeAdminTier(
  conversions: number,
  tiersConfig?: ReferralTierConfig[] | null,
): ReferralTierConfig {
  const tiers = tiersConfig && tiersConfig.length > 0
    ? [...tiersConfig].sort((a, b) => a.minReferrals - b.minReferrals)
    : DEFAULT_TIERS;
  let current = tiers[0];
  for (const tier of tiers) {
    if (conversions >= tier.minReferrals) current = tier;
  }
  return current;
}

function ReferralTierBadge({ level, label }: { level: string; label: string }) {
  const visual = TIER_VISUAL[level] ?? { bg: "bg-gray-100", color: "text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${visual.bg} ${visual.color}`}>
      <Star className="w-3 h-3" />
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusInfo = STATUS_LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
}

function fmtWhatsapp(value: string | null | undefined) {
  return value ? value.replace(/\D/g, "") : null;
}

export function ReferralTableSection({
  referrals,
  settingsTiers,
  currentUserRole,
  activeTab,
  searchQuery,
  bonusNotifiedFilter,
  onBonusNotifiedFilterChange,
  referralsLoading,
  referralsFetching,
  referralsError,
  referralTotal,
  referralPageCount,
  referralsPage,
  expiringSoonCount,
  pendingBonusCount,
  suspiciousCount,
  bonusNotifiedCount,
  bonusNotNotifiedCount,
  selectedBonusIds,
  onSearchChange,
  onApplyTab,
  onSelectedBonusIdsChange,
  onPageChange,
  onOpenDetail,
  onOpenShare,
  onOpenPayBonus,
  onOpenReverseBonus,
  onDeactivate,
  onBulkPay,
}: ReferralTableSectionProps) {
  const pendingBonusReferrals = referrals.filter(
    (referral) => referral.status === REFERRAL_STATUS.COMPLETED && !referral.bonusPaid,
  );
  const allBonusSelected = pendingBonusReferrals.length > 0 &&
    pendingBonusReferrals.every((referral) => selectedBonusIds.has(referral.id));
  const canReverse = currentUserRole === ROLES.AGENCY_ADMIN ||
    currentUserRole === ROLES.AGENCY_MANAGER ||
    currentUserRole === ROLES.SUPER_ADMIN;

  return (
    <>
      <Tabs value={activeTab} onValueChange={onApplyTab}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="pending">Pendentes</TabsTrigger>
            <TabsTrigger value="expiringSoon">
              <Clock className="w-3.5 h-3.5 mr-1 text-amber-500" />
              Expiram em breve
              {expiringSoonCount !== null && expiringSoonCount > 0 && (
                <Badge variant="outline" className="ml-1.5 px-1.5 py-0 text-xs h-4 border-amber-400 text-amber-700">
                  {expiringSoonCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed">Convertidas</TabsTrigger>
            <TabsTrigger value="completed-unpaid">
              Bônus pendente
              {pendingBonusCount !== null && pendingBonusCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 px-1.5 py-0 text-xs h-4">
                  {pendingBonusCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="expired">Expiradas</TabsTrigger>
            <TabsTrigger value="suspicious">
              <ShieldAlert className="w-3.5 h-3.5 mr-1" />
              Suspeitas
              {suspiciousCount !== null && suspiciousCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 px-1.5 py-0 text-xs h-4">
                  {suspiciousCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <Label htmlFor="referral-search" className="sr-only">
            Buscar indicações
          </Label>
          <Input
            id="referral-search"
            placeholder="Buscar por código, nome, e-mail ou WhatsApp..."
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="max-w-xs"
            disabled={activeTab === "suspicious" || activeTab === "expiringSoon"}
          />
          <SelectBonusNotificationFilter
            value={bonusNotifiedFilter}
            onChange={onBonusNotifiedFilterChange}
            bonusNotifiedCount={bonusNotifiedCount}
            bonusNotNotifiedCount={bonusNotNotifiedCount}
          />
          {activeTab === "completed-unpaid" && selectedBonusIds.size > 0 && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 shrink-0"
              onClick={onBulkPay}
            >
              <CheckSquare2 className="w-3.5 h-3.5 mr-1.5" />
              Pagar selecionados ({selectedBonusIds.size})
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {referralsFetching ? "Atualizando…" : (
              <>
                {referrals.length} nesta página{referralTotal > referrals.length ? ` · ${referralTotal} no total` : ""}
              </>
            )}
          </span>
        </div>

        {["all", "pending", "expiringSoon", "completed", "completed-unpaid", "expired", "suspicious"].map((tabValue) => (
          <TabsContent key={tabValue} value={tabValue}>
            {referralsLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground" role="status" aria-live="polite">
                  Carregando indicações…
                </CardContent>
              </Card>
            ) : referralsError ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground" role="alert">
                  Não foi possível carregar as indicações. Tente atualizar a página.
                </CardContent>
              </Card>
            ) : referrals.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  {tabValue === "suspicious" ? "Nenhuma indicação suspeita encontrada" : "Nenhuma indicação encontrada"}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {tabValue === "completed-unpaid" && (
                          <TableHead className="w-8">
                            <Checkbox
                              checked={allBonusSelected}
                              aria-label="Selecionar todas as indicações com bônus pendente nesta página"
                              onCheckedChange={(checked) => {
                                onSelectedBonusIdsChange(
                                  checked ? new Set(pendingBonusReferrals.map((referral) => referral.id)) : new Set(),
                                );
                              }}
                            />
                          </TableHead>
                        )}
                        <TableHead>Código</TableHead>
                        <TableHead>Quem indicou</TableHead>
                        <TableHead>Indicado</TableHead>
                        <TableHead>Status</TableHead>
                        {tabValue === "suspicious" && <TableHead className="text-red-600">Motivo</TableHead>}
                        <TableHead>Bônus</TableHead>
                        <TableHead>Desconto</TableHead>
                        <TableHead>Vínculos</TableHead>
                        <TableHead>Visitas</TableHead>
                        <TableHead>Última visita</TableHead>
                        <TableHead>Expira em</TableHead>
                        <TableHead>Criado em</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {referrals.map((referral) => (
                        <ReferralTableRow
                          key={referral.id}
                          referral={referral}
                          showSelection={tabValue === "completed-unpaid"}
                          showFraudReason={tabValue === "suspicious"}
                          selected={selectedBonusIds.has(referral.id)}
                          settingsTiers={settingsTiers}
                          canReverse={canReverse}
                          onSelectedChange={(checked) => {
                            const next = new Set(selectedBonusIds);
                            if (checked) next.add(referral.id);
                            else next.delete(referral.id);
                            onSelectedBonusIdsChange(next);
                          }}
                          onOpenDetail={onOpenDetail}
                          onOpenShare={onOpenShare}
                          onOpenPayBonus={onOpenPayBonus}
                          onOpenReverseBonus={onOpenReverseBonus}
                          onDeactivate={onDeactivate}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {referralPageCount > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={referralsPage <= 1}
            onClick={() => onPageChange(Math.max(1, referralsPage - 1))}
          >
            <ChevronLeft className="w-3.5 h-3.5 mr-1" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {referralsPage} de {referralPageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={referralsPage >= referralPageCount}
            onClick={() => onPageChange(Math.min(referralPageCount, referralsPage + 1))}
          >
            Próxima
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      )}
    </>
  );
}

function SelectBonusNotificationFilter({
  value,
  onChange,
  bonusNotifiedCount,
  bonusNotNotifiedCount,
}: {
  value: BonusNotifiedFilter;
  onChange: (value: BonusNotifiedFilter) => void;
  bonusNotifiedCount: number | null;
  bonusNotNotifiedCount: number | null;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as BonusNotifiedFilter)}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Notif. bônus: Todos</SelectItem>
        <SelectItem value="notified">
          Notificados{bonusNotifiedCount !== null ? ` (${bonusNotifiedCount})` : ""}
        </SelectItem>
        <SelectItem value="not_notified">
          Não notificados{bonusNotNotifiedCount !== null ? ` (${bonusNotNotifiedCount})` : ""}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

interface ReferralTableRowProps {
  referral: ReferralTableRow;
  showSelection: boolean;
  showFraudReason: boolean;
  selected: boolean;
  settingsTiers?: ReferralTierConfig[] | null;
  canReverse: boolean;
  onSelectedChange: (checked: boolean) => void;
  onOpenDetail: (referral: ReferralTableRow) => void;
  onOpenShare: (referral: ReferralTableRow) => void;
  onOpenPayBonus: (referral: ReferralTableRow) => void;
  onOpenReverseBonus: (referral: ReferralTableRow) => void;
  onDeactivate: (referral: ReferralTableRow) => void;
}

function ReferralTableRow({
  referral,
  showSelection,
  showFraudReason,
  selected,
  settingsTiers,
  canReverse,
  onSelectedChange,
  onOpenDetail,
  onOpenShare,
  onOpenPayBonus,
  onOpenReverseBonus,
  onDeactivate,
}: ReferralTableRowProps) {
  const conversions = referral.referrerSuccessfulReferrals ?? 0;
  const tier = computeAdminTier(conversions, settingsTiers);
  const whatsapp = fmtWhatsapp(referral.referrerWhatsapp);
  const daysLeft = referral.expiresAt
    ? Math.ceil((new Date(referral.expiresAt).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <TableRow>
      {showSelection && (
        <TableCell>
          <Checkbox
            checked={selected}
            aria-label={`Selecionar indicação ${referral.code}`}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
          />
        </TableCell>
      )}
      <TableCell className="font-mono font-semibold text-primary">{referral.code}</TableCell>
      <TableCell>
        <div>
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <p className="font-medium text-sm leading-tight">
              {referral.referrerName ?? referral.referrerId.slice(0, 8)}
            </p>
            <ReferralTierBadge level={tier.level} label={tier.label} />
          </div>
          {referral.referrerEmail && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Mail className="w-2.5 h-2.5 shrink-0" />
              {referral.referrerEmail}
            </p>
          )}
          {whatsapp && (
            <a
              href={`https://wa.me/55${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-600 flex items-center gap-1 mt-0.5 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              <MessageCircle className="w-2.5 h-2.5 shrink-0" />
              {referral.referrerWhatsapp}
            </a>
          )}
          {referral.referrerPhone && !referral.referrerWhatsapp && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Phone className="w-2.5 h-2.5 shrink-0" />
              {referral.referrerPhone}
            </p>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div>
          <p className="text-sm">{referral.referredName ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{referral.referredEmail ?? ""}</p>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={referral.status} />
        {!referral.isActive && <Badge variant="outline" className="ml-1 text-xs">inativo</Badge>}
      </TableCell>
      {showFraudReason && (
        <TableCell>
          <div className="flex items-start gap-1 text-red-600">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="text-xs leading-snug">{referral.fraudReason ?? "—"}</span>
          </div>
        </TableCell>
      )}
      <TableCell>
        {referral.status === REFERRAL_STATUS.REVERSED ? (
          <div>
            <p className="text-sm font-medium text-red-600 line-through">{fmtCurrency(referral.bonusAmount)}</p>
            <p className="text-xs text-red-500 flex items-center gap-0.5">
              <XCircle className="w-2.5 h-2.5" />
              Revertido
            </p>
            {referral.reversalReason && (
              <p className="text-xs text-red-400">
                {referral.reversalReason === "reservation_cancelled"
                  ? "Reserva cancelada"
                  : referral.reversalReason === "trip_cancelled"
                    ? "Excursão cancelada"
                    : referral.reversalReason}
              </p>
            )}
          </div>
        ) : referral.status === REFERRAL_STATUS.COMPLETED ? (
          <div>
            <p className="text-sm font-medium text-green-600">{fmtCurrency(referral.bonusAmount)}</p>
            {referral.bonusPaid ? (
              <p className="text-xs text-green-700 flex items-center gap-0.5">
                <Check className="w-2.5 h-2.5" />
                Pago {referral.bonusPaidAt ? `em ${fmtDate(referral.bonusPaidAt)}` : ""}
              </p>
            ) : referral.bonusBlocked && referral.bonusReleasesAt ? (
              <p className="text-xs text-slate-500 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                Disponível em {fmtDate(referral.bonusReleasesAt)}
              </p>
            ) : (
              <p className="text-xs text-amber-600">Pendente</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{referral.discountApplied ? fmtCurrency(referral.discountAmount) : `${referral.discountValue}%`}</TableCell>
      <TableCell className="text-xs">
        {referral.linkedOrder ? (
          <div data-testid={`text-referral-order-${referral.id}`}>
            Pedido <span className="font-mono">{referral.linkedOrder.orderNumber}</span>
            {referral.linkedReservations?.length ? (
              <> · {referral.linkedReservations.map((reservation, index) => (
                <span key={reservation.id}>
                  {index > 0 ? ", " : ""}
                  <Link href={`/reservations/${reservation.id}`} className="font-mono text-primary hover:underline" data-testid={`link-referral-reservation-${reservation.id}`}>
                    {reservation.reservationNumber}
                  </Link>
                </span>
              ))}</>
            ) : ""}
          </div>
        ) : referral.linkedReservations?.length ? (
          <div data-testid={`text-referral-reservations-${referral.id}`}>
            {referral.linkedReservations.map((reservation, index) => (
              <span key={reservation.id}>
                {index > 0 ? ", " : ""}
                <Link href={`/reservations/${reservation.id}`} className="font-mono text-primary hover:underline" data-testid={`link-referral-reservation-${reservation.id}`}>
                  {reservation.reservationNumber}
                </Link>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{referral.visitsCount ?? 0}</TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(referral.lastVisit)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {daysLeft === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : daysLeft <= 0 ? (
          <Badge variant="destructive" className="text-xs">Expirado</Badge>
        ) : daysLeft <= 3 ? (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 gap-1">
            <Clock className="w-3 h-3" />
            {fmtDate(referral.expiresAt)}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{fmtDate(referral.expiresAt)}</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(referral.createdAt)}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenDetail(referral)}
            title="Ver detalhes"
            aria-label={`Ver detalhes da indicação ${referral.code}`}
          >
            <Eye className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            onClick={() => onOpenShare(referral)}
            title="Compartilhar link de indicação"
            aria-label={`Compartilhar indicação ${referral.code}`}
          >
            <Share2 className="w-3 h-3" />
          </Button>
          {referral.status === REFERRAL_STATUS.COMPLETED && !referral.bonusPaid && (
            <Button
              size="sm"
              variant="ghost"
              className={referral.bonusBlocked ? "text-slate-400 cursor-not-allowed" : "text-green-600 hover:text-green-700 hover:bg-green-50"}
              onClick={() => { if (!referral.bonusBlocked) onOpenPayBonus(referral); }}
              title={referral.bonusBlocked && referral.bonusReleasesAt ? `Bônus disponível em ${fmtDate(referral.bonusReleasesAt)}` : "Pagar bônus"}
              aria-label={`Pagar bônus da indicação ${referral.code}`}
            >
              <Wallet className="w-3 h-3" />
            </Button>
          )}
          {referral.status === REFERRAL_STATUS.COMPLETED && canReverse && (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => onOpenReverseBonus(referral)}
              title={referral.bonusPaid ? "Estornar bônus já pago" : "Reverter bônus"}
              aria-label={`${referral.bonusPaid ? "Estornar" : "Reverter"} bônus da indicação ${referral.code}`}
            >
              <XCircle className="w-3 h-3" />
            </Button>
          )}
          {referral.isActive && referral.status === REFERRAL_STATUS.PENDING && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onDeactivate(referral)}
              title="Desativar"
              aria-label={`Desativar indicação ${referral.code}`}
            >
              <Ban className="w-3 h-3" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}