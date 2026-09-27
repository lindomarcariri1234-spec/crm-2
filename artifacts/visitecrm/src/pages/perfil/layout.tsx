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
  const primaryColor = tenant?.primaryColor ?? "#1E5B8C";

  return (
    <div className="min-h-[100dvh] bg-[#F5F7FA] flex flex-col text-[#2F3A43]">
      <header
        className="sticky top-0 z-40 border-b border-[#17486F] shadow-[0_8px_28px_rgba(27,68,103,.16)]"
        style={{ background: `linear-gradient(110deg, ${primaryColor} 0%, #17486F 72%, #5D3E2A 140%)` }}
      >
        <div className="max-w-6xl mx-auto px-4 h-[4.5rem] flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant?.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt={tenant.name ?? ""}
                className="h-10 w-10 rounded-xl object-contain bg-[#FFF9F0] p-1.5 ring-1 ring-white/25"
              />
            ) : (
                <div className="h-10 w-10 rounded-xl bg-[#D8A646] flex items-center justify-center font-bold text-[#5D3E2A] text-base ring-1 ring-white/20">
                {tenant?.name?.charAt(0) ?? "V"}
              </div>
            )}
            <div className="hidden sm:block">
              <span className="text-white font-semibold text-base block">
                {tenant?.name ?? "VisiteCRM"}
              </span>
              <span className="text-white/60 text-[10px] uppercase tracking-[0.18em]">Área do viajante</span>
            </div>
            <div className="sm:hidden text-white font-semibold text-base">
              {tenant?.name ?? "VisiteCRM"}
            </div>
          </div>

          {tenant?.slug && (
            <nav className="hidden md:flex items-center gap-1 rounded-2xl bg-black/10 p-1">
              <a
                href={`/loja/${tenant.slug}`}
                className="rounded-xl px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors"
              >
                Início
              </a>
              <a
                href={`/loja/${tenant.slug}/produtos`}
                className="rounded-full px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors"
              >
                Pacotes
              </a>
              <a
                href={`/loja/${tenant.slug}/calendario`}
                className="rounded-full px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors"
              >
                Calendário
              </a>
              <a
                href={`/loja/${tenant.slug}/consultar-pedido`}
                className="rounded-full px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors"
              >
                Meu Pedido
              </a>
            </nav>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-white/90">
              <UserCircle className="w-4 h-4" />
              <span className="text-sm font-medium hidden sm:block">Meu Perfil</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ redirectUrl: tenant?.slug ? `/loja/${tenant.slug}` : "/" })}
              className={`text-white/80 hover:text-white hover:bg-white/20 gap-1.5 ${tenant?.slug ? "hidden md:flex" : "flex"}`}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:block">Sair</span>
            </Button>
            {tenant?.slug && (
              <button
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {mobileMenuOpen && tenant?.slug && (
          <div className="md:hidden border-t border-white/10 px-4 py-3 space-y-1">
            <a
              href={`/loja/${tenant.slug}`}
              className="block text-white/90 hover:text-white text-sm font-medium py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Início
            </a>
            <a
              href={`/loja/${tenant.slug}/produtos`}
              className="block text-white/90 hover:text-white text-sm font-medium py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pacotes
            </a>
            <a
              href={`/loja/${tenant.slug}/calendario`}
              className="block text-white/90 hover:text-white text-sm font-medium py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Calendário
            </a>
            <a
              href={`/loja/${tenant.slug}/consultar-pedido`}
              className="block text-white/90 hover:text-white text-sm font-medium py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Meu Pedido
            </a>
            <div className="border-t border-white/10 pt-2 mt-1">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  signOut({ redirectUrl: `/loja/${tenant.slug}` });
                }}
                className="flex items-center gap-2 text-white/80 hover:text-white text-sm font-medium py-2 w-full"
              >
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="relative flex-1 max-w-6xl mx-auto w-full px-4 py-6 md:py-9">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_12%_0%,rgba(216,166,70,.16),transparent_45%),radial-gradient(circle_at_90%_10%,rgba(76,139,95,.12),transparent_40%)]" />
        <div className="relative">{children}</div>
      </main>

      <footer className="border-t border-[#DCE3E8] bg-[#FFF9F0] text-[#71808C] py-5 text-center text-xs dark:border-border dark:bg-card dark:text-muted-foreground">
        {tenant?.name} · Área segura do viajante · VisiteCRM
      </footer>
    </div>
  );
}
