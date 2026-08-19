import { useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { ShieldOff, Clock, CreditCard, Ban } from "lucide-react";

type BlockedCode =
  | "TRIAL_EXPIRED"
  | "TENANT_SUSPENDED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_PAYMENT_REQUIRED";

const CODE_CONFIG: Record<BlockedCode, { icon: typeof Clock; title: string; description: string }> = {
  TRIAL_EXPIRED: {
    icon: Clock,
    title: "Período de teste encerrado",
    description:
      "Seu período de avaliação chegou ao fim. Todos os seus dados estão preservados. Entre em contato com o suporte para continuar usando o VisiteCRM.",
  },
  TENANT_SUSPENDED: {
    icon: ShieldOff,
    title: "Conta suspensa",
    description:
      "Esta conta foi suspensa. Entre em contato com o suporte para regularizar a situação e reativar o acesso.",
  },
  SUBSCRIPTION_CANCELLED: {
    icon: Ban,
    title: "Assinatura cancelada",
    description:
      "Sua assinatura foi cancelada. Entre em contato para reativar o acesso e recuperar seus dados.",
  },
  SUBSCRIPTION_PAYMENT_REQUIRED: {
    icon: CreditCard,
    title: "Pagamento pendente",
    description:
      "É necessário concluir o pagamento para continuar usando o VisiteCRM. Acesse a área de assinatura para regularizar.",
  },
};

const FALLBACK_CONFIG = {
  icon: ShieldOff,
  title: "Acesso bloqueado",
  description:
    "Sua conta não tem acesso no momento. Entre em contato com o suporte.",
};

interface Props {
  /** Error code returned by the API */
  code: string;
  /** Override sign-out handler (defaults to Clerk signOut) */
  onSignOut?: () => void;
}

export function AccessBlockedWall({ code, onSignOut }: Props) {
  const { signOut } = useClerk();
  const cfg = CODE_CONFIG[code as BlockedCode] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;

  const handleSignOut = onSignOut ?? (() => void signOut());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center bg-background">
      <div className="flex flex-col items-center gap-4 max-w-md">
        <div className="p-4 rounded-full bg-muted">
          <Icon className="w-10 h-10 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{cfg.title}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{cfg.description}</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Button
          variant="default"
          asChild
        >
          <a
            href="mailto:suporte@visitecrm.com?subject=Solicita%C3%A7%C3%A3o%20de%20acesso%20-%20VisiteCRM"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contatar suporte
          </a>
        </Button>
        <Button variant="outline" onClick={handleSignOut}>
          Sair da conta
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Seus dados estão seguros e preservados.
      </p>
    </div>
  );
}

/** Codes that indicate the tenant's access is blocked (not a missing user) */
export const BLOCKED_ACCESS_CODES = [
  "TRIAL_EXPIRED",
  "TENANT_SUSPENDED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_PAYMENT_REQUIRED",
] as const;

export type BlockedAccessCode = (typeof BLOCKED_ACCESS_CODES)[number];

/** Extract a blocked-access error code from any API error shape */
export function extractBlockedCode(err: unknown): BlockedAccessCode | null {
  if (!err) return null;
  // Axios-style: err.response.data.code
  const e = err as Record<string, unknown>;
  const code =
    ((e.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)?.code ??
    (e.data as Record<string, unknown> | undefined)?.code ??
    e.code;
  if (typeof code === "string" && (BLOCKED_ACCESS_CODES as readonly string[]).includes(code)) {
    return code as BlockedAccessCode;
  }
  return null;
}
