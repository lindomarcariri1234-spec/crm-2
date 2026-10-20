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

export function CampaignPermanentBounceDialog({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const params = { page };
  const recipientsQuery = useListCampaignPermanentBounceRecipients(
    campaignId,
    params,
    {
      query: {
        enabled: open,
        queryKey: getListCampaignPermanentBounceRecipientsQueryKey(campaignId, params),
      },
    },
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setPage(1);
    setOpen(nextOpen);
  };
  const isLoading = recipientsQuery.isLoading || recipientsQuery.isFetching;
  const data = recipientsQuery.data;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`button-view-permanent-bounces-${campaignId}`}
        >
          <Users className="mr-2 h-4 w-4" aria-hidden="true" />
          Ver clientes com bounce permanente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Clientes com bounce permanente</DialogTitle>
          <p className="text-sm text-muted-foreground">{campaignName}</p>
        </DialogHeader>

        {isLoading ? (
          <div
            className="space-y-3"
            aria-label="Carregando destinatários"
            data-testid="status-permanent-bounces-loading"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : recipientsQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <p className="text-sm text-destructive" data-testid="status-permanent-bounces-error">
              Não foi possível carregar os clientes desta campanha.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void recipientsQuery.refetch()}
              data-testid="button-retry-permanent-bounces"
            >
              Tentar novamente
            </Button>
          </div>
        ) : data?.available === false ? (
          <p
            className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground"
            data-testid="status-permanent-bounces-unavailable"
          >
            Os dados de bounce não estão disponíveis para esta campanha.
          </p>
        ) : data?.available && data.recipients.length === 0 ? (
          <p
            className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground"
            data-testid={page === 1 ? "status-permanent-bounces-empty" : "status-permanent-bounces-page-empty"}
          >
            {page === 1
              ? "Nenhum bounce permanente registrado nesta campanha."
              : "Não há clientes nesta página. Volte à página anterior."}
          </p>
        ) : data?.available ? (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-lg border border-border/70">
              {data.recipients.map((recipient) => (
                <li
                  key={recipient.clientId}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`row-permanent-bounce-recipient-${recipient.clientId}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium" data-testid={`text-bounce-client-name-${recipient.clientId}`}>
                      {recipient.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground" data-testid={`text-bounce-client-email-${recipient.clientId}`}>
                      {recipient.email}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-bounce-date-${recipient.clientId}`}>
                      Bounce em{" "}
                      {new Date(recipient.bouncedAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "America/Sao_Paulo",
                      })}
                    </p>
                  </div>
                  <Link
                    href={`/clients/${encodeURIComponent(recipient.clientId)}`}
                    className="inline-flex shrink-0 items-center gap-1 self-start rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-center"
                    data-testid={`link-client-profile-${recipient.clientId}`}
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
                data-testid="button-permanent-bounces-previous"
              >
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-permanent-bounces-page">
                Página {page} · até {PAGE_SIZE} por página
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data.hasMore || isLoading}
                onClick={() => setPage((current) => current + 1)}
                data-testid="button-permanent-bounces-next"
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
