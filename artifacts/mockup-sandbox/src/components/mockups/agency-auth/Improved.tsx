import "./_group.css";
import { ArrowRight, CheckCircle2, Building2, Users, TrendingUp, Eye, MapPin } from "lucide-react";

const FEATURES = [
  { icon: Building2, text: "Perfil completo da sua agência" },
  { icon: Users, text: "Gestão de clientes e equipe de vendas" },
  { icon: TrendingUp, text: "Controle financeiro e comissões" },
  { icon: CheckCircle2, text: "14 dias grátis, sem cartão de crédito" },
];

function AgencyBenefits() {
  return (
    <div className="hidden min-h-screen flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-600/90 to-teal-700 p-12 text-white lg:flex lg:w-1/2">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl font-bold backdrop-blur">V</div>
          <span className="text-2xl font-bold">VisiteCRM</span>
        </div>
        <p className="text-sm text-white/70">O CRM feito para agências de turismo</p>
      </div>
      <div className="space-y-8">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            14 dias grátis — sem cartão de crédito
          </div>
          <h1 className="mb-4 text-4xl font-bold leading-tight">Comece a crescer sua agência hoje</h1>
          <p className="text-lg leading-relaxed text-white/80">
            Cadastre sua agência e tenha tudo que precisa para gerenciar viagens, clientes e equipe em um só lugar.
          </p>
        </div>
        <div className="space-y-4">
          {FEATURES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15"><Icon className="h-4 w-4" /></div>
              <span className="text-sm text-white/90">{text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-6">
        {[["500+", "Agências ativas"], ["50k+", "Clientes gerenciados"], ["R$ 12M+", "Em reservas"]].map(([value, label]) => (
          <div key={label}><p className="text-2xl font-bold">{value}</p><p className="text-xs text-white/60">{label}</p></div>
        ))}
      </div>
    </div>
  );
}

function ClerkSignUpPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="space-y-5 px-8 pb-7 pt-7">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MapPin className="h-6 w-6" />
        </div>
        <button type="button" className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border bg-card text-sm text-foreground">
          <span className="font-bold text-[#4285F4]">G</span> Continuar com Google
        </button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
        <form className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="improved-email" className="text-xs font-medium">Seu e-mail</label>
            <input id="improved-email" readOnly value="contato@agencia.exemplo" aria-invalid="true" className="h-9 w-full rounded-md border border-red-300 bg-background px-3 text-xs" />
            <p role="alert" className="flex items-start gap-1 text-xs text-red-600"><span aria-hidden="true">!</span>E-mail já está em uso. Por favor, tente outro.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="improved-password" className="text-xs font-medium">Senha</label>
            <div className="flex h-9 items-center rounded-md border bg-background px-3">
              <input id="improved-password" readOnly type="password" placeholder="Sua senha" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
              <Eye className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <button type="button" className="h-10 w-full rounded-lg bg-zinc-800 text-xs font-semibold text-white">Continuar&nbsp; ›</button>
        </form>
      </div>
      <div className="border-t border-border px-5 py-3 text-center text-xs text-muted-foreground">
        Possui uma conta? <a href="/sign-in" className="font-medium text-foreground">Entrar</a>
      </div>
      <div className="border-t border-border bg-muted/30 px-5 py-3 text-center text-[10px] text-muted-foreground">Protegido por Clerk</div>
    </div>
  );
}

export function Improved() {
  return (
    <div className="agency-auth-preview flex min-h-screen bg-background text-foreground">
      <AgencyBenefits />
      <main className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-6">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">V</div>
            <span className="text-xl font-bold">VisiteCRM</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold">Cadastrar minha agência</h2>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-sm text-muted-foreground">Já tem uma conta?</p>
              <a
                href="/sign-in?redirect_url=%2F"
                aria-label="Entrar em uma conta existente"
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Entrar
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Cadastro exclusivo para agências</p>
              <p className="mt-0.5 text-xs text-emerald-700/80">Esta tela é para agências de turismo. Clientes são cadastrados pela própria agência.</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Crie sua conta com o Google ou usando e-mail e senha.</p>
          <ClerkSignUpPreview />
        </div>
      </main>
    </div>
  );
}
