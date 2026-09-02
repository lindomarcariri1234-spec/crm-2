import { SignUp } from "@clerk/react";
import { PublicStore } from "@/lib/storeApi";
import { cleanCpf, formatCpf, isValidCpf } from "@workspace/shared";
import { useState } from "react";

export default function VitrineSignUp({
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [cpf, setCpf] = useState("");
  const [cpfError, setCpfError] = useState("");
  const cpfDigits = cleanCpf(cpf);

  function handleSubmitCapture(event: React.FormEvent) {
    if (!isValidCpf(cpfDigits)) {
      event.preventDefault();
      event.stopPropagation();
      setCpfError("Informe um CPF válido para vincular sua conta ao cadastro da agência.");
    }
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-10 pb-16 px-4 bg-gray-50">
      <div className="w-full max-w-md space-y-6">
        {/* Branded header — same style as store-signin */}
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
            <div className="h-16 w-16 mx-auto mb-3 rounded-xl bg-white/20 flex items-center justify-center font-bold text-2xl">
              {store.name.charAt(0)}
            </div>
          )}
          <h1 className="text-2xl font-bold">{store.name}</h1>
          <p className="text-white/80 text-sm mt-1">
            Crie sua conta de viajante
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <p className="text-sm text-muted-foreground text-center mb-4">
            Cadastre-se para acompanhar suas reservas e receber novidades.
          </p>
          <div onSubmitCapture={handleSubmitCapture}>
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
              unsafeMetadata={{ cpf: cpfDigits }}
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
