export const ROLES = {
  SUPER_ADMIN: "superadmin",
  AGENCY_ADMIN: "agencia",
  AGENCY_MANAGER: "gerente",
  SALES: "vendedor",
  SUPPORT: "suporte",
  CLIENT: "cliente",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const RESERVATION_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
  APPROVED: "approved",
  FAILED: "failed",
  REFUNDED: "refunded",
  CHARGED_BACK: "charged_back",
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_TYPE = {
  RECEIVABLE: "receivable",
  PAYABLE: "payable",
} as const;
export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

export const COMMISSION_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;
export type CommissionStatus = (typeof COMMISSION_STATUS)[keyof typeof COMMISSION_STATUS];

export const GOAL_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;
export type GoalStatus = (typeof GOAL_STATUS)[keyof typeof GOAL_STATUS];

export const DEAL_STATUS = {
  OPEN: "open",
  WON: "won",
  LOST: "lost",
} as const;
export type DealStatus = (typeof DEAL_STATUS)[keyof typeof DEAL_STATUS];

export const TRIP_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ACTIVE: "active",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
} as const;
export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];

export const REFERRAL_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  CONVERTED: "converted",
  EXPIRED: "expired",
  REVERSED: "reversed",
} as const;
export type ReferralStatus = (typeof REFERRAL_STATUS)[keyof typeof REFERRAL_STATUS];

export const STORE_ORDER_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  PROCESSING: "processing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;
export type StoreOrderStatus = (typeof STORE_ORDER_STATUS)[keyof typeof STORE_ORDER_STATUS];

export const STORE_PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  REFUNDED: "refunded",
  FAILED: "failed",
} as const;
export type StorePaymentStatus = (typeof STORE_PAYMENT_STATUS)[keyof typeof STORE_PAYMENT_STATUS];

export const EXPENSE_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
} as const;
export type ExpenseStatus = (typeof EXPENSE_STATUS)[keyof typeof EXPENSE_STATUS];

