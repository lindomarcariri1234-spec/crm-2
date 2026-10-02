import { AlertTriangle, Mail, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface FailedEmailSummary {
  reservationId: string;
  reservationNumber: string | number | null;
  clientName: string;
  clientEmail: string | null;
  exhaustedAt: string;
  emailLogId: string | null;
}

export function FailedEmailsTab({
  failedSummary,
  loading,
  error,
  resendingId,
  onRefresh,
  onResend,
}: {
  failedSummary: FailedEmailSummary[];
  loading: boolean;
  error: string | null;
  resendingId: string | null;
  onRefresh: () => unknown;
  onResend: (emailLogId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Reservas cujos e-mails de confirmação esgotaram todas as tentativas automáticas e ainda não foram reenviados com sucesso.
        </p>
        <Button
          data-testid="button-refresh-failed-emails"
          variant="outline"
          size="sm"
          onClick={() => { void onRefresh(); }}
          disabled={loading}
        >
          <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <div className="text-center py-16 text-muted-foreground" role="alert">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <p className="font-medium text-red-700">{error}</p>
          <Button data-testid="button-retry-failed-emails" className="mt-3" variant="outline" size="sm" onClick={() => { void onRefresh(); }}>
            Tentar novamente
          </Button>
        </div>
      ) : failedSummary.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">Nenhum e-mail com falha pendente.</p>
          <p className="text-xs mt-1">Todos os e-mails de confirmação foram entregues com sucesso.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">
              {failedSummary.length} reserva(s) com e-mail de confirmação não entregue. Use o botão “Reenviar” para tentar novamente.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reserva</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>E-mail do cliente</TableHead>
                <TableHead>Esgotado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedSummary.map((item) => (
                <TableRow key={item.reservationId}>
                  <TableCell className="font-mono text-sm font-medium">
                    #{item.reservationNumber ?? item.reservationId.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-sm">{item.clientName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.clientEmail ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(item.exhaustedAt).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.emailLogId ? (
                      <Button
                        data-testid={`button-resend-failed-email-${item.emailLogId}`}
                        size="sm"
                        variant="destructive"
                        onClick={() => onResend(item.emailLogId!)}
                        disabled={resendingId === item.emailLogId}
                      >
                        <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${resendingId === item.emailLogId ? "animate-spin" : ""}`} />
                        Reenviar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem log disponível</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </>
  );
}