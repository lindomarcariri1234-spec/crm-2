import { SignIn } from "@clerk/react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useEffect, useRef } from "react";
import { PublicStore } from "@/lib/storeApi";
import { useSyncMe } from "@workspace/api-client-react";
import { getSafeRedirectTarget } from "@/lib/safe-redirect";
import { clearSignupCpfHandoff, consumeSignupCpfHandoff } from "@/lib/signup-cpf-handoff";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

export default function VitrineSignIn({
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const { isSignedIn, user } = useUser();
  const { colors } = useVitrineTheme();
  const [, navigate] = useLocation();
  const redirectTarget = getSafeRedirectTarget(window.location.search, "redirect", "/perfil");
  const syncMe = useSyncMe();
  const syncStartedRef = useRef(false);

  // Detect when the user just completed storefront sign-up (Clerk redirects
  // back here with ?novoCliente=1 via afterSignUpUrl in store-signup.tsx).
  const isNewClient = new URLSearchParams(window.location.search).get("novoCliente") === "1";

  useEffect(() => {
    if (!isSignedIn || !user) return;

    if (isNewClient && !syncStartedRef.current) {
      // New client just registered via the storefront: sync with storeSlug so
      // the backend assigns role=CLIENT and tenantId of this agency. The CPF is
      // handed off once through short-lived sessionStorage, never Clerk metadata.
      syncStartedRef.current = true;
      let cpf: string | undefined;
      try {
        cpf = consumeSignupCpfHandoff(window.sessionStorage, store.slug);
      } catch {
        cpf = undefined;
      }
      syncMe.mutate(
        {
          data: {
            clerkId: user.id,
            name: user.fullName ?? user.firstName ?? "Viajante",
            email: user.primaryEmailAddress?.emailAddress ?? "",
            avatarUrl: user.imageUrl ?? undefined,
            storeSlug: store.slug,
            ...(cpf ? { cpf } : {}),
          },
        },
        {
          onSettled: () => {
            navigate("/perfil", { replace: true });
          },
        },
      );
    } else if (!isNewClient) {
      try {
        clearSignupCpfHandoff(window.sessionStorage);
      } catch {
        // Session storage may be disabled; the normal sign-in flow can proceed.
      }
      navigate(redirectTarget, { replace: true });
    }
  }, [isSignedIn, user?.id]);

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] items-start justify-center bg-slate-50 px-4 pb-16 pt-8 sm:pt-12">
      <div className="w-full max-w-md space-y-6">
        <div
          className="relative overflow-hidden rounded-[1.75rem] p-8 text-center text-white shadow-xl sm:p-10"
          style={{ background: colors.gradientHero }}
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full border border-white/15" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full border border-white/10" />
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt={store.name}
              className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-white/95 object-contain p-2 shadow-lg"
            />
          ) : (
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold"
            >
              {store.name.charAt(0)}
            </div>
          )}
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Área do viajante</p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">{store.name}</h1>
          <p className="text-white/80 text-sm mt-1">
            Acesse sua Área do Cliente
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-6 shadow-sm sm:p-7">
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
                 colorPrimary: colors.primary,
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
