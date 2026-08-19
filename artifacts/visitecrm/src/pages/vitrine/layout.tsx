import { ReactNode, useState, useRef, useEffect } from "react";
import { localToday } from "@workspace/shared";
import { useLocation } from "wouter";
import { PublicStore } from "@/lib/storeApi";
import { useUser, useClerk } from "@clerk/react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";
import {
  X,
  Phone,
  Mail,
  Instagram,
  Facebook,
  Youtube,
  MapPin,
  Menu,
  Search,
  UserCircle,
  ChevronDown,
  LogOut,
  Share2,
} from "lucide-react";
import { NotificationBell } from "@/components/vitrine/NotificationBell";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

export default function VitrineLayout({
  children,
  slug,
  store,
}: {
  children: ReactNode;
  slug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { colors } = useVitrineTheme();
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { data: me } = useGetMe({ query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() } });
  const isCliente = isSignedIn && me?.role === ROLES.CLIENT;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profileDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileDropdownOpen]);

  function handleSignOut() {
    signOut({ redirectUrl: `/loja/${slug}` });
  }

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchOpen(false);
    navigate(`/loja/${slug}/produtos?search=${encodeURIComponent(searchQuery.trim())}`);
    setSearchQuery("");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header
        className="sticky top-0 z-40 border-b shadow-sm"
        style={{ backgroundColor: colors.primary }}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate(`/loja/${slug}`)}
            className="flex items-center gap-3"
          >
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt={store.name}
                className="h-10 w-10 rounded object-contain bg-white/10 p-1"
              />
            ) : (
              <div className="h-10 w-10 rounded bg-white/20 flex items-center justify-center font-bold text-white text-lg">
                {store.name.charAt(0)}
              </div>
            )}
            <span className="text-white font-bold text-lg hidden sm:block">
              {store.name}
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-6">
            <a
              href={`/loja/${slug}`}
              className="text-white/90 hover:text-white text-sm font-medium transition-colors"
            >
              Início
            </a>
            <a
              href={`/loja/${slug}/produtos`}
              className="text-white/90 hover:text-white text-sm font-medium transition-colors"
            >
              Pacotes
            </a>
            <a
              href={`/loja/${slug}/calendario`}
              className="text-white/90 hover:text-white text-sm font-medium transition-colors"
            >
              Calendário
            </a>
            <a
              href={`/loja/${slug}/consultar-pedido`}
              className="text-white/90 hover:text-white text-sm font-medium transition-colors"
            >
              Meu Pedido
            </a>
            {store.contactWhatsapp && (
              <a
                href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/90 hover:text-white text-sm font-medium transition-colors"
              >
                WhatsApp
              </a>
            )}
            {isCliente ? (
              <div className="relative" ref={profileDropdownRef}>
                <button
                  onClick={() => setProfileDropdownOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-white/90 hover:text-white text-sm font-medium transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg"
                >
                  <UserCircle className="w-4 h-4" />
                  Meu Perfil
                  <ChevronDown className="w-3 h-3" />
                </button>
                {profileDropdownOpen && (
                  <div className="absolute right-0 mt-1 w-48 rounded-lg bg-white shadow-lg overflow-hidden z-50">
                    <a
                      href="/perfil"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setProfileDropdownOpen(false)}
                    >
                      <UserCircle className="w-4 h-4" />
                      Meu Perfil
                    </a>
                    {store.referralsEnabled !== false && (
                    <a
                      href="/perfil?tab=indicacoes"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setProfileDropdownOpen(false)}
                    >
                      <Share2 className="w-4 h-4" />
                      Minhas Indicações
                    </a>
                    )}
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                      <LogOut className="w-4 h-4" />
                      Sair
                    </button>
                  </div>
                )}
              </div>
            ) : !isSignedIn ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/loja/${slug}/entrar`}
                  className="flex items-center gap-1.5 text-white/90 hover:text-white text-sm font-medium transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg"
                >
                  <UserCircle className="w-4 h-4" />
                  Entrar
                </a>
                <a
                  href={`/loja/${slug}/cadastrar`}
                  className="flex items-center gap-1.5 text-sm font-medium transition-colors bg-white text-gray-900 hover:bg-white/90 px-3 py-1.5 rounded-lg"
                >
                  Criar conta
                </a>
              </div>
            ) : null}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Buscar"
            >
              <Search className="w-4 h-4" />
            </button>

            {isCliente && (
              <NotificationBell primaryColor={colors.primary} />
            )}

            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="border-t border-white/10 px-4 py-3">
            <form onSubmit={handleSearch} className="max-w-lg mx-auto flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar destinos, pacotes..."
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/50 text-sm focus:outline-none focus:bg-white/20"
                  onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm font-medium transition-colors"
              >
                Buscar
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-3 space-y-2">
            <a
              href={`/loja/${slug}`}
              className="block text-white/90 hover:text-white text-sm font-medium py-1"
              onClick={() => setMobileMenuOpen(false)}
            >
              Início
            </a>
            <a
              href={`/loja/${slug}/produtos`}
              className="block text-white/90 hover:text-white text-sm font-medium py-1"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pacotes
            </a>
            <a
              href={`/loja/${slug}/calendario`}
              className="block text-white/90 hover:text-white text-sm font-medium py-1"
              onClick={() => setMobileMenuOpen(false)}
            >
              Calendário
            </a>
            <a
              href={`/loja/${slug}/consultar-pedido`}
              className="block text-white/90 hover:text-white text-sm font-medium py-1"
              onClick={() => setMobileMenuOpen(false)}
            >
              Meu Pedido
            </a>
            {store.contactWhatsapp && (
              <a
                href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-white/90 hover:text-white text-sm font-medium py-1"
                onClick={() => setMobileMenuOpen(false)}
              >
                WhatsApp
              </a>
            )}
            {isCliente ? (
              <>
                <a
                  href="/perfil"
                  className="flex items-center gap-2 text-white/90 hover:text-white text-sm font-medium py-1"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <UserCircle className="w-4 h-4" />
                  Meu Perfil
                </a>
                {store.referralsEnabled !== false && (
                <a
                  href="/perfil?tab=indicacoes"
                  className="flex items-center gap-2 text-white/90 hover:text-white text-sm font-medium py-1"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Share2 className="w-4 h-4" />
                  Minhas Indicações
                </a>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 text-red-300 hover:text-red-100 text-sm font-medium py-1 w-full"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </>
            ) : !isSignedIn ? (
              <>
                <a
                  href={`/loja/${slug}/entrar`}
                  className="flex items-center gap-2 text-white/90 hover:text-white text-sm font-medium py-1"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <UserCircle className="w-4 h-4" />
                  Entrar
                </a>
                <a
                  href={`/loja/${slug}/cadastrar`}
                  className="flex items-center gap-2 text-white/90 hover:text-white text-sm font-medium py-1"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Criar conta
                </a>
              </>
            ) : null}
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-gray-900 text-gray-300">
        <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-white font-bold mb-3">{store.name}</h3>
            {store.description && (
              <p className="text-sm leading-relaxed">{store.description}</p>
            )}
            <div className="flex gap-3 mt-4">
              {store.socialInstagram && (
                <a
                  href={`https://instagram.com/${store.socialInstagram.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  <Instagram className="w-5 h-5" />
                </a>
              )}
              {store.socialFacebook && (
                <a
                  href={store.socialFacebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  <Facebook className="w-5 h-5" />
                </a>
              )}
              {store.socialYoutube && (
                <a
                  href={store.socialYoutube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  <Youtube className="w-5 h-5" />
                </a>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-white font-bold mb-3">Links Rápidos</h3>
            <div className="space-y-2 text-sm">
              <div>
                <a href={`/loja/${slug}`} className="hover:text-white">
                  Início
                </a>
              </div>
              <div>
                <a href={`/loja/${slug}/produtos`} className="hover:text-white">
                  Ver Pacotes
                </a>
              </div>
              <div>
                <a href={`/loja/${slug}/calendario`} className="hover:text-white">
                  Calendário de Saídas
                </a>
              </div>
              <div>
                <a href={`/loja/${slug}/consultar-pedido`} className="hover:text-white">
                  Consultar Pedido
                </a>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-white font-bold mb-3">Contato</h3>
            <div className="space-y-2 text-sm">
              {store.contactEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <a href={`mailto:${store.contactEmail}`} className="hover:text-white">
                    {store.contactEmail}
                  </a>
                </div>
              )}
              {store.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <a href={`tel:${store.contactPhone}`} className="hover:text-white">
                    {store.contactPhone}
                  </a>
                </div>
              )}
              {store.contactAddress && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{store.contactAddress}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-800 text-center py-4 text-xs text-gray-500">
          © {Number(localToday().slice(0, 4))} {store.name} · Powered by VisiteCRM
        </div>
      </footer>

    </div>
  );
}
