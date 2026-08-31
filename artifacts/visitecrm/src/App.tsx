import { useEffect, useRef, useState, lazy, Suspense, Component, type ComponentType, type ReactNode } from "react";
import { ClerkProvider, Show, useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { ptBR } from "@clerk/localizations";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSyncMe, useGetMe } from "@workspace/api-client-react";
import { useApiTimeout } from "@/hooks/useApiTimeout";
import { ApiTimeoutFallback } from "@/components/api-timeout-fallback";
import { AccessBlockedWall, extractBlockedCode, extractBlockedScope, type BlockedAccessScope } from "@/components/access-blocked-wall";
import { getRoleRedirectPath } from "@/lib/role-redirect";

import Layout from "@/components/layout";
import AdminLayout from "@/components/admin-layout";
import PortalLayout from "@/pages/perfil/layout";
import PerfilPage from "@/pages/perfil/index";
import Landing from "@/pages/landing";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import OnboardingPage from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Pipeline from "@/pages/pipeline";
import Clients from "@/pages/clients";
import Trips from "@/pages/trips";
import Reservations from "@/pages/reservations";
import Financial from "@/pages/financial";
import Communication from "@/pages/communication";
import Campaigns from "@/pages/campaigns";
import Automations from "@/pages/automations";
import Marketing from "@/pages/marketing";
import Loyalty from "@/pages/loyalty";
import Nps from "@/pages/nps";
import Registrations from "@/pages/registrations";
import Analytics from "@/pages/analytics";
import Insights from "@/pages/insights";
import GemeoDigital from "@/pages/gemeo";
import Commissions from "@/pages/commissions";
import Expenses from "@/pages/expenses";
import Revenue from "@/pages/revenue";
const HistoricoComparativo = lazy(() => import("@/pages/historico-comparativo"));

// Task 6 pages
import Fornecedores from "@/pages/cadastros/fornecedores";
import Veiculos from "@/pages/cadastros/veiculos";
import Layouts from "@/pages/cadastros/layouts";
import Hospedagens from "@/pages/cadastros/hospedagens";
import Destinos from "@/pages/cadastros/destinos";
import Produtos from "@/pages/cadastros/produtos";
import LocaisEmbarque from "@/pages/cadastros/locais-embarque";
import Vendedores from "@/pages/vendedores";
import MeuPainel from "@/pages/meu-painel";
import Vouchers from "@/pages/vouchers";
import Indicacoes from "@/pages/indicacoes";
import Embaixadores from "@/pages/embaixadores";
import Configuracoes from "@/pages/configuracoes";
import Downloads from "@/pages/downloads";
import AdminDashboard from "@/pages/admin/index";
import AdminTenants from "@/pages/admin/tenants";
import AdminTenantDetail from "@/pages/admin/tenant-detail";
import AdminPlans from "@/pages/admin/plans";
import AdminBilling from "@/pages/admin/billing";
import AdminMetrics from "@/pages/admin/metrics";
import AdminUsers from "@/pages/admin/users";
import AdminLogs from "@/pages/admin/logs";
import AdminSettings from "@/pages/admin/admin-settings";
import AdminMaintenance from "@/pages/admin/maintenance";
import AdminSystemHealth from "@/pages/admin/system-health";

// Store admin pages
import LojaConfiguracoes from "@/pages/loja/configuracoes";
import LojaProdutos from "@/pages/loja/produtos";
import LojaCategorias from "@/pages/loja/categorias";
import LojaPedidos from "@/pages/loja/pedidos";
import LojaCupons from "@/pages/loja/cupons";
import LojaAvaliacoes from "@/pages/loja/avaliacoes";
import LojaParceiros from "@/pages/loja/parceiros";

// Public vitrine
import Vitrine from "@/pages/vitrine";

