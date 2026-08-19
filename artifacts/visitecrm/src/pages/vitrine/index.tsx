import { useState, useEffect, Component, ReactNode } from "react";
import { useParams, Switch, Route, Redirect, useLocation } from "wouter";
import { publicStoreApi, PublicStore } from "@/lib/storeApi";
import { CartProvider } from "@/contexts/CartContext";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { ComparisonProvider } from "@/contexts/ComparisonContext";
import { VitrineThemeProvider } from "@/contexts/VitrineThemeContext";
import { ComparisonBar } from "@/components/vitrine/ComparisonBar";
import VitrineLayout from "./layout";
import VitrineHome from "./home";
import VitrineCatalog from "./catalog";
import VitrineCalendar from "./calendar";
import VitrineProduct from "./product";
import VitrineCheckout from "./checkout";
import VitrineOrderTracking from "./order-tracking";
import ReservationWizard from "./reservation-wizard";
import ReferralLanding from "./referral-landing";
import VitrineComparar from "./comparar";
import VitrineSignIn from "./store-signin";
import VitrineSignUp from "./store-signup";
import { Loader2, AlertCircle } from "lucide-react";

interface WizardErrorBoundaryState { hasError: boolean }

class WizardErrorBoundary extends Component<{ children: ReactNode }, WizardErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 gap-4">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-xl font-semibold">Algo deu errado</h2>
          <p className="text-muted-foreground max-w-sm">
            Ocorreu um erro ao carregar esta página. Por favor, tente novamente.
          </p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { saveReferralToStorage } from "./utils/storage";

const SERVER_COOKIE_KEY = "referral_server_cookie_id";

function ReferralCapture({ slug, code }: { slug: string; code: string }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    const upperCode = code.toUpperCase();
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get("utm_source") ?? undefined;
    const utmMedium = params.get("utm_medium") ?? undefined;
    const utmCampaign = params.get("utm_campaign") ?? undefined;
    const existingCookieId = localStorage.getItem(SERVER_COOKIE_KEY) ?? undefined;

    async function captureAndRedirect() {
      try {
        const [trackResult, infoResult] = await Promise.allSettled([
          publicStoreApi.trackReferral(slug, {
            code: upperCode,
            serverCookieId: existingCookieId,
            landingPage: window.location.href,
            utmSource,
            utmMedium,
            utmCampaign,
          }),
          publicStoreApi.getReferralInfo(slug, upperCode),
        ]);

        if (trackResult.status === "fulfilled" && trackResult.value?.cookieId) {
          localStorage.setItem(SERVER_COOKIE_KEY, trackResult.value.cookieId);
        }

        const referrerName = infoResult.status === "fulfilled"
          ? infoResult.value?.referrerName
          : undefined;

        saveReferralToStorage(upperCode, referrerName);
      } catch {
        saveReferralToStorage(upperCode);
      }

      navigate(`/loja/${slug}?ref=${encodeURIComponent(upperCode)}&welcome=true`, { replace: true });
    }

    captureAndRedirect();
  }, [slug, code, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function StoreRouter({ slug }: { slug: string }) {
  const [store, setStore] = useState<PublicStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    publicStoreApi
      .getStore(slug)
      .then((s) => setStore(s))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !store) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="text-muted-foreground text-lg mb-6">Loja não encontrada.</p>
        <a href="/" className="text-primary underline">
          Voltar ao início
        </a>
      </div>
    );
  }

  if (store.maintenanceMode || !store.isActive) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center text-center px-4 text-white"
        style={{
          background: `linear-gradient(135deg, ${store.primaryColor}, ${store.secondaryColor})`,
        }}
      >
        {store.logoUrl && (
          <img src={store.logoUrl} alt={store.name} className="h-20 mb-6 rounded-lg" />
        )}
        <h1 className="text-3xl font-bold mb-3">{store.name}</h1>
        <p className="text-white/80 max-w-md text-lg">
          {store.maintenanceMessage ?? "Estamos em manutenção. Voltamos em breve!"}
        </p>
      </div>
    );
  }

  return (
    <VitrineThemeProvider store={store}>
      <VitrineLayout slug={slug} store={store}>
        <Switch>
        <Route path={`/loja/${slug}`}>
          <VitrineHome slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/produtos`}>
          <VitrineCatalog slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/calendario`}>
          <VitrineCalendar slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/comparar`}>
          <VitrineComparar slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/produtos/:productSlug`}>
          {(params: Record<string, string>) => (
            <VitrineProduct
              slug={slug}
              productSlug={params.productSlug}
              store={store}
            />
          )}
        </Route>
        <Route path={`/loja/${slug}/reservar/:productSlug`}>
          {(params: Record<string, string>) => (
            <WizardErrorBoundary>
              <ReservationWizard
                slug={slug}
                productSlug={params.productSlug}
                store={store}
              />
            </WizardErrorBoundary>
          )}
        </Route>
        <Route path={`/loja/${slug}/checkout`}>
          <WizardErrorBoundary>
            <VitrineCheckout slug={slug} store={store} />
          </WizardErrorBoundary>
        </Route>
        <Route path={`/loja/${slug}/pedido/:orderNumber`}>
          {(params: Record<string, string>) => (
            <VitrineOrderTracking
              slug={slug}
              store={store}
              initialOrderNumber={decodeURIComponent(params.orderNumber ?? "")}
            />
          )}
        </Route>
        <Route path={`/loja/${slug}/consultar-pedido`}>
          <VitrineOrderTracking slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/entrar`}>
          <VitrineSignIn slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/cadastrar`}>
          <VitrineSignUp slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/indicacao`}>
          <ReferralLanding slug={slug} store={store} />
        </Route>
        <Route path={`/loja/${slug}/minhas-indicacoes`}>
          <RedirectToPerfilReferral slug={slug} />
        </Route>
        <Route path={`/loja/${slug}/ref/:code`}>
          {(params: Record<string, string>) => (
            <ReferralCapture slug={slug} code={params.code ?? ""} />
          )}
        </Route>
        <Route>
          <Redirect to={`/loja/${slug}`} />
        </Route>
        </Switch>
      </VitrineLayout>
      <ComparisonBar slug={slug} />
    </VitrineThemeProvider>
  );
}

function RedirectToPerfilReferral({ slug }: { slug: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/perfil?tab=indicacoes");
  }, [navigate]);
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function Vitrine() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  if (!slug) {
    return <Redirect to="/" />;
  }

  return (
    <CartProvider slug={slug}>
      <FavoritesProvider>
        <ComparisonProvider slug={slug}>
          <StoreRouter slug={slug} />
        </ComparisonProvider>
      </FavoritesProvider>
    </CartProvider>
  );
}
