import { useGetMe } from "@workspace/api-client-react";
import {
  ROLES,
  hasPermission,
  getRoleLabel,
  getRoleBadgeColor,
  type Resource,
  type Action,
} from "@workspace/permissions";

export type { Resource, Action };
export { ROLES };

export function usePermissions() {
  const { data: me, isLoading } = useGetMe({});
  const role = me?.role ?? "";

  function can(resource: Resource, action: Action): boolean {
    if (isLoading || !role) return false;
    return hasPermission(role, resource, action);
  }

  return {
    role,
    isLoading,
    can,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isAgencia: role === ROLES.AGENCY_ADMIN,
    isGerente: role === ROLES.AGENCY_MANAGER,
    isVendedor: role === ROLES.SALES,
    isSuporte: role === ROLES.SUPPORT,
    isCliente: role === ROLES.CLIENT,
    isAdmin: role === ROLES.SUPER_ADMIN || role === ROLES.AGENCY_ADMIN,
    isStaff: ([ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT] as string[]).includes(role),
    roleLabel: getRoleLabel(role),
    roleBadgeColor: getRoleBadgeColor(role),
    getRoleLabel,
    getRoleBadgeColor,
  };
}
