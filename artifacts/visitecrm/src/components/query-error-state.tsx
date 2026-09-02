import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueryErrorStateProps {
  resourceLabel: string;
  error?: unknown;
  onRetry: () => void;
  compact?: boolean;
}

export function QueryErrorState({ resourceLabel, error, onRetry, compact = false }: QueryErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "py-8" : "py-16"}`}>
      <AlertCircle className="w-9 h-9 text-destructive opacity-60" />
      <p className="font-medium text-destructive">Não foi possível carregar {resourceLabel}</p>
      <p className="text-sm text-muted-foreground max-w-md">
        {error instanceof Error ? error.message : "Ocorreu um erro ao buscar os dados. Tente novamente."}
      </p>
      <Button variant="outline" className="mt-2" onClick={onRetry}>Tentar novamente</Button>
    </div>
  );
}