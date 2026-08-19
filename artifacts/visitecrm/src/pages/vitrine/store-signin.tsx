import { SignIn } from "@clerk/react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useEffect, useRef } from "react";
import { PublicStore } from "@/lib/storeApi";
import { useSyncMe } from "@workspace/api-client-react";

function getRedirectTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  // Accept only safe relative paths: must start with "/" but not "//" or "/\"
  // to prevent open-redirect attacks like //evil.com or /\evil.com
  if (redirect && /^\/[^/\\]/.test(redirect)) return redirect;
  return "/perfil";
}

export default function VitrineSignIn({
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const { isSignedIn, user } = useUser();
  const [, navigate] = useLocation();
  const redirectTarget = getRedirectTarget();
  const syncMe = useSyncMe();
  const syncStartedRef = useRef(false);

  // Detect when the user just completed storefront sign-up (Clerk redirects
  // back here with ?novoCliente=1 via afterSignUpUrl in store-signup.tsx).
  const isNewClient = new URLSearchParams(window.location.search).get("novoCliente") === "1";

  useEffect(() => {
    if (!isSignedIn || !user) return;

    if (isNewClient && !syncStartedRef.current) {
      // New client just registered via the storefront: sync with storeSlug so
      // the backend assigns role=CLIENT and tenantId of this agency.
      syncStartedRef.current = true;
      syncMe.mutate(
        {
          data: {
            clerkId: user.id,
            name: user.fullName ?? user.firstName ?? "Viajante",
            email: user.primaryEmailAddress?.emailAddress ?? "",
            avatarUrl: user.imageUrl ?? undefined,
            storeSlug: store.slug,
          },
        },
        {
          onSettled: () => {
            navigate("/perfil", { replace: true });
          },
        },
      );
    } else if (!isNewClient) {
      navigate(redirectTarget, { replace: true });
    }
  }, [isSignedIn, user?.id]);

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-10 pb-16 px-4 bg-gray-50">
      <div className="w-full max-w-md space-y-6">
        <div
          className="rounded-2xl p-8 text-white text-center"
          style={{
            background: `linear-gradient(135deg, ${store.primaryColor}, ${store.secondaryColor || store.primaryColor}cc)`,
          }}
        >
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt={store.name}
              className="h-16 w-16 mx-auto mb-3 rounded-xl object-contain bg-white/10 p-2"
            />
          ) : (
            <div
              className="h-16 w-16 mx-auto mb-3 rounded-xl bg-white/20 flex items-center justify-center font-bold text-2xl"
            >
              {store.name.charAt(0)}
            </div>
          )}
          <h1 className="text-2xl font-bold">{store.name}</h1>
          <p className="text-white/80 text-sm mt-1">
            Acesse sua Área do Cliente
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <p className="text-sm text-muted-foreground text-center mb-4">
            Entre com o e-mail e a senha da sua conta de viajante.
          </p>
          <SignIn
            routing="hash"
            fallbackRedirectUrl={redirectTarget}
            forceRedirectUrl={redirectTarget}
            signUpUrl={`/loja/${store.slug}/cadastrar`}
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-none border-0 p-0 bg-transparent",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton: "border rounded-lg h-11",
                formButtonPrimary: "h-11 rounded-lg",
                footerAction: "hidden",
              },
              variables: {
                colorPrimary: store.primaryColor,
              },
            }}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <a
            href={`/loja/${store.slug}/entrar`}
            className="underline hover:text-foreground"
          >
            Entrar
          </a>
          {" · "}
          Novo por aqui?{" "}
          <a
            href={`/loja/${store.slug}/cadastrar`}
            className="underline hover:text-foreground"
          >
            Criar conta
          </a>
        </p>
      </div>
    </div>
  );
}
