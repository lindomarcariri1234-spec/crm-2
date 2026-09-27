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
import { applyStorefrontMetadata } from "@/lib/storefrontMetadata";
import { getSafeSocialUrl } from "@/lib/safe-social-url";
import { publicStoreApi } from "@/lib/storeApi";
import {
  captureStorefrontAttribution,
  getStorefrontReferralCookie,
  setStorefrontReferralCode,
  setStorefrontReferralCookie,
} from "@/lib/storefrontAttribution";

function getTrackingSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setTrackingSession(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function clearTrackingSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Session storage is only a deduplication enhancement.
  }
}

export default function VitrineLayout({
  children,
  slug,
  store,
}: {
  children: ReactNode;
  slug: string;
  store: PublicStore;
}) {
  const [location, navigate] = useLocation();
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

  useEffect(() => applyStorefrontMetadata(store, location), [store, location]);

  useEffect(() => {
    let cancelled = false;

    async function trackValidatedReferral() {
      const params = new URLSearchParams(window.location.search);
      const requestedCode = (params.get("ref") ?? params.get("code"))?.trim();
      let attribution = captureStorefrontAttribution(slug);

      // A code supplied through the URL has not earned a local attribution
      // record yet. Validate it first so arbitrary links cannot pollute the
      // tenant's conversion analytics.
      if (requestedCode && requestedCode.toUpperCase() !== attribution.referralCode) {
        try {
          await publicStoreApi.getReferralInfo(slug, requestedCode);
          if (cancelled) return;
          setStorefrontReferralCode(slug, requestedCode);
          attribution = captureStorefrontAttribution(slug);
        } catch {
          return;
        }
      }

      if (!attribution.referralCode || cancelled) return;
      const pageKey = `storefront-referral-tracked:${slug}:${attribution.referralCode}:${location}`;
      if (getTrackingSession(pageKey)) return;
      // Claim synchronously so React effects or route transitions cannot create
      // parallel tracking writes for the same page.
      const wasClaimed = setTrackingSession(pageKey, "pending");
      try {
        const result = await publicStoreApi.trackReferral(slug, {
          code: attribution.referralCode,
          serverCookieId: getStorefrontReferralCookie(slug),
          landingPage: window.location.pathname,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
        });
        if (result.cookieId) setStorefrontReferralCookie(slug, result.cookieId);
        if (wasClaimed) setTrackingSession(pageKey, "done");
      } catch {
        if (wasClaimed) clearTrackingSession(pageKey);
        // Attribution is best-effort and must not interrupt the public journey.
      }
    }

    void trackValidatedReferral();
    return () => { cancelled = true; };
  }, [location, slug]);

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

  const facebookUrl = getSafeSocialUrl(store.socialFacebook);
  const youtubeUrl = getSafeSocialUrl(store.socialYoutube);

  return (
    <div data-testid="vitrine-layout" className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
      <header
        data-testid="vitrine-header"
        className="sticky top-0 z-40 border-b border-white/10 shadow-[0_8px_26px_rgba(15,23,42,0.14)]"
        style={{ backgroundColor: colors.primary }}
      >
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between gap-4 px-4 lg:px-8">
          <button
            data-testid="button-store-home"
            onClick={() => navigate(`/loja/${slug}`)}
            className="group flex min-w-0 items-center gap-3 text-left"
          >
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt={store.name}
                data-testid="img-store-logo-header"
                className="h-11 w-11 rounded-2xl border border-white/20 bg-white/95 object-contain p-1.5 shadow-sm"
              />
            ) : (
              <div data-testid="text-store-initial" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/15 text-lg font-bold text-white">
                {store.name.charAt(0)}
              </div>
            )}
            <span data-testid="text-store-name-header" className="hidden max-w-[13rem] truncate text-base font-bold tracking-[-0.02em] text-white sm:block">
              {store.name}
            </span>
          </button>

          <nav data-testid="nav-desktop" className="hidden items-center gap-6 md:flex">
            <a
              href={`/loja/${slug}`}
              data-testid="link-home-desktop"
              className="text-sm font-semibold text-white/80 transition-colors hover:text-white"
            >
              Início
            </a>
            <a
              href={`/loja/${slug}/produtos`}
              data-testid="link-products-desktop"
              className="text-sm font-semibold text-white/80 transition-colors hover:text-white"
            >
              Pacotes
            </a>
            <a
              href={`/loja/${slug}/calendario`}
              data-testid="link-calendar-desktop"
              className="text-sm font-semibold text-white/80 transition-colors hover:text-white"
            >
              Calendário
            </a>
            <a
              href={`/loja/${slug}/consultar-pedido`}
              data-testid="link-order-lookup-desktop"
              className="text-sm font-semibold text-white/80 transition-colors hover:text-white"
            >
              Meu Pedido
            </a>
            {store.contactWhatsapp && (
              <a
                href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-whatsapp-desktop"
                className="text-sm font-semibold text-white/80 transition-colors hover:text-white"
              >
                WhatsApp
              </a>
            )}
            {isCliente ? (
              <div className="relative" ref={profileDropdownRef}>
                <button
                  onClick={() => setProfileDropdownOpen((v) => !v)}
                  data-testid="button-profile-menu-desktop"
                  className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <UserCircle className="w-4 h-4" />
                  Meu Perfil
                  <ChevronDown className="w-3 h-3" />
                </button>
                {profileDropdownOpen && (
                  <div data-testid="menu-profile-desktop" className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <a
                      href="/perfil"
                      data-testid="link-profile-desktop"
                      className="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setProfileDropdownOpen(false)}
                    >
                      <UserCircle className="w-4 h-4" />
                      Meu Perfil
                    </a>
                    {store.referralsEnabled !== false && (
                    <a
                      href="/perfil?tab=indicacoes"
                      data-testid="link-referrals-desktop"
                      className="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setProfileDropdownOpen(false)}
                    >
                      <Share2 className="w-4 h-4" />
                      Minhas Indicações
                    </a>
                    )}
                    <button
                      onClick={handleSignOut}
                      data-testid="button-signout-desktop"
                      className="flex w-full items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50"
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
                  data-testid="link-signin-desktop"
                  className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <UserCircle className="w-4 h-4" />
                  Entrar
                </a>
                <a
                  href={`/loja/${slug}/cadastrar`}
                  data-testid="link-signup-desktop"
                  className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 transition-colors hover:bg-white/90"
                >
                  Criar conta
                </a>
              </div>
            ) : null}
          </nav>

          <div className="flex items-center gap-2">
            <button
              data-testid="button-toggle-search"
              onClick={() => setSearchOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="Buscar"
            >
              <Search className="w-4 h-4" />
            </button>

            {isCliente && (
              <NotificationBell primaryColor={colors.primary} />
            )}

            <button
              data-testid="button-toggle-mobile-menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 md:hidden"
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div data-testid="panel-header-search" className="border-t border-white/10 px-4 py-4">
            <form onSubmit={handleSearch} className="mx-auto flex max-w-2xl gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar destinos, pacotes..."
                  data-testid="input-header-search"
                  className="w-full rounded-xl border border-white/20 bg-white/10 py-3 pl-9 pr-4 text-sm text-white placeholder:text-white/50 focus:bg-white/20 focus:outline-none"
                  onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
                />
              </div>
              <button
                data-testid="button-submit-header-search"
                type="submit"
                className="rounded-xl bg-white/15 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/25"
              >
                Buscar
              </button>
              <button
                data-testid="button-close-header-search"
                type="button"
                onClick={() => setSearchOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {mobileMenuOpen && (
          <div data-testid="menu-mobile" className="space-y-2 border-t border-white/10 px-5 py-4 md:hidden">
            <a
              href={`/loja/${slug}`}
              data-testid="link-home-mobile"
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Início
            </a>
            <a
              href={`/loja/${slug}/produtos`}
              data-testid="link-products-mobile"
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pacotes
            </a>
            <a
              href={`/loja/${slug}/calendario`}
              data-testid="link-calendar-mobile"
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Calendário
            </a>
            <a
              href={`/loja/${slug}/consultar-pedido`}
              data-testid="link-order-lookup-mobile"
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Meu Pedido
            </a>
            {store.contactWhatsapp && (
              <a
                href={`https://wa.me/${store.contactWhatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-whatsapp-mobile"
                className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
                onClick={() => setMobileMenuOpen(false)}
              >
                WhatsApp
              </a>
            )}
            {isCliente ? (
              <>
                <a
                  href="/perfil"
                  data-testid="link-profile-mobile"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <UserCircle className="w-4 h-4" />
                  Meu Perfil
                </a>
                {store.referralsEnabled !== false && (
                <a
                  href="/perfil?tab=indicacoes"
                  data-testid="link-referrals-mobile"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Share2 className="w-4 h-4" />
                  Minhas Indicações
                </a>
                )}
                <button
                  onClick={handleSignOut}
                  data-testid="button-signout-mobile"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-200 hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </>
            ) : !isSignedIn ? (
              <>
                <a
                  href={`/loja/${slug}/entrar`}
                  data-testid="link-signin-mobile"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <UserCircle className="w-4 h-4" />
                  Entrar
                </a>
                <a
                  href={`/loja/${slug}/cadastrar`}
                  data-testid="link-signup-mobile"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white"
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

      <footer data-testid="vitrine-footer" className="border-t border-slate-800 bg-slate-950 text-slate-300">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-12 md:grid-cols-3 lg:px-8">
          <div>
            <h3 data-testid="text-footer-store-name" className="mb-3 text-base font-bold text-white">{store.name}</h3>
            {store.description && (
              <p data-testid="text-footer-description" className="max-w-sm text-sm leading-relaxed text-slate-400">{store.description}</p>
            )}
            <div className="mt-5 flex gap-2">
              {store.socialInstagram && (
                <a
                  data-testid="link-footer-instagram"
                  href={`https://instagram.com/${store.socialInstagram.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition-colors hover:border-slate-500 hover:text-white"
                >
                  <Instagram className="w-5 h-5" />
                </a>
              )}
              {facebookUrl && (
                <a
                  data-testid="link-footer-facebook"
                  href={facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition-colors hover:border-slate-500 hover:text-white"
                >
                  <Facebook className="w-5 h-5" />
                </a>
              )}
              {youtubeUrl && (
                <a
                  data-testid="link-footer-youtube"
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition-colors hover:border-slate-500 hover:text-white"
                >
                  <Youtube className="w-5 h-5" />
                </a>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-white">Links Rápidos</h3>
            <div className="space-y-3 text-sm">
              <div>
                <a data-testid="link-footer-home" href={`/loja/${slug}`} className="text-slate-400 transition-colors hover:text-white">
                  Início
                </a>
              </div>
              <div>
                <a data-testid="link-footer-products" href={`/loja/${slug}/produtos`} className="text-slate-400 transition-colors hover:text-white">
                  Ver Pacotes
                </a>
              </div>
              <div>
                <a data-testid="link-footer-calendar" href={`/loja/${slug}/calendario`} className="text-slate-400 transition-colors hover:text-white">
                  Calendário de Saídas
                </a>
              </div>
              <div>
                <a data-testid="link-footer-order-lookup" href={`/loja/${slug}/consultar-pedido`} className="text-slate-400 transition-colors hover:text-white">
                  Consultar Pedido
                </a>
              </div>
            </div>
          </div>
          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-white">Fale com a equipe</h3>
            <div className="space-y-3 text-sm text-slate-400">
              {store.contactEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <a data-testid="link-footer-email" href={`mailto:${store.contactEmail}`} className="transition-colors hover:text-white">
                    {store.contactEmail}
                  </a>
                </div>
              )}
              {store.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <a data-testid="link-footer-phone" href={`tel:${store.contactPhone}`} className="transition-colors hover:text-white">
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
        <div className="border-t border-slate-800 px-5 py-4 text-center text-xs text-slate-500">
          © {Number(localToday().slice(0, 4))} {store.name} · Powered by VisiteCRM
        </div>
      </footer>

    </div>
  );
}
