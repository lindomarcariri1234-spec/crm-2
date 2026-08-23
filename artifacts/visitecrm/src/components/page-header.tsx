import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}

/**
 * Shared page heading for authenticated CRM screens.
 *
 * Actions wrap below the title on narrow screens instead of competing with it
 * for horizontal space. The optional back link is intended for deep routes.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  backHref,
  backLabel = "Voltar",
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref}>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {backLabel}
            </Button>
          </Link>
        )}
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}