import {
  ACTIONS,
  ADMIN_ROLES,
  MANAGEMENT_ROLES,
  RESOURCES,
  hasPermission,
} from "@workspace/permissions";

export function getTripListActionPermissions(role?: string | null) {
  const hasRole = Boolean(role);
  const canTripAction = (action: Parameters<typeof hasPermission>[2]) =>
    hasRole && role ? hasPermission(role, RESOURCES.TRIPS, action) : false;
  const isAdmin = Boolean(role && ADMIN_ROLES.includes(role));

  return {
    canCreateTrip: canTripAction(ACTIONS.CREATE),
    canEditTrip: canTripAction(ACTIONS.EDIT),
    canDeleteTrip: canTripAction(ACTIONS.DELETE),
    canManageTrip: canTripAction(ACTIONS.MANAGE),
    canImportTrips: isAdmin,
    canExportTrips: Boolean(role && MANAGEMENT_ROLES.includes(role)),
    canPublishToStore: isAdmin,
  };
}