export const INVOICE_STATUS = {
  PENDING: "pending",
  PENDING_PAYMENT: "pending_payment",
  PROCESSING: "processing",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  FAILED: "failed",
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
export const INVOICE_STATUS_VALUES = Object.values(INVOICE_STATUS) as [InvoiceStatus, ...InvoiceStatus[]];

export const TENANT_STATUS = {
  TRIAL: "trial",
  ACTIVE: "active",
  PENDING_PAYMENT: "pending_payment",
  SUSPENDED: "suspended",
  CANCELLED: "cancelled",
} as const;
export type TenantStatus = (typeof TENANT_STATUS)[keyof typeof TENANT_STATUS];

export const SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  TRIAL: "trial",
  PENDING_PAYMENT: "pending_payment",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired",
} as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const RESOURCES = {
  TRIPS: "trips",
  RESERVATIONS: "reservations",
  CLIENTS: "clients",
  TEAM: "team",
  FINANCIAL: "financial",
  REPORTS: "reports",
  SETTINGS: "settings",
  CATALOG: "catalog",
  ALERTS: "alerts",
  COMMISSIONS: "commissions",
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

export const ACTIONS = {
  VIEW: "view",
  CREATE: "create",
  EDIT: "edit",
  DELETE: "delete",
  MANAGE: "manage",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

type PermissionMatrix = Partial<Record<Role, Partial<Record<Resource, Action[]>>>>;

export const PERMISSIONS_MATRIX: PermissionMatrix = {
  [ROLES.SUPER_ADMIN]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.CLIENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.TEAM]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.FINANCIAL]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.REPORTS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
    [RESOURCES.SETTINGS]: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.MANAGE],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.ALERTS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
    [RESOURCES.COMMISSIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  [ROLES.AGENCY_ADMIN]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.CLIENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.TEAM]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.FINANCIAL]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.REPORTS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
    [RESOURCES.SETTINGS]: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.MANAGE],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
    [RESOURCES.ALERTS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
    [RESOURCES.COMMISSIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MANAGE],
  },
  [ROLES.AGENCY_MANAGER]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.MANAGE],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.MANAGE],
    [RESOURCES.CLIENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
    [RESOURCES.TEAM]: [ACTIONS.VIEW],
    [RESOURCES.FINANCIAL]: [ACTIONS.VIEW],
    [RESOURCES.REPORTS]: [ACTIONS.VIEW],
    [RESOURCES.SETTINGS]: [ACTIONS.VIEW],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
    [RESOURCES.ALERTS]: [ACTIONS.VIEW],
    [RESOURCES.COMMISSIONS]: [ACTIONS.VIEW],
  },
  [ROLES.SALES]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
    [RESOURCES.CLIENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
    [RESOURCES.TEAM]: [],
    [RESOURCES.FINANCIAL]: [],
    [RESOURCES.REPORTS]: [],
    [RESOURCES.SETTINGS]: [],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW],
    [RESOURCES.ALERTS]: [ACTIONS.VIEW],
    [RESOURCES.COMMISSIONS]: [ACTIONS.VIEW],
  },
  [ROLES.SUPPORT]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW],
    [RESOURCES.CLIENTS]: [ACTIONS.VIEW, ACTIONS.EDIT],
    [RESOURCES.TEAM]: [],
    [RESOURCES.FINANCIAL]: [],
    [RESOURCES.REPORTS]: [],
    [RESOURCES.SETTINGS]: [],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW],
    [RESOURCES.ALERTS]: [ACTIONS.VIEW],
    [RESOURCES.COMMISSIONS]: [],
  },
  [ROLES.CLIENT]: {
    [RESOURCES.TRIPS]: [ACTIONS.VIEW],
    [RESOURCES.RESERVATIONS]: [ACTIONS.VIEW],
    [RESOURCES.CLIENTS]: [],
    [RESOURCES.TEAM]: [],
    [RESOURCES.FINANCIAL]: [],
    [RESOURCES.REPORTS]: [],
    [RESOURCES.SETTINGS]: [],
    [RESOURCES.CATALOG]: [ACTIONS.VIEW],
    [RESOURCES.ALERTS]: [],
    [RESOURCES.COMMISSIONS]: [],
  },
};

export function hasPermission(role: string, resource: Resource, action: Action): boolean {
  const rolePerms = PERMISSIONS_MATRIX[role as Role];
  if (!rolePerms) return false;
  const resourceActions = rolePerms[resource];
  if (!resourceActions) return false;
  return resourceActions.includes(action);
}

export const ADMIN_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN];
export const MANAGEMENT_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER];
export const AGENCY_STAFF_ROLES: string[] = [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT];
export const ALL_STAFF_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT];

export function getRoleLabel(role: string): string {
  switch (role) {
    case ROLES.SUPER_ADMIN:
      return "Super Admin";
    case ROLES.AGENCY_ADMIN:
      return "Administrador";
    case ROLES.AGENCY_MANAGER:
      return "Gerente";
    case ROLES.SALES:
      return "Vendedor";
    case ROLES.SUPPORT:
      return "Suporte";
    case ROLES.CLIENT:
      return "Cliente";
    default:
      return role;
  }
}

export function getRoleBadgeColor(role: string): string {
  switch (role) {
    case ROLES.SUPER_ADMIN:
      return "bg-purple-100 text-purple-800 border-purple-200";
    case ROLES.AGENCY_ADMIN:
      return "bg-blue-100 text-blue-800 border-blue-200";
    case ROLES.AGENCY_MANAGER:
      return "bg-teal-100 text-teal-800 border-teal-200";
    case ROLES.SALES:
      return "bg-green-100 text-green-800 border-green-200";
    case ROLES.SUPPORT:
      return "bg-orange-100 text-orange-800 border-orange-200";
    case ROLES.CLIENT:
      return "bg-gray-100 text-gray-800 border-gray-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}
