import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useGetMe, useGetCalendarStatus, getGetCalendarStatusQueryKey } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";
import { AlertsBell } from "./alerts-bell";
import {
  AlertCircle,
  LayoutDashboard,
  Users,
  Map,
  CalendarCheck,
  DollarSign,
  MessageSquare,
  LogOut,
  Settings,
  Target,
  Trello,
  Zap,
  BookOpen,
  BarChart2,
  ChevronDown,
  Building2,
  Star,
  TrendingUp,
  Megaphone,
  QrCode,
  Share2,
  Download,
  UserCheck,
  ChevronRight,
  ShoppingBag,
  Package,
  FolderOpen,
  ShoppingCart,
  Tag,
  MessageCircle,
  Gauge,
  BrainCircuit,
  Activity,
  History,
  Wallet,
  Award,
  X,
  Menu,
  MapPin,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const CALENDAR_CAN_CONNECT_ROLES: string[] = [ROLES.AGENCY_ADMIN, ROLES.SALES, ROLES.SUPER_ADMIN];

function GoogleCalendarExpiryBanner({ userRole }: { userRole?: string }) {
  const enabled = !!userRole && CALENDAR_CAN_CONNECT_ROLES.includes(userRole);
  const { data: status } = useGetCalendarStatus({
    query: { enabled, queryKey: getGetCalendarStatusQueryKey(), staleTime: 60_000 },
  });

  if (!enabled || status?.status !== "invalid") return null;

  return (
    <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800 shrink-0">
      <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
      <span className="flex-1">
        Sua integração com o Google Calendar expirou. A sincronização automática está pausada.
      </span>
      <Link href="/configuracoes?tab=integrations">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 hover:border-amber-400"
        >
          Reconectar
        </Button>
      </Link>
    </div>
  );
}

const TRIAL_BANNER_ROLES: string[] = [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SALES];

function TrialExpiryBanner({ trialDaysLeft, userRole }: { trialDaysLeft?: number | null; userRole?: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (
    dismissed ||
    trialDaysLeft == null ||
    !userRole ||
    !TRIAL_BANNER_ROLES.includes(userRole)
  ) return null;

  const daysLabel =
    trialDaysLeft === 0
      ? "hoje"
      : trialDaysLeft === 1
        ? "em 1 dia"
        : `em ${trialDaysLeft} dias`;

  return (
    <div className="flex items-center gap-3 bg-orange-50 border-b border-orange-200 px-6 py-2 text-sm text-orange-800 shrink-0">
      <AlertCircle className="w-4 h-4 shrink-0 text-orange-600" />
      <span className="flex-1">
        Seu período de avaliação termina {daysLabel} — fale conosco para continuar.
      </span>
      <a
        href="mailto:suporte@visitecrm.com?subject=Solicita%C3%A7%C3%A3o%20de%20extens%C3%A3o%20de%20per%C3%ADodo%20de%20avalia%C3%A7%C3%A3o"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-orange-300 text-orange-800 hover:bg-orange-100 hover:border-orange-400"
        >
          Fale conosco
        </Button>
      </a>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded-md text-orange-600/60 hover:text-orange-800 hover:bg-orange-100 transition-colors"
        aria-label="Fechar aviso"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface NavItem {
  name: string;
  href: string;
  roles?: string[];
  hiddenFor?: string[];
  icon: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
}

const AGENCY_NAVIGATION: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Pipeline", href: "/pipeline", icon: Trello },
  { name: "Clientes", href: "/clients", icon: Users },
  {
    name: "Viagens",
    href: "/trips",
    icon: Map,
    children: [
      { name: "Todas as viagens", href: "/trips", icon: Map },
      { name: "Calendário", href: "/trips/calendar", icon: CalendarCheck },
      { name: "Nova viagem", href: "/trips/new", icon: Map, roles: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SUPER_ADMIN] },
      { name: "Mídias", href: "/trips/media", icon: FolderOpen, roles: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SUPER_ADMIN] },
    ],
  },
  { name: "Reservas", href: "/reservations", icon: CalendarCheck },
  { name: "Vouchers", href: "/vouchers", icon: QrCode },
  {
    name: "Financeiro",
    href: "/financeiro",
    icon: DollarSign,
    hiddenFor: [ROLES.SUPPORT],
    children: [
      { name: "Visão geral", href: "/financeiro", icon: DollarSign },
      { name: "Comissões", href: "/financeiro/commissions", icon: Award },
      { name: "Despesas", href: "/financeiro/expenses", icon: Wallet },
    ],
  },
  {
    name: "Comunicação",
    href: "/comunicacao",
    icon: MessageSquare,
    children: [
      { name: "Central de comunicação", href: "/comunicacao", icon: MessageSquare },
      { name: "Campanhas", href: "/comunicacao/campanhas", icon: Megaphone },
      { name: "Automações", href: "/automacoes", icon: Zap, roles: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPPORT, ROLES.SUPER_ADMIN] },
    ],
  },
  {
    name: "Relacionamento",
    href: "/marketing",
    icon: Target,
    children: [
      { name: "Marketing", href: "/marketing", icon: Target },
      { name: "Fidelidade", href: "/fidelidade", icon: Star },
      { name: "NPS", href: "/nps", icon: TrendingUp },
      { name: "Indicações", href: "/indicacoes", icon: Share2 },
      { name: "Embaixadores", href: "/embaixadores", icon: Award },
    ],
  },
  {
    name: "Cadastros",
    href: "/cadastros",
    icon: BookOpen,
    children: [
      { name: "Visão geral", href: "/cadastros", icon: BookOpen },
      { name: "Fornecedores", href: "/cadastros/fornecedores", icon: Building2 },
      { name: "Veículos", href: "/cadastros/veiculos", icon: Map },
      { name: "Hospedagens", href: "/cadastros/hospedagens", icon: Building2 },
      { name: "Destinos", href: "/cadastros/destinos", icon: Map },
      { name: "Produtos", href: "/cadastros/produtos", icon: Package },
      { name: "Layouts", href: "/cadastros/layouts", icon: FolderOpen },
      { name: "Locais de embarque", href: "/cadastros/locais-embarque", icon: MapPin },
    ],
  },
  {
    name: "Analíticos",
    href: "/analytics",
    icon: BarChart2,
    children: [
      { name: "Visão geral", href: "/analytics", icon: BarChart2 },
      { name: "Vendedores", href: "/analytics/vendedores", icon: UserCheck },
      { name: "Insights", href: "/insights", icon: BrainCircuit },
      { name: "Gêmeo Digital", href: "/gemeo", icon: Activity, roles: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN] },
      { name: "Histórico Comparativo", href: "/analytics/historico-comparativo", icon: History },
      { name: "Receita", href: "/analytics/revenue", icon: Wallet, roles: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER] },
    ],
  },
  {
    name: "Minha Loja",
    href: "/loja",
    icon: ShoppingBag,
    children: [
      { name: "Configurações", href: "/loja/configuracoes", icon: Settings },
      { name: "Produtos", href: "/loja/produtos", icon: Package },
      { name: "Categorias", href: "/loja/categorias", icon: FolderOpen },
      { name: "Pedidos", href: "/loja/pedidos", icon: ShoppingCart },
      { name: "Cupons", href: "/loja/cupons", icon: Tag },
      { name: "Avaliações", href: "/loja/avaliacoes", icon: MessageCircle },
      { name: "Parceiros", href: "/loja/parceiros", icon: Building2 },
    ],
  },
  { name: "Downloads", href: "/downloads", icon: Download },
  { name: "Configurações", href: "/configuracoes", icon: Settings },
];

