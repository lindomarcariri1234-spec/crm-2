import { SignUp } from "@clerk/react";
import { CheckCircle2, Building2, Users, TrendingUp } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const FEATURES = [
  { icon: Building2, text: "Perfil completo da sua agência" },
  { icon: Users, text: "Gestão de clientes e equipe de vendas" },
  { icon: TrendingUp, text: "Controle financeiro e comissões" },
  { icon: CheckCircle2, text: "14 dias grátis, sem cartão de crédito" },
];

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-600 via-emerald-600/90 to-teal-700 flex-col justify-between p-12 text-white relative overflow-hidden">
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
          <p className="text-white/70 text-sm">O CRM feito para agências de turismo</p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-1.5 text-sm mb-4">
              <CheckCircle2 className="w-4 h-4" />
              14 dias grátis — sem cartão de crédito
            </div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              Comece a crescer sua agência hoje
            </h1>
            <p className="text-white/80 text-lg leading-relaxed">
              Cadastre sua agência e tenha tudo que precisa para gerenciar viagens, clientes e equipe em um só lugar.
            </p>
          </div>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
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
          <div className="flex gap-6">
            {[
              { value: "500+", label: "Agências ativas" },
              { value: "50k+", label: "Clientes gerenciados" },
              { value: "R$ 12M+", label: "Em reservas" },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-white/60 text-xs">{label}</p>
              </div>
            ))}
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
            <h2 className="text-2xl font-bold text-foreground">Cadastrar minha agência</h2>
            <p className="text-muted-foreground text-sm">
              Já tem uma conta?{" "}
              <a href={`${basePath}/sign-in`} className="text-primary font-medium hover:underline">
                Fazer login
              </a>
            </p>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Cadastro exclusivo para agências</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                Esta tela é para agências de turismo. Clientes são cadastrados pela própria agência.
              </p>
            </div>
          </div>

          <SignUp
            routing="path"
            path={`${basePath}/sign-up`}
            signInUrl={`${basePath}/sign-in`}
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-none border-0 p-0 bg-transparent",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton: "border rounded-lg h-11",
                formButtonPrimary: "bg-emerald-600 hover:bg-emerald-700 text-white h-11 rounded-lg",
                footerAction: "hidden",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