// Partner portal (public — JWT auth inside)
import ParceirosPortal from "@/pages/parceiros/index";
import { ROLES, ADMIN_ROLES } from "@workspace/permissions";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-destructive">Algo deu errado</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Ocorreu um erro inesperado. Recarregue a página para tentar novamente.
          </p>
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function normalizeClerkPublishableKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (
    trimmed.length >= 2 &&
    (quote === "\"" || quote === "'") &&
    trimmed.at(-1) === quote
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const clerkPubKey = normalizeClerkPublishableKey(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkPubKeyIsValid = /^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(clerkPubKey);
// Clerk proxy: only used when explicitly overridden via VITE_CLERK_PROXY_URL.
// Auto-deriving a proxy URL for the Replit dev preview does NOT work — Clerk
// requires every proxyUrl to be registered in the Clerk Dashboard, and the
// Replit preview domain changes per session so it can never be registered.
// Clerk v6 handles cross-site iframe auth via localStorage fallback without a proxy.
// Empty in dev (Clerk hits dev FAPI directly), auto-set by Replit in prod.
// If VITE_CLERK_PROXY_URL contains comma-separated entries (one per custom domain),
// pick the one whose origin matches the current window location. Returns undefined (no proxy)
// if none match — this ensures Clerk works on Replit preview/deploy URLs without erroring.
const clerkProxyUrl = (() => {
  const raw: string = import.meta.env.VITE_CLERK_PROXY_URL ?? "";
  if (!raw) return undefined;
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const match = entries.find((u) => u.startsWith(currentOrigin));
  return match ?? undefined;
})();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);
  return null;
}

function RoleRedirect() {
  const syncMe = useSyncMe();
  const { data: me, isLoading, refetch, error: meError } = useGetMe();
  const { user } = useUser();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [synced, setSynced] = useState(false);
  const [authError, setAuthError] = useState<{ status?: number; fromSync?: boolean } | null>(null);
  const [blocked, setBlocked] = useState<{ code: string; scope: BlockedAccessScope } | null>(null);
  const syncStartedRef = useRef(false);

  const { timedOut, retryKey, reset } = useApiTimeout();

  useEffect(() => {
    if (!user || syncStartedRef.current) return;
    syncStartedRef.current = true;
    syncMe.mutate(
      {
        data: {
          clerkId: user.id,
          name: user.fullName ?? user.firstName ?? "Usuário",
          email: user.primaryEmailAddress?.emailAddress ?? "",
          avatarUrl: user.imageUrl ?? undefined,
        },
      },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: ["/api/users/me"] });
          refetch().then(() => setSynced(true));
        },
        onError: (err: unknown) => {
          // If syncMe itself was blocked (trial expired, suspended, etc.) show the wall
          const code = extractBlockedCode(err);
          if (code) { setBlocked({ code, scope: extractBlockedScope(err) }); setSynced(true); return; }
          const status = (err as { response?: { status?: number } })?.response?.status
            ?? (err as { status?: number })?.status;
          setAuthError({ status, fromSync: true });
          setSynced(true);
        },
      }
    );
  }, [user?.id, retryKey]);

  useEffect(() => {
    if (timedOut && !synced) return;
    if (!synced || isLoading) return;
    if (!me) {
      // Check if the failure is a tenant access block (trial expired, suspended, etc.)
      // before falling back to the generic "account not found" error.
      const code = extractBlockedCode(meError);
      if (code) { setBlocked({ code, scope: extractBlockedScope(meError) }); return; }
      // Redirecting to /sign-in here causes an infinite loop: Clerk detects the
      // active session and bounces the user straight back to /, which re-mounts
      // RoleRedirect, which calls syncMe again, and so on.
      // Show an auth-error state instead so the user can sign out cleanly.
      // A failed synchronization can be followed by a failed profile lookup.
      // Preserve the original error so the UI does not incorrectly tell an
      // authenticated user that their account is simply missing.
      setAuthError((current) => current ?? { fromSync: false });
      return;
    }

    setLocation(getRoleRedirectPath(me));
  }, [synced, me, isLoading, timedOut]);

  function handleRetry() {
    syncStartedRef.current = false;
    setSynced(false);
    setAuthError(null);
    reset();
  }

  if (timedOut && !synced) {
    return <ApiTimeoutFallback onRetry={handleRetry} />;
  }

  if (blocked) {
    return (
      <AccessBlockedWall
        code={blocked.code}
        scope={blocked.scope}
        onSignOut={() => void signOut({ redirectUrl: `${basePath}/sign-in` })}
      />
    );
  }

  if (authError !== null) {
    const statusCode = authError.status;
    const isUnauthorized = statusCode === 401;
    const isServerError = statusCode !== undefined && statusCode >= 500;
    const hint = isUnauthorized
      ? "Sua sessão expirou ou o token não foi aceito pelo servidor."
      : isServerError
        ? `O servidor retornou um erro ${statusCode}. Aguarde alguns instantes e tente novamente.`
        : statusCode === 403
          ? "O acesso à agência foi recusado. Verifique a situação da assinatura ou fale com o responsável pela conta."
        : authError.fromSync
          ? "Não foi possível sincronizar sua conta. Isso pode ser um problema temporário."
          : "Conta autenticada, mas não encontrada no sistema. Tente sair e entrar novamente.";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <p className="font-semibold text-foreground">Erro ao verificar conta</p>
          {statusCode && (
            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
              HTTP {statusCode}
            </span>
          )}
          <p className="text-sm text-muted-foreground max-w-xs mt-1">{hint}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void signOut({ redirectUrl: `${basePath}/sign-in` })}>
            Sair
          </Button>
          <Button onClick={handleRetry}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-pulse text-muted-foreground text-sm">Carregando...</div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <RoleRedirect />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

