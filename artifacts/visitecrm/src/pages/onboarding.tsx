import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { CheckCircle2, Building2, CreditCard, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ApiPlan {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  monthlyPrice?: string | null;
  annualPrice?: string | null;
  maxUsers?: number | null;
  maxClients?: number | null;
  maxTrips?: number | null;
  features?: string[] | null;
  isFeatured?: boolean | null;
  sortOrder?: number | null;
}

const FALLBACK_PLANS: ApiPlan[] = [
  {
    id: "starter",
    slug: "starter",
    name: "Starter",
    description: "Ideal para agências pequenas que estão começando",
    monthlyPrice: "197",
    maxUsers: 3,
    maxClients: 500,
    maxTrips: 20,
    features: ["Até 500 clientes", "Até 20 viagens", "Até 3 usuários", "Suporte por e-mail"],
    isFeatured: false,
  },
  {
    id: "pro",
    slug: "pro",
    name: "Pro",
    description: "Para agências em crescimento com mais demanda",
    monthlyPrice: "397",
    maxUsers: 10,
    maxClients: 2000,
    maxTrips: 100,
    features: ["Até 2.000 clientes", "Até 100 viagens", "Até 10 usuários", "Suporte prioritário"],
    isFeatured: true,
  },
  {
    id: "enterprise",
    slug: "enterprise",
    name: "Enterprise",
    description: "Para grandes agências com necessidades específicas",
    monthlyPrice: null,
    maxUsers: null,
    maxClients: null,
    maxTrips: null,
    features: ["Clientes ilimitados", "Viagens ilimitadas", "Usuários ilimitados", "SLA dedicado"],
    isFeatured: false,
  },
];

function formatPlanPrice(plan: ApiPlan): string {
  if (!plan.monthlyPrice || plan.monthlyPrice === "0") return "Sob consulta";
  return `R$ ${plan.monthlyPrice}/mês`;
}

function getPlanFeatures(plan: ApiPlan): string[] {
  if (plan.features && plan.features.length > 0) return plan.features;
  const feats: string[] = [];
  if (plan.maxClients != null) feats.push(`Até ${plan.maxClients} clientes`);
  else feats.push("Clientes ilimitados");
  if (plan.maxTrips != null) feats.push(`Até ${plan.maxTrips} viagens`);
  else feats.push("Viagens ilimitadas");
  if (plan.maxUsers != null) feats.push(`Até ${plan.maxUsers} usuários`);
  else feats.push("Usuários ilimitados");
  return feats;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [plans, setPlans] = useState<ApiPlan[]>(FALLBACK_PLANS);
  const [plansLoading, setPlansLoading] = useState(true);

  const [form, setForm] = useState({
    name: "",
    cnpj: "",
    phone: "",
    slug: "",
    planId: "starter",
  });

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch(`${BASE}/api/onboarding/plans`, { credentials: "include" });
        if (res.ok) {
          const data: ApiPlan[] = await res.json();
          if (data.length > 0) {
            setPlans(data);
            setForm((f) => ({ ...f, planId: data[0]?.id ?? "starter" }));
          }
        }
      } catch {
        // keep fallback plans
      } finally {
        setPlansLoading(false);
      }
    }
    fetchPlans();
  }, []);

  useEffect(() => {
    if (user?.fullName && !form.name) {
      const name = user.fullName;
      setForm((f) => ({ ...f, name, slug: slugify(name) }));
    }
  }, [user?.fullName]);

  useEffect(() => {
    if (!form.slug || form.slug.length < 2) {
      setSlugAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingSlug(true);
      try {
        const res = await fetch(`${BASE}/api/onboarding/check-slug?slug=${encodeURIComponent(form.slug)}`);
        const data = await res.json();
        setSlugAvailable(data.available);
      } catch {
        setSlugAvailable(null);
      } finally {
        setCheckingSlug(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.slug]);

  async function handleSkip() {
    setSkipLoading(true);
    try {
      const res = await fetch(`${BASE}/api/onboarding/agency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skipSetup: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast({ title: err.error ?? "Erro ao configurar agência", variant: "destructive" });
        return;
      }

      setLocation("/dashboard");
      window.location.reload();
    } catch {
      toast({ title: "Erro de conexão. Tente novamente.", variant: "destructive" });
    } finally {
      setSkipLoading(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: "Informe o nome da agência", variant: "destructive" });
      return;
    }
    if (!form.slug.trim()) {
      toast({ title: "Informe o slug da loja", variant: "destructive" });
      return;
    }
    if (slugAvailable === false) {
      toast({ title: "Este slug já está em uso. Escolha outro.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/onboarding/agency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          cnpj: form.cnpj || undefined,
          phone: form.phone || undefined,
          slug: form.slug,
          planId: form.planId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast({ title: err.error ?? "Erro ao criar agência", variant: "destructive" });
        return;
      }

      toast({ title: "Agência criada com sucesso! Bem-vindo ao VisiteCRM!" });
      setLocation("/dashboard");
      window.location.reload();
    } catch {
      toast({ title: "Erro de conexão. Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const STEPS = [
    { number: 1, label: "Perfil da Agência", icon: Building2 },
    { number: 2, label: "Escolha o Plano", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="bg-background border-b px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
          V
        </div>
        <span className="font-bold text-lg">VisiteCRM</span>
        <Badge variant="outline" className="ml-2 text-xs">Configuração inicial</Badge>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Vamos configurar sua agência</h1>
            <p className="text-muted-foreground">
              Preencha as informações abaixo para começar a usar o VisiteCRM.
            </p>
          </div>

          <div className="flex items-center justify-center gap-4">
            {STEPS.map((s, i) => (
              <div key={s.number} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  step === s.number
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : step > s.number
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {step > s.number ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <span className="w-4 h-4 flex items-center justify-center text-xs">{s.number}</span>
                  )}
                  {s.label}
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Dados da Agência
                </CardTitle>
                <CardDescription>
                  Informe os dados básicos da sua agência. Você poderá editar depois.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nome da Agência <span className="text-destructive">*</span></Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({
                        ...f,
                        name,
                        slug: f.slug === slugify(f.name) || !f.slug ? slugify(name) : f.slug,
                      }));
                    }}
                    placeholder="Ex: Viagens Brasil Tours"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="cnpj">CNPJ</Label>
                    <Input
                      id="cnpj"
                      value={form.cnpj}
                      onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
                      placeholder="00.000.000/0001-00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="+55 (11) 99999-9999"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="slug">
                    Slug da loja <span className="text-destructive">*</span>
                    <span className="text-muted-foreground font-normal ml-1 text-xs">(URL pública da sua vitrine)</span>
                  </Label>
                  <div className="flex items-center gap-0">
                    <div className="flex items-center h-10 px-3 rounded-l-md border border-r-0 bg-muted text-muted-foreground text-sm shrink-0">
                      visitecrm.com/loja/
                    </div>
                    <Input
                      id="slug"
                      value={form.slug}
                      onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
                      placeholder="minha-agencia"
                      className="rounded-l-none"
                    />
                  </div>
                  {form.slug.length >= 2 && (
                    <div className="text-xs mt-1">
                      {checkingSlug && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Verificando...
                        </span>
                      )}
                      {!checkingSlug && slugAvailable === true && (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Slug disponível!
                        </span>
                      )}
                      {!checkingSlug && slugAvailable === false && (
                        <span className="text-destructive">Este slug já está em uso. Tente outro.</span>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={() => setStep(2)}
                  disabled={!form.name.trim() || !form.slug.trim() || slugAvailable === false || skipLoading}
                >
                  Continuar
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
                <div className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground text-xs h-auto py-1"
                    onClick={handleSkip}
                    disabled={skipLoading || loading}
                  >
                    {skipLoading ? (
                      <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Configurando...</>
                    ) : (
                      <>Pular por agora <ChevronRight className="w-3 h-3 ml-1" /></>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Escolha seu plano
                  </CardTitle>
                  <CardDescription>
                    Todos os planos incluem 14 dias grátis. Você pode mudar a qualquer momento.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {plansLoading ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Carregando planos...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {plans.map((plan) => {
                        const planKey = plan.id;
                        const features = getPlanFeatures(plan);
                        const priceLabel = formatPlanPrice(plan);
                        return (
                          <button
                            key={planKey}
                            onClick={() => setForm((f) => ({ ...f, planId: planKey }))}
                            className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                              form.planId === planKey
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            }`}
                          >
                            {plan.isFeatured && (
                              <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs bg-primary">
                                Popular
                              </Badge>
                            )}
                            <div className="space-y-3">
                              <div>
                                <h3 className="font-bold text-base">{plan.name}</h3>
                                {plan.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-emerald-600">Grátis por 14 dias</p>
                                <p className="text-xs text-muted-foreground">depois {priceLabel}</p>
                              </div>
                              <ul className="space-y-1.5">
                                {features.slice(0, 4).map((f) => (
                                  <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            {form.planId === planKey && (
                              <div className="absolute top-3 right-3">
                                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                  <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1" disabled={loading || skipLoading}>
                  Voltar
                </Button>
                <Button onClick={handleSubmit} disabled={loading || skipLoading} className="flex-1">
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Criando sua agência...
                    </>
                  ) : (
                    <>
                      Começar gratuitamente
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
              <div className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground text-xs h-auto py-1"
                  onClick={handleSkip}
                  disabled={skipLoading || loading}
                >
                  {skipLoading ? (
                    <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Configurando...</>
                  ) : (
                    <>Pular por agora <ChevronRight className="w-3 h-3 ml-1" /></>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
