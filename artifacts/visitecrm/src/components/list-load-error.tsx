import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

type ListLoadErrorProps = {
  onRetry: () => void | Promise<unknown>;
  message?: string;
  className?: string;
};

export function ListLoadError({
  onRetry,
  message = "Não foi possível carregar os dados.",
  className = "",
}: ListLoadErrorProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-10 text-center ${className}`}>
      <AlertCircle className="h-8 w-8 text-destructive/80" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={() => void onRetry()}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Tentar novamente
      </Button>
    </div>
  );
}

export function ListLoadErrorRow({
  colSpan,
  onRetry,
  message,
}: ListLoadErrorProps & { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <ListLoadError onRetry={onRetry} message={message} />
      </TableCell>
    </TableRow>
  );
}