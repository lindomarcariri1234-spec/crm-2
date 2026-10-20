import { useState } from "react";
import { Link } from "wouter";
import {
  getListCampaignPermanentBounceRecipientsQueryKey,
  useListCampaignPermanentBounceRecipients,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const PAGE_SIZE = 50;

export function CampaignPermanentBounceSuppressionDialog({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const params = { page };
  const suppressionsQuery = useListCampaignPermanentBounceRecipients(
    campaignId,
    params,
    {
      query: {
        enabled: open,
        queryKey: getListCampaignPermanentBounceRecipientsQueryKey(campaignId, params),
      },
    },
  );
  const isLoading = suppressionsQuery.isLoading || suppressionsQuery.isFetching;
  const suppressions = suppressionsQuery.data?.permanentBounceSuppressions;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setPage(1);
    setOpen(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`button-view-permanent-bounce-suppressions-${campaignId}`}
        >
          <Users className="mr-2 h-4 w-4" aria-hidden="true" />
          Ver clientes com e-mail suprimido
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>E-mails suprimidos por bounce permanente</DialogTitle>
          <p className="text-sm text-muted-foreground">{campaignName}</p>
        </DialogHeader>

        {isLoading ? (
          <div
            className="space-y-3"
            aria-label="Carregando destinatários suprimidos"
            data-testid="status-bounce-suppressions-loading"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : suppressionsQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <p className="text-sm text-destructive" data-testid="status-bounce-suppressions-error">
              Não foi possível carregar os clientes desta campanha.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void suppressionsQuery.refetch()}
              data-testid="button-retry-bounce-suppressions"
            >
              Tentar novamente
            </Button>
          </div>
        ) : suppressions?.available === false ? (
          <p
            className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground"
            data-testid="status-bounce-suppressions-unavailable"
          >
            Esta campanha não envia e-mails.
          </p>
        ) : suppressions && suppressions.recipients.length === 0 ? (
          <div
            className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground"
            data-testid={page === 1 ? "status-bounce-suppressions-empty" : "status-bounce-suppressions-page-empty"}
          >
            <p>
              {page === 1
                ? "Nenhum e-mail foi suprimido por bounce permanente nesta campanha."
                : "Não há clientes nesta página. Volte à página anterior."}
            </p>
            {page === 1 && suppressions.count > 0 && (
              <p className="mt-1">Total registrado: {suppressions.count}.</p>
            )}
          </div>
        ) : suppressions?.available ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="text-bounce-suppression-count">
              {suppressions.count} {suppressions.count === 1 ? "cliente teve" : "clientes tiveram"} o e-mail suprimido.
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border/70">
              {suppressions.recipients.map((recipient) => (
                <li
                  key={recipient.clientId}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`row-bounce-suppression-recipient-${recipient.clientId}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium" data-testid={`text-suppressed-client-name-${recipient.clientId}`}>
                      {recipient.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground" data-testid={`text-suppressed-client-email-${recipient.clientId}`}>
                      {recipient.email ?? "E-mail indisponível"}
                    </p>
                  </div>
                  <Link
                    href={`/clients/${encodeURIComponent(recipient.clientId)}`}
                    className="inline-flex shrink-0 items-center gap-1 self-start rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-center"
                    data-testid={`link-suppressed-client-profile-${recipient.clientId}`}
                  >
                    Abrir cliente
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => current - 1)}
                data-testid="button-bounce-suppressions-previous"
              >
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-bounce-suppressions-page">
                Página {page} · até {PAGE_SIZE} por página
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!suppressions.hasMore || isLoading}
                onClick={() => setPage((current) => current + 1)}
                data-testid="button-bounce-suppressions-next"
              >
                Próxima
                {isLoading ? (
                  <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
