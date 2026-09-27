import { SignUp } from "@clerk/react";
import { PublicStore } from "@/lib/storeApi";
import { cleanCpf, formatCpf, isValidCpf } from "@workspace/shared";
import { useState } from "react";
import { saveSignupCpfHandoff } from "@/lib/signup-cpf-handoff";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

export default function VitrineSignUp({
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [cpf, setCpf] = useState("");
  const { colors } = useVitrineTheme();
  const [cpfError, setCpfError] = useState("");
  const cpfDigits = cleanCpf(cpf);

  function saveCpfForSignup(): boolean {
    if (!isValidCpf(cpfDigits)) {
      setCpfError("Informe um CPF válido para vincular sua conta ao cadastro da agência.");
      return false;
    }

    try {
      saveSignupCpfHandoff(window.sessionStorage, store.slug, cpfDigits);
      setCpfError("");
      return true;
    } catch {
      setCpfError("Não foi possível guardar o CPF temporariamente. Ative o armazenamento da sessão e tente novamente.");
      return false;
    }
  }

  function handleSubmitCapture(event: React.FormEvent) {
    if (!saveCpfForSignup()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("button")) return;
    if (!saveCpfForSignup()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] items-start justify-center bg-slate-50 px-4 pb-16 pt-8 sm:pt-12">
      <div className="w-full max-w-md space-y-6">
        {/* Branded header — same style as store-signin */}
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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold">
              {store.name.charAt(0)}
            </div>
          )}
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Área do viajante</p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em]">{store.name}</h1>
          <p className="text-white/80 text-sm mt-1">
            Crie sua conta de viajante
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-6 shadow-sm sm:p-7">
          <p className="text-sm text-muted-foreground text-center mb-4">
            Cadastre-se para acompanhar suas reservas e receber novidades.
          </p>
          <div onSubmitCapture={handleSubmitCapture} onClickCapture={handleClickCapture}>
            <div className="space-y-2 mb-4">
              <label htmlFor="store-signup-cpf" className="text-sm font-medium">
                CPF
              </label>
              <input
                id="store-signup-cpf"
                value={cpfDigits.length === 11 ? formatCpf(cpfDigits) : cpf}
                onChange={(event) => {
                  setCpf(event.target.value);
                  setCpfError("");
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                className="w-full h-11 rounded-lg border bg-background px-3 text-sm"
                aria-invalid={!!cpfError}
                aria-describedby={cpfError ? "store-signup-cpf-error" : undefined}
              />
              {cpfError ? (
                <p id="store-signup-cpf-error" className="text-xs text-destructive">
                  {cpfError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Usaremos o CPF para localizar ou criar seu único cadastro nesta agência.
                </p>
              )}
            </div>
            <SignUp
              routing="hash"
              signInUrl={`/loja/${store.slug}/entrar`}
              forceRedirectUrl={`/loja/${store.slug}/entrar?novoCliente=1`}
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
          <a
            href={`/loja/${store.slug}`}
            className="underline hover:text-foreground"
          >
            Ver pacotes disponíveis
          </a>
        </p>
      </div>
    </div>
  );
}
