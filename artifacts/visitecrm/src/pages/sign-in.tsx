import { SignIn } from "@clerk/react";
import { Map, ShieldCheck, Users, TrendingUp } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const BENEFITS = [
  { icon: Users, text: "Gestão completa de clientes e passageiros" },
  { icon: Map, text: "Planejamento de viagens e excursões" },
  { icon: TrendingUp, text: "Financeiro, comissões e relatórios" },
  { icon: ShieldCheck, text: "Dados seguros com criptografia de ponta" },
];

export default function SignInPage() {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-primary/90 to-blue-700 flex-col justify-between p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-64 h-64 rounded-full border-2 border-white/30" />
          <div className="absolute top-40 left-40 w-40 h-40 rounded-full border border-white/20" />
          <div className="absolute bottom-40 right-10 w-80 h-80 rounded-full border-2 border-white/20" />
          <div className="absolute bottom-20 right-32 w-48 h-48 rounded-full border border-white/30" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center font-bold text-xl">
              V
            </div>
            <span className="font-bold text-2xl">VisiteCRM</span>
          </div>
          <p className="text-white/70 text-sm">CRM para agências de turismo</p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              Bem-vindo de volta!
            </h1>
            <p className="text-white/80 text-lg leading-relaxed">
              Acesse sua conta e continue gerenciando suas viagens, clientes e muito mais.
            </p>
          </div>

          <div className="space-y-4">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-white/90 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 bg-white/10 rounded-2xl p-4 backdrop-blur">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
              AS
            </div>
            <div>
              <p className="text-sm font-medium">"O VisiteCRM transformou nossa agência!"</p>
              <p className="text-white/60 text-xs mt-0.5">Ana Silva, Diretora — Viaje Mais Tours</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
              V
            </div>
            <span className="font-bold text-xl">VisiteCRM</span>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground">Entrar na conta</h2>
            <p className="text-muted-foreground text-sm">
              Não tem conta?{" "}
              <a href={`${basePath}/sign-up`} className="text-primary font-medium hover:underline">
                Cadastre sua agência
              </a>
            </p>
          </div>

          <SignIn
            routing="path"
            path={`${basePath}/sign-in`}
            signUpUrl={`${basePath}/sign-up`}
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-none border-0 p-0 bg-transparent",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton: "border rounded-lg h-11",
                formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground h-11 rounded-lg",
                footerAction: "hidden",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
