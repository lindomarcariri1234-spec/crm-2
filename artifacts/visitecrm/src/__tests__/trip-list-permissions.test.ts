import { describe, expect, it } from "vitest";
import { ROLES } from "@workspace/permissions";
import { getTripListActionPermissions } from "../lib/trip-list-permissions";

describe("getTripListActionPermissions", () => {
  it.each([ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN])(
    "allows all trip-list operations for %s",
    (role) => {
      expect(getTripListActionPermissions(role)).toEqual({
        canCreateTrip: true,
        canEditTrip: true,
        canDeleteTrip: true,
        canManageTrip: true,
        canImportTrips: true,
        canExportTrips: true,
        canPublishToStore: true,
      });
    },
  );

  it("keeps manager permissions aligned with the API", () => {
    expect(getTripListActionPermissions(ROLES.AGENCY_MANAGER)).toEqual({
      canCreateTrip: true,
      canEditTrip: true,
      canDeleteTrip: false,
      canManageTrip: true,
      canImportTrips: false,
      canExportTrips: true,
      canPublishToStore: false,
    });
  });

  it.each([ROLES.SALES, ROLES.SUPPORT])(
    "hides management operations for read-only role %s",
    (role) => {
      expect(getTripListActionPermissions(role)).toEqual({
        canCreateTrip: false,
        canEditTrip: false,
        canDeleteTrip: false,
        canManageTrip: false,
        canImportTrips: false,
        canExportTrips: false,
        canPublishToStore: false,
      });
    },
  );

  it("hides operations until a role is known", () => {
    expect(getTripListActionPermissions()).toEqual({
      canCreateTrip: false,
      canEditTrip: false,
      canDeleteTrip: false,
      canManageTrip: false,
      canImportTrips: false,
      canExportTrips: false,
      canPublishToStore: false,
    });
  });
});