const VENDOR_NAVIGATION: NavItem[] = [
  { name: "Meu Painel", href: "/meu-painel", icon: Gauge },
  {
    name: "Viagens",
    href: "/trips",
    icon: Map,
    children: [
      { name: "Todas as viagens", href: "/trips", icon: Map },
      { name: "Calendário", href: "/trips/calendar", icon: CalendarCheck },
    ],
  },
  { name: "Reservas", href: "/reservations", icon: CalendarCheck },
  { name: "Vouchers", href: "/vouchers", icon: QrCode },
  { name: "Clientes", href: "/clients", icon: Users },
  { name: "Comunicação", href: "/comunicacao", icon: MessageSquare },
  { name: "Pipeline", href: "/pipeline", icon: Trello },
];

const ROLE_LABELS: Record<string, string> = {
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.AGENCY_ADMIN]: "Agência",
  [ROLES.AGENCY_MANAGER]: "Gerente",
  [ROLES.SALES]: "Vendedor",
  [ROLES.SUPPORT]: "Suporte",
  [ROLES.CLIENT]: "Cliente",
};

function NavLink({
  item,
  location,
  userRole,
  depth = 0,
}: {
  item: NavItem;
  location: string;
  userRole?: string;
  depth?: number;
}) {
  const visibleChildren = item.children?.filter(
    (c) =>
      (!c.hiddenFor || (userRole && !c.hiddenFor.includes(userRole))) &&
      (!c.roles || (!!userRole && c.roles.includes(userRole)))
  );
  const isActive =
    location === item.href ||
    (item.href !== "/" && location.startsWith(item.href));
  const hasChildren = visibleChildren && visibleChildren.length > 0;
  const childActive = visibleChildren?.some(
    (c) => location === c.href || (c.href !== "/" && location.startsWith(c.href))
  );
  const [open, setOpen] = useState(Boolean(isActive || childActive));

  useEffect(() => {
    if (isActive || childActive) setOpen(true);
  }, [isActive, childActive]);

  return (
    <div>
      {hasChildren ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`submenu-${item.href.replace(/[^a-z0-9]/gi, "-")}`}
            className={`flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
              depth > 0 ? "pl-7" : ""
            } ${
              isActive || childActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            }`}
            onClick={() => setOpen((current) => !current)}
          >
            <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.name}</span>
            <ChevronRight
              className={`w-3 h-3 ml-auto transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </button>
          {open && (
            <div id={`submenu-${item.href.replace(/[^a-z0-9]/gi, "-")}`} className="mt-0.5 space-y-0.5">
              {visibleChildren!.map((child) => (
                <NavLink key={child.href} item={child} location={location} userRole={userRole} depth={depth + 1} />
              ))}
            </div>
          )}
        </>
      ) : (
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
            depth > 0 ? "pl-7" : ""
          } ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          }`}
        >
          <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{item.name}</span>
        </Link>
      )}
    </div>
  );
}

