export function makeMe(role = "admin"): { data: { tenantId: string; role: string } } {
  return { data: { tenantId: "tenant-1", role } };
}

export function makeTenantData(seatMapEnabled: boolean | undefined): {
  data: {
    id: string;
    name: string;
    slug: string;
    email: string;
    planId: string;
    status: string;
    createdAt: string;
    settings: Record<string, unknown>;
  };
} {
  const settings: Record<string, unknown> =
    seatMapEnabled === undefined ? {} : { seatMapEnabled };
  return {
    data: {
      id: "tenant-1",
      name: "Agência",
      slug: "agencia",
      email: "a@b.com",
      planId: "plan-1",
      status: "active",
      createdAt: "2024-01-01",
      settings,
    },
  };
}
