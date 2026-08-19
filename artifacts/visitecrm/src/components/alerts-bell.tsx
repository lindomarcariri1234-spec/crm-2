import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, AlertTriangle, Info, XCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { ROLES } from "@workspace/permissions";

interface ReferralSkip {
  reservationId: string;
  reservationNumber: string | null;
  referralCode: string;
  referrerName: string | null;
}

interface Alert {
  id: string;
  type: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  actionHref: string;
  count: number;
  reservationIds?: string[];
  referralSkips?: ReferralSkip[];
}

interface AlertsResponse {
  alerts: Alert[];
  count: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchAlerts(): Promise<AlertsResponse> {
  const res = await fetch(`${BASE}/api/alerts`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json();
}

const TYPE_CONFIG = {
  critical: {
    Icon: XCircle,
    className: "text-destructive",
    badgeClass: "bg-destructive text-destructive-foreground",
    labelClass: "text-destructive",
  },
  warning: {
    Icon: AlertTriangle,
    className: "text-amber-500",
    badgeClass: "bg-amber-500 text-white",
    labelClass: "text-amber-600",
  },
  info: {
    Icon: Info,
    className: "text-blue-500",
    badgeClass: "bg-blue-500 text-white",
    labelClass: "text-blue-600",
  },
};

export function AlertsBell({ userRole }: { userRole?: string }) {
  const [open, setOpen] = useState(false);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canSeeAlerts =
    userRole === ROLES.AGENCY_ADMIN ||
    userRole === ROLES.SALES ||
    userRole === ROLES.AGENCY_MANAGER ||
    userRole === ROLES.SUPPORT ||
    userRole === ROLES.SUPER_ADMIN;

  const { data } = useQuery<AlertsResponse>({
    queryKey: ["alerts"],
    queryFn: fetchAlerts,
    refetchInterval: 5 * 60 * 1000,
    enabled: canSeeAlerts,
    staleTime: 60_000,
  });

  const resolveAlert = async (endpoint: string, key: string) => {
    setResolvingIds((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        toast({ title: "Erro ao resolver alerta", description: "Não foi possível marcar o alerta como resolvido. Tente novamente.", variant: "destructive" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    } catch {
      toast({ title: "Erro ao resolver alerta", description: "Falha de rede. Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleResolveExhausted = async (e: React.MouseEvent, reservationId: string) => {
    e.stopPropagation();
    await resolveAlert(
      `${BASE}/api/alerts/email-retry-exhausted/${encodeURIComponent(reservationId)}/resolve`,
      reservationId,
    );
  };

  const handleResolveReferralSkip = async (e: React.MouseEvent, reservationId: string) => {
    e.stopPropagation();
    await resolveAlert(
      `${BASE}/api/alerts/referral-reversal-skipped/${encodeURIComponent(reservationId)}/resolve`,
      reservationId,
    );
  };

  if (!canSeeAlerts) return null;

  const alerts = data?.alerts ?? [];
  const count = data?.count ?? 0;

  const criticalCount = alerts.filter(a => a.type === "critical").length;
  const badgeCount = count;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="Alertas Inteligentes">
          <Bell className="w-4 h-4" />
          {badgeCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 w-4 h-4 text-[10px] font-bold rounded-full flex items-center justify-center leading-none ${
                criticalCount > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-amber-500 text-white"
              }`}
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h4 className="text-sm font-semibold">Alertas Inteligentes</h4>
          {badgeCount > 0 && (
            <Badge
              className={`text-[10px] h-4 px-1.5 ${criticalCount > 0 ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"}`}
            >
              {badgeCount}
            </Badge>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto divide-y">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <CheckCircle className="w-8 h-8 opacity-30 text-green-500" />
              <p className="text-sm font-medium">Nenhum alerta no momento ✓</p>
              <p className="text-xs opacity-70">Tudo em ordem por aqui!</p>
            </div>
          ) : (
            alerts.map((alert) => {
              const cfg = TYPE_CONFIG[alert.type];
              const Icon = cfg.Icon;

              if (alert.id === "email-retry-exhausted") {
                const rids = alert.reservationIds ?? [];
                return (
                  <div key={alert.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.className}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{alert.title}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{alert.category}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{alert.description}</p>
                        <button
                          className="text-xs text-primary hover:underline mt-1.5"
                          onClick={() => { setOpen(false); navigate(alert.actionHref); }}
                        >
                          Ver log de e-mails →
                        </button>
                      </div>
                    </div>
                    {rids.length > 0 && (
                      <div className="mt-2 ml-7 flex flex-col gap-1">
                        {rids.map((rid) => (
                          <div key={rid} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground font-mono truncate">{rid}</span>
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
                              onClick={(e) => handleResolveExhausted(e, rid)}
                              disabled={resolvingIds.has(rid)}
                            >
                              {resolvingIds.has(rid) ? "Resolvendo…" : "Marcar como resolvido"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              if (alert.id === "referral-reversal-skipped") {
                const skips = alert.referralSkips ?? [];
                return (
                  <div key={alert.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.className}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{alert.title}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{alert.category}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                          Bônus de indicação pode ter ficado creditado indevidamente. Verifique e corrija manualmente.
                        </p>
                        {skips.length > 0 && (
                          <div className="mt-1.5 flex flex-col gap-1">
                            {skips.map((s) => {
                              const resRef = s.reservationNumber ?? s.reservationId;
                              const referrer = s.referrerName ?? "indicador desconhecido";
                              return (
                                <div key={s.reservationId} className="flex items-start justify-between gap-2">
                                  <p className="text-xs text-muted-foreground leading-snug min-w-0">
                                    <span className="font-mono">#{resRef}</span> — cód.{" "}
                                    <span className="font-mono">{s.referralCode}</span> · {referrer}
                                  </p>
                                  <button
                                    className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
                                    onClick={(e) => handleResolveReferralSkip(e, s.reservationId)}
                                    disabled={resolvingIds.has(s.reservationId)}
                                  >
                                    {resolvingIds.has(s.reservationId) ? "Resolvendo…" : "Marcar como resolvido"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <button
                          className="text-xs text-primary hover:underline mt-1.5"
                          onClick={() => { setOpen(false); navigate(alert.actionHref); }}
                        >
                          Ver indicações →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={alert.id}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => {
                    setOpen(false);
                    navigate(alert.actionHref);
                  }}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.className}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{alert.title}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{alert.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug mt-0.5">{alert.description}</p>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${cfg.labelClass}`}>Ver →</span>
                </button>
              );
            })
          )}
        </div>

        {alerts.length > 0 && (
          <div className="px-4 py-2 border-t bg-muted/30">
            <p className="text-[11px] text-muted-foreground text-center">
              Atualizado automaticamente a cada 5 minutos
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
