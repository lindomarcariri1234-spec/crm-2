import { ROLES } from "@workspace/permissions";

export interface RoleRedirectUser {
  role: string;
  tenantId?: string | null;
}

export function getRoleRedirectPath(user: RoleRedirectUser): string {
  if (user.role === ROLES.SUPER_ADMIN) return "/admin";
  if (user.role === ROLES.CLIENT) return "/perfil";
  if (!user.tenantId) return "/onboarding";
  if (user.role === ROLES.SALES) return "/meu-painel";
  if (
    user.role === ROLES.AGENCY_ADMIN ||
    user.role === ROLES.AGENCY_MANAGER ||
    user.role === ROLES.SUPPORT
  ) {
    return "/dashboard";
  }
  return "/dashboard";
}