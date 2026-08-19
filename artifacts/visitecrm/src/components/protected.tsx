import type { ReactNode } from "react";
import { usePermissions, type Resource, type Action } from "@/hooks/use-permissions";
import { ShieldX } from "lucide-react";

interface ProtectedProps {
  resource: Resource;
  action: Action;
  children: ReactNode;
  fallback?: ReactNode;
}

function DefaultDenied() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <ShieldX className="h-10 w-10 opacity-40" />
      <p className="text-sm font-medium">Acesso Negado</p>
      <p className="text-xs">Você não tem permissão para acessar este recurso.</p>
    </div>
  );
}

export function Protected({ resource, action, children, fallback }: ProtectedProps) {
  const { can, isLoading } = usePermissions();

  if (isLoading) return null;

  if (!can(resource, action)) {
    return <>{fallback ?? <DefaultDenied />}</>;
  }

  return <>{children}</>;
}