const AGENCY_ROLES = [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SUPER_ADMIN] as const;
// Finance pages expose tenant-wide financial data; restricted to roles with FINANCIAL view in the permission matrix (excludes SUPPORT).
const FINANCE_ROLES = [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN] as const;
const SUPERADMIN_ONLY = [ROLES.SUPER_ADMIN] as const;
const VENDEDOR_ONLY = [ROLES.SALES] as const;
const CLIENTE_ONLY = [ROLES.CLIENT] as const;

interface RoleGateProps {
  component: ComponentType;
  /**
   * Roles allowed to render this route.
   * - Pass `"*"` for any authenticated staff member. NOTE: even with `"*"`,
   *   `cliente` users are always redirected to `/perfil` and tenantless users to
   *   `/onboarding` — `"*"` means "any non-client authenticated user", matching
   *   the former `ProtectedRoute` behaviour.
   * - To allow only specific roles, pass an array e.g. `["agencia", "gerente"]`.
   * - Admin routes should use `["superadmin"]`; client portal uses `["cliente"]`.
   */
  allowedRoles: readonly string[] | "*";
  layout: ComponentType<{ children: ReactNode }>;
  signedOutPath?: string;
  fallbackPath?: string;
  /** Override redirect for `vendedor` when not in `allowedRoles` (used where
   *  the old AgenciaRoute redirected vendedor to /trips instead of fallbackPath). */
  vendedorFallback?: string;
  /** Set false to skip the tenantId guard (superadmin, vendedor, cliente). */
  requireTenant?: boolean;
}

