import { ReactNode, useState } from "react";
import { useClerk } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";
import { UserCircle, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const { data: me } = useGetMe();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const tenant = me?.tenant;
  const primaryColor = tenant?.primaryColor ?? "#1D4ED8";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F8FAFC] text-[#0F172A] dark:bg-slate-950 dark:text-slate-100">
      <header
        className="sticky top-0 z-40 border-b border-white/15 shadow-[0_8px_28px_rgba(15,23,42,.14)]"
        style={{ background: `linear-gradient(110deg, ${primaryColor} 0%, #1D4ED8 68%, #0F4C81 130%)` }}
      >
        <div className="mx-auto flex h-[4.75rem] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {tenant?.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt={tenant.name ?? ""}
                className="h-10 w-10 rounded-2xl bg-white p-1.5 object-contain shadow-sm ring-1 ring-white/25"
                data-testid="img-tenant-logo"
              />
            ) : (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-base font-bold text-white ring-1 ring-white/25"
                style={{ backgroundColor: `${primaryColor}cc` }}
                data-testid="avatar-tenant-fallback"
              >
                {tenant?.name?.charAt(0) ?? "V"}
              </div>
            )}
            <div className="hidden min-w-0 sm:block">
              <span className="block truncate text-base font-bold tracking-tight text-white" data-testid="text-tenant-name">
                {tenant?.name ?? "VisiteCRM"}
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/65">Área do viajante</span>
            </div>
            <div className="truncate text-base font-bold text-white sm:hidden" data-testid="text-tenant-name-mobile">
              {tenant?.name ?? "VisiteCRM"}
            </div>
          </div>

          {tenant?.slug && (
            <nav className="hidden items-center gap-1 rounded-2xl bg-black/10 p-1 md:flex" aria-label="Navegação da agência">
              <a
                href={`/loja/${tenant.slug}`}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                data-testid="link-store-home"
              >
                Início
              </a>
              <a
                href={`/loja/${tenant.slug}/produtos`}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                data-testid="link-store-packages"
              >
                Pacotes
              </a>
              <a
                href={`/loja/${tenant.slug}/calendario`}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                data-testid="link-store-calendar"
              >
                Calendário
              </a>
              <a
                href={`/loja/${tenant.slug}/consultar-pedido`}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-white/75 transition-colors hover:bg-white/12 hover:text-white"
                data-testid="link-store-order"
              >
                Meu Pedido
              </a>
            </nav>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-white/90">
              <UserCircle className="w-4 h-4" />
              <span className="hidden text-sm font-semibold sm:block">Meu Perfil</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ redirectUrl: tenant?.slug ? `/loja/${tenant.slug}` : "/" })}
              className={`gap-1.5 rounded-full text-white/80 hover:bg-white/15 hover:text-white ${tenant?.slug ? "hidden md:flex" : "flex"}`}
              data-testid="button-sign-out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:block">Sair</span>
            </Button>
            {tenant?.slug && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 md:hidden"
                aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
                data-testid="button-toggle-mobile-menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {mobileMenuOpen && tenant?.slug && (
          <div className="space-y-1 border-t border-white/10 px-4 py-4 md:hidden" data-testid="menu-mobile-navigation">
            <a
              href={`/loja/${tenant.slug}`}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
              data-testid="link-mobile-store-home"
            >
              Início
            </a>
            <a
              href={`/loja/${tenant.slug}/produtos`}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
              data-testid="link-mobile-store-packages"
            >
              Pacotes
            </a>
            <a
              href={`/loja/${tenant.slug}/calendario`}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
              data-testid="link-mobile-store-calendar"
            >
              Calendário
            </a>
            <a
              href={`/loja/${tenant.slug}/consultar-pedido`}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
              data-testid="link-mobile-store-order"
            >
              Meu Pedido
            </a>
            <div className="mt-2 border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  signOut({ redirectUrl: `/loja/${tenant.slug}` });
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                data-testid="button-mobile-sign-out"
              >
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-9 lg:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_12%_0%,rgba(14,165,233,.10),transparent_44%),radial-gradient(circle_at_92%_8%,rgba(20,184,166,.08),transparent_38%)] dark:bg-[radial-gradient(circle_at_12%_0%,rgba(14,165,233,.10),transparent_44%),radial-gradient(circle_at_92%_8%,rgba(20,184,166,.06),transparent_38%)]" />
        <div className="relative">{children}</div>
      </main>

      <footer className="border-t border-slate-200 bg-white/75 px-4 py-6 text-center text-xs text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-slate-900/75 dark:text-slate-400">
        <span data-testid="text-portal-footer">{tenant?.name ?? "VisiteCRM"} · Área segura do viajante · VisiteCRM</span>
      </footer>
    </div>
  );
}
