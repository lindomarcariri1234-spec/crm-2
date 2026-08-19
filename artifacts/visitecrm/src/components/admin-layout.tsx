import { Component, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Receipt,
  BarChart3,
  Users,
  ScrollText,
  Settings,
  LogOut,
  ShieldCheck,
  ChevronDown,
  Layers,
  AlertTriangle,
  RefreshCw,
  Package,
  Wrench,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { name: "Visão Geral", href: "/admin", icon: LayoutDashboard, exact: true },
  { name: "Agências", href: "/admin/tenants", icon: Building2, exact: false },
  { name: "Planos", href: "/admin/plans", icon: Package, exact: false },
  { name: "Faturamento", href: "/admin/billing", icon: Receipt, exact: false },
  { name: "Métricas", href: "/admin/metrics", icon: BarChart3, exact: false },
  { name: "Usuários", href: "/admin/users", icon: Users, exact: false },
  { name: "Logs de Auditoria", href: "/admin/logs", icon: ScrollText, exact: false },
  { name: "Manutenção", href: "/admin/maintenance", icon: Wrench, exact: false },
  { name: "Saúde dos Dados", href: "/admin/system-health", icon: HeartPulse, exact: false },
  { name: "Configurações", href: "/admin/settings", icon: Settings, exact: false },
];

interface ErrorBoundaryProps {
  children: ReactNode;
  location: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  errorLocation: string;
}

class AdminErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "", errorLocation: props.location };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, errorMessage: error.message };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (state.hasError && props.location !== state.errorLocation) {
      return { hasError: false, errorMessage: "", errorLocation: props.location };
    }
    return null;
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-20 text-center px-4">
          <AlertTriangle className="w-12 h-12 text-destructive opacity-60 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Erro ao renderizar esta página</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            {this.state.errorMessage || "Ocorreu um erro inesperado. Tente recarregar a página."}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, errorMessage: "" });
              window.location.reload();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Recarregar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <div className="flex h-screen bg-muted/30">
      <div className="w-56 bg-slate-900 text-white flex flex-col shrink-0">
        <div className="px-4 py-4 flex items-center gap-3 border-b border-slate-700">
          <div className="w-8 h-8 rounded-md bg-indigo-500 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm truncate">Super Admin</span>
            <span className="text-xs text-slate-400">VisiteCRM</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.exact
              ? location === item.href
              : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-700">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full flex items-center gap-2 px-2 h-9 text-slate-300 hover:text-white hover:bg-slate-700"
              >
                <Avatar className="w-6 h-6">
                  <AvatarImage src={user?.imageUrl} alt="" />
                  <AvatarFallback className="bg-indigo-500 text-white text-xs font-bold">
                    {user?.firstName?.[0] ?? "S"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium truncate flex-1 text-left">
                  {user?.firstName || "Usuário"}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{user?.fullName}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {user?.primaryEmailAddress?.emailAddress}
                  </span>
                </div>
              </DropdownMenuLabel>
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
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header
          className="h-13 bg-background border-b px-6 flex items-center shrink-0"
          style={{ minHeight: "52px" }}
        >
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
            <span className="font-semibold text-foreground">Painel Super Admin</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <AdminErrorBoundary location={location}>{children}</AdminErrorBoundary>
        </main>
      </div>
    </div>
  );
}