function RoleGate({
  component: Component,
  allowedRoles,
  layout: LayoutComponent,
  signedOutPath = "/",
  fallbackPath = "/dashboard",
  vendedorFallback,
  requireTenant = true,
}: RoleGateProps) {
  const { signOut } = useClerk();
  const { data: me, isLoading, refetch, error: meError } = useGetMe();
  const role = me?.role;
  const clientNotAllowed =
    allowedRoles === "*" || !(allowedRoles as readonly string[]).includes(ROLES.CLIENT);

  const { timedOut, reset } = useApiTimeout({ enabled: isLoading });

  function handleRetry() {
    reset();
    refetch();
  }

  if (timedOut && isLoading) {
    return (
      <>
        <Show when="signed-out">
          <Redirect to={signedOutPath} />
        </Show>
        <Show when="signed-in">
          <ApiTimeoutFallback onRetry={handleRetry} />
        </Show>
      </>
    );
  }

  let content: ReactNode = null;
  if (!isLoading && !me) {
    // If the failure is a tenant access block, show a clear wall instead of
    // silently redirecting to onboarding (which would confuse the user).
    const blocked = extractBlockedCode(meError);
    if (blocked) {
      content = (
        <AccessBlockedWall
          code={blocked}
          onSignOut={() => void signOut()}
        />
      );
    } else {
      content = <Redirect to="/onboarding" />;
    }
  } else if (!isLoading && me) {
    if (clientNotAllowed && role === ROLES.CLIENT) {
      content = <Redirect to="/perfil" />;
    } else if (clientNotAllowed && requireTenant && !me.tenantId && role !== ROLES.SUPER_ADMIN) {
      content = <Redirect to="/onboarding" />;
    } else if (allowedRoles !== "*" && !(allowedRoles as readonly string[]).includes(role ?? "")) {
      content =
        role === ROLES.SALES && vendedorFallback !== undefined ? (
          <Redirect to={vendedorFallback} />
        ) : (
          <Redirect to={fallbackPath} />
        );
    } else {
      content = (
        <LayoutComponent>
          <Component />
        </LayoutComponent>
      );
    }
  }

  return (
    <>
      <Show when="signed-out">
        <Redirect to={signedOutPath} />
      </Show>
      <Show when="signed-in">{content}</Show>
    </>
  );
}

