import { Button } from "@/components/ui/button";

interface ApiTimeoutFallbackProps {
  onRetry: () => void;
}

export function ApiTimeoutFallback({ onRetry }: ApiTimeoutFallbackProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-muted-foreground max-w-xs">
        Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.
      </p>
      <Button onClick={onRetry}>Tentar novamente</Button>
    </div>
  );
}