export function NavigationMenu({
  items,
  location,
  userRole,
  onNavigate,
}: {
  items: NavItem[];
  location: string;
  userRole?: string;
  onNavigate?: () => void;
}) {
  const visibleItems = items.filter(
    (item) =>
      (!item.hiddenFor || (userRole && !item.hiddenFor.includes(userRole))) &&
      (!item.roles || (!!userRole && item.roles.includes(userRole)))
  );

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-0.5" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("a")) onNavigate?.();
    }}>
      {visibleItems.map((item) => (
        <NavLink key={item.name} item={item} location={location} userRole={userRole} />
      ))}
    </nav>
  );
}

function TenantBrand({
  tenantName,
  tenantLogoUrl,
  tenantPrimaryColor,
}: {
  tenantName: string;
  tenantLogoUrl?: string;
  tenantPrimaryColor: string;
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3 border-b border-sidebar-border">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden"
        style={{ background: tenantPrimaryColor }}
      >
        {tenantLogoUrl ? (
          <img src={tenantLogoUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <span>{tenantName.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-bold text-sm text-sidebar-foreground truncate">{tenantName}</span>
        <span className="text-xs text-sidebar-foreground/50">CRM Turismo</span>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();

  const tenantName: string = me?.tenant?.name ?? "VisiteCRM";
  const tenantLogoUrl: string | undefined = me?.tenant?.logoUrl ?? undefined;
  const tenantPrimaryColor: string = me?.tenant?.primaryColor ?? "#3B82F6";
  const userRole: string | undefined = me?.role;
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const tenantSettings = (me?.tenant?.settings ?? {}) as Record<string, unknown>;
  const referralsEnabled = tenantSettings.referralsEnabled !== false;
  const couponsEnabled = tenantSettings.couponsEnabled !== false;

  const agencyNav: NavItem[] = AGENCY_NAVIGATION.map((item) => {
    if (item.href === "/loja" && item.children) {
      return {
        ...item,
        children: item.children.filter((c) => c.href !== "/loja/cupons" || couponsEnabled),
      };
    }
    return item;
  })
    .filter((item) => item.href !== "/indicacoes" || referralsEnabled)
    .filter((item) => !item.hiddenFor || !userRole || !item.hiddenFor.includes(userRole));

  const navItems = userRole === ROLES.SALES ? VENDOR_NAVIGATION : agencyNav;

  // Find current nav item (including children)
  let currentSection: NavItem | undefined;
  for (const item of navItems) {
    if (location === item.href || (item.href !== "/" && location.startsWith(item.href))) {
      currentSection = item;
      break;
    }
    if (item.children) {
      const child = item.children.find(
        (c) => location === c.href || (c.href !== "/" && location.startsWith(c.href))
      );
      if (child) {
        currentSection = child;
        break;
      }
    }
  }

  return (
    <div className="flex h-screen bg-muted/30">
      <aside className="hidden w-64 bg-sidebar border-r md:flex flex-col shrink-0">
        <TenantBrand
          tenantName={tenantName}
          tenantLogoUrl={tenantLogoUrl}
          tenantPrimaryColor={tenantPrimaryColor}
        />

        <div className="flex-1 overflow-y-auto py-3 px-2">
          <NavigationMenu items={navItems} location={location} userRole={userRole} />
        </div>

        {/* User block */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2">
            <Avatar className="w-7 h-7 shrink-0">
              <AvatarImage src={user?.imageUrl} alt="" />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                {user?.firstName?.[0] ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium text-sidebar-foreground truncate">
                {user?.fullName || "Usuário"}
              </span>
              {userRole && (
                <span className="text-xs text-sidebar-foreground/50">
                  {ROLE_LABELS[userRole] ?? userRole}
                </span>
              )}
            </div>
            <button
              onClick={() => signOut()}
              title="Sair"
              className="p-1 rounded-md text-sidebar-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="w-[min(18rem,85vw)] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu principal</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <TenantBrand
              tenantName={tenantName}
              tenantLogoUrl={tenantLogoUrl}
              tenantPrimaryColor={tenantPrimaryColor}
            />
            <div className="flex-1 overflow-y-auto py-3 px-2">
              <NavigationMenu
                items={navItems}
                location={location}
                userRole={userRole}
                onNavigate={() => setMobileNavigationOpen(false)}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="h-13 bg-background border-b px-4 md:px-6 flex items-center justify-between shrink-0"
          style={{ minHeight: "52px" }}
        >
          {/* Current section / breadcrumb */}
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              aria-label="Abrir menu principal"
              onClick={() => setMobileNavigationOpen(true)}
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </Button>
            {currentSection ? (
              <>
                <currentSection.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{currentSection.name}</span>
              </>
            ) : (
              <>
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{tenantName}</span>
              </>
            )}
          </div>

          {/* Right side: alerts bell + user dropdown */}
          <div className="flex items-center gap-1">
            <AlertsBell userRole={userRole} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2 h-8">
                  <Avatar className="w-6 h-6">
                    <AvatarImage src={user?.imageUrl} alt="" />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {user?.firstName?.[0] ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium hidden sm:block max-w-[120px] truncate">
                    {user?.firstName || "Usuário"}
                  </span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{user?.fullName}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user?.primaryEmailAddress?.emailAddress}
                    </span>
                  </div>
                </DropdownMenuLabel>
                {userRole && (
                  <div className="px-2 pb-1">
                    <Badge variant="secondary" className="text-xs">
                      {ROLE_LABELS[userRole] ?? userRole}
                    </Badge>
                  </div>
                )}
                {userRole !== ROLES.SALES && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/configuracoes" className="cursor-pointer w-full flex items-center">
                        <Settings className="w-4 h-4 mr-2" />
                        Configurações
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={() => signOut()}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <GoogleCalendarExpiryBanner userRole={userRole} />
        <TrialExpiryBanner trialDaysLeft={me?.trialDaysLeft} userRole={userRole} />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
