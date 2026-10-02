import type { ComponentType, ReactNode } from "react";
import { Show, useClerk } from "@clerk/react";
import { Redirect } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { useApiTimeout } from "@/hooks/useApiTimeout";
import { ApiTimeoutFallback } from "@/components/api-timeout-fallback";
import { AccessBlockedWall, extractBlockedCode } from "@/components/access-blocked-wall";
import { ROLES } from "@workspace/permissions";

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
  /** Override redirect for `vendedor` when not in `allowedRoles`. */
  vendedorFallback?: string;
  /** Set false to skip the tenantId guard (superadmin, vendedor, cliente). */
  requireTenant?: boolean;
}

export function RoleGate({
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