function OnboardingRoute() {
  const syncMe = useSyncMe();
  const { data: me, isLoading, refetch } = useGetMe();
  const { user } = useUser();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  // syncDone gates the form only for new users (me === null after loading).
  // Already-synced users (me !== null) skip this gate entirely.
  const [syncDone, setSyncDone] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);
  const syncStartedRef = useRef(false);

  // 10-second watchdog. Only begins counting once syncMe.mutate() is called.
  const { timedOut, retryKey, reset } = useApiTimeout({ enabled: syncStarted && !syncDone });

  useEffect(() => {
    // Already in DB — release the gate immediately, no sync needed.
    if (!isLoading && me) {
      setSyncDone(true);
      return;
    }
    // Still loading or no Clerk user yet — wait.
    if (isLoading || !user) return;
    // me is null and loading is done → new user, needs sync. Run once per retryKey.
    if (syncStartedRef.current) return;
    syncStartedRef.current = true;

    // Signal that the API call is now in-flight — starts the watchdog.
    setSyncStarted(true);

    syncMe.mutate(
      {
        data: {
          clerkId: user.id,
          name: user.fullName ?? user.firstName ?? "Usuário",
          email: user.primaryEmailAddress?.emailAddress ?? "",
          avatarUrl: user.imageUrl ?? undefined,
        },
      },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: ["/api/users/me"] });
          refetch().then(() => setSyncDone(true));
        },
        onError: () => setSyncDone(true),
      }
    );
  }, [user?.id, isLoading, !!me, retryKey]);

  useEffect(() => {
    if (!syncDone || isLoading || !me) return;
    if (me.tenantId) {
      if (me.role === ROLES.SUPER_ADMIN) {
        setLocation("/admin");
      } else if (me.role === ROLES.SALES) {
        setLocation("/meu-painel");
      } else if (me.role === ROLES.CLIENT) {
        setLocation("/perfil");
      } else {
        setLocation("/dashboard");
      }
    }
  }, [syncDone, me, isLoading]);

  function handleRetry() {
    syncStartedRef.current = false;
    setSyncDone(false);
    setSyncStarted(false);
    reset();
  }

  // Show form as soon as we're ready; ready takes precedence over timedOut.
  const ready = syncDone && !isLoading;

  return (
    <>
      <Show when="signed-in">
        {ready ? (
          <OnboardingPage />
        ) : timedOut ? (
          <ApiTimeoutFallback onRetry={handleRetry} />
        ) : (
          <div className="flex min-h-screen items-center justify-center">
            <div className="animate-pulse text-muted-foreground text-sm">Carregando...</div>
          </div>
        )}
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/onboarding" component={OnboardingRoute} />

      {/* Staff routes — any authenticated non-client with a tenant */}
      <Route path="/dashboard" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Dashboard} />} />
      <Route path="/pipeline" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Pipeline} />} />
      <Route path="/clients" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Clients} />} />
      <Route path="/clients/:id" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Clients} />} />
      <Route path="/trips" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/new" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} vendedorFallback="/trips" component={Trips} />} />
      <Route path="/trips/calendar" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/media" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} vendedorFallback="/trips" component={Trips} />} />
      <Route path="/trips/:id/edit" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} vendedorFallback="/trips" component={Trips} />} />
      <Route path="/trips/:id/seat-map" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id/passengers-overview" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id/passengers" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id/checkin-panel" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id/checkin" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id/boarding-control" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/trips/:id" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Trips} />} />
      <Route path="/reservations" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Reservations} />} />
      <Route path="/reservations/:id" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Reservations} />} />

      {/* Agency-only routes — vendedor redirected to /meu-painel */}
      <Route path="/financial" component={() => <Redirect to="/financeiro" />} />
      <Route path="/financeiro" component={() => <RoleGate allowedRoles={FINANCE_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Financial} />} />
      <Route path="/financeiro/commissions" component={() => <RoleGate allowedRoles={FINANCE_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Commissions} />} />
      <Route path="/financeiro/expenses" component={() => <RoleGate allowedRoles={FINANCE_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Expenses} />} />
      <Route path="/comunicacao" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Communication} />} />
      <Route path="/communication" component={() => <Redirect to="/comunicacao" />} />
      <Route path="/comunicacao/campanhas" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Campaigns} />} />
      <Route path="/automacoes" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Automations} />} />
      <Route path="/automations" component={() => <Redirect to="/automacoes" />} />
      <Route path="/marketing" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Marketing} />} />
      <Route path="/fidelidade" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Loyalty} />} />
      <Route path="/nps" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Nps} />} />

      {/* Registrations hub + sub-pages */}
      <Route path="/registrations" component={() => <Redirect to="/cadastros" />} />
      <Route path="/cadastros" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Registrations} />} />
      <Route path="/cadastros/fornecedores" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Fornecedores} />} />
      <Route path="/cadastros/veiculos" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Veiculos} />} />
      <Route path="/cadastros/hospedagens" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Hospedagens} />} />
      <Route path="/cadastros/destinos" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Destinos} />} />
      <Route path="/cadastros/produtos" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Produtos} />} />
      <Route path="/cadastros/layouts" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Layouts} />} />
      <Route path="/cadastros/locais-embarque" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LocaisEmbarque} />} />

      {/* Analytics */}
      <Route path="/analytics" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Analytics} />} />
      <Route path="/analytics/revenue" component={() => <RoleGate allowedRoles={FINANCE_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Revenue} />} />
      <Route path="/analytics/historico-comparativo" component={() => <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando...</div>}><RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={HistoricoComparativo} /></Suspense>} />
      <Route path="/analytics/vendedores" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Vendedores} />} />
      <Route path="/insights" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Insights} />} />
      <Route path="/gemeo" component={() => <RoleGate allowedRoles={ADMIN_ROLES} layout={Layout} fallbackPath="/dashboard" component={GemeoDigital} />} />

      {/* Task 6 pages */}
      <Route path="/vouchers" component={() => <RoleGate allowedRoles="*" layout={Layout} component={Vouchers} />} />
      <Route path="/indicacoes" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Indicacoes} />} />
      <Route path="/embaixadores" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Embaixadores} />} />
      <Route path="/configuracoes" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Configuracoes} />} />
      <Route path="/downloads" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={Downloads} />} />

      {/* Seller dashboard */}
      <Route path="/meu-painel" component={() => <RoleGate allowedRoles={VENDEDOR_ONLY} layout={Layout} fallbackPath="/dashboard" requireTenant={false} component={MeuPainel} />} />

      {/* Legacy redirects */}
      <Route path="/settings" component={() => <Redirect to="/configuracoes" />} />
      <Route path="/billing" component={() => <Redirect to="/configuracoes?tab=plan" />} />
      <Route path="/settings/billing" component={() => <Redirect to="/configuracoes?tab=plan" />} />

      {/* Super Admin */}
      <Route path="/admin" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminDashboard} />} />
      <Route path="/admin/tenants" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminTenants} />} />
      <Route path="/admin/tenants/:id" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminTenantDetail} />} />
      <Route path="/admin/plans" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminPlans} />} />
      <Route path="/admin/billing" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminBilling} />} />
      <Route path="/admin/metrics" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminMetrics} />} />
      <Route path="/admin/users" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminUsers} />} />
      <Route path="/admin/logs" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminLogs} />} />
      <Route path="/admin/settings" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminSettings} />} />
      <Route path="/admin/maintenance" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminMaintenance} />} />
      <Route path="/admin/system-health" component={() => <RoleGate allowedRoles={SUPERADMIN_ONLY} layout={AdminLayout} fallbackPath="/dashboard" requireTenant={false} component={AdminSystemHealth} />} />

      {/* Store admin pages */}
      <Route path="/loja" component={() => <Redirect to="/loja/configuracoes" />} />
      <Route path="/loja/configuracoes" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaConfiguracoes} />} />
      <Route path="/loja/produtos" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaProdutos} />} />
      <Route path="/loja/categorias" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaCategorias} />} />
      <Route path="/loja/pedidos" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaPedidos} />} />
      <Route path="/loja/cupons" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaCupons} />} />
      <Route path="/loja/avaliacoes" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaAvaliacoes} />} />
      <Route path="/loja/parceiros" component={() => <RoleGate allowedRoles={AGENCY_ROLES} layout={Layout} fallbackPath="/meu-painel" component={LojaParceiros} />} />

      {/* Client portal */}
      <Route path="/perfil" component={() => <RoleGate allowedRoles={CLIENTE_ONLY} layout={PortalLayout} signedOutPath="/sign-in?redirect_url=%2Fperfil" fallbackPath="/dashboard" requireTenant={false} component={PerfilPage} />} />

      {/* Partner portal — public, JWT auth inside */}
      <Route path="/parceiros" component={ParceirosPortal} />
      <Route path="/parceiros/*" component={ParceirosPortal} />

      {/* Public vitrine — must be after admin routes */}
      <Route path="/loja/:slug" component={Vitrine} />
      <Route path="/loja/:slug/*" component={Vitrine} />

      <Route
        component={() => <RoleGate allowedRoles="*" layout={Layout} component={() => <Redirect to="/dashboard" />} />}
      />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  if (!clerkPubKeyIsValid) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
          <h1 className="mb-2 text-lg font-semibold">Configuração de autenticação inválida</h1>
          <p className="text-sm">
            A variável VITE_CLERK_PUBLISHABLE_KEY precisa conter uma chave pública
            válida do Clerk.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      localization={ptBR}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/`}
      signUpFallbackRedirectUrl={`${basePath}/`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Router />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <WouterRouter base={basePath}>
        <TooltipProvider>
          <ClerkProviderWithRoutes />
          <Toaster />
        </TooltipProvider>
      </WouterRouter>
    </AppErrorBoundary>
  );
}

export default App;
