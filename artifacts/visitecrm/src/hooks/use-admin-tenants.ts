import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  planId: string;
  pendingPlanId: string | null;
  status: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export function useAdminTenants() {
  return useQuery<AdminTenant[]>({
    queryKey: ["admin", "tenants"],
    queryFn: () => adminFetch("/api/admin/tenants"),
  });
}

export function getAdminTenantsQueryKey() {
  return ["admin", "tenants"] as const;
}

export function useSyncSuperadmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/api/admin/sync-superadmin", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });
}
