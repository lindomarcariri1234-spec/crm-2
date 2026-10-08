import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { CoverImageUpload } from "@/components/cover-image-upload";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreSettings, InitStoreInput } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Store,
  Globe,
  Palette,
  Phone,
  CreditCard,
  ExternalLink,
  Loader2,
  CheckCircle,
  Bell,
  FileText,
  Search,
  Link2,
  AlertTriangle,
  QrCode,
  Download,
  Copy,
  Share2,
  Eye,
  EyeOff,
} from "lucide-react";
import QRCodeLib from "qrcode";
import {
  normalizePixKey,
  validatePixManualConfig,
  type PixKeyType,
} from "@/lib/pix-manual-config";
import {
  getStripeCredentialMode,
  isStripeSupportedPaymentMethod,
  shouldWarnAboutPublishedStripeTestKey,
  STRIPE_STORE_PAYMENT_METHODS,
  validateStripeStoreConfig,
} from "@/lib/stripe-store-config";

const PIX_KEY_GUIDANCE: Record<string, { placeholder: string; hint: string }> = {
  cpf: {
    placeholder: "Ex.: 123.456.789-09",
    hint: "Informe o CPF de 11 dígitos cadastrado como chave Pix.",
  },
  cnpj: {
    placeholder: "Ex.: 12.345.678/0001-95",
    hint: "Informe o CNPJ de 14 caracteres cadastrado como chave Pix.",
  },
  email: {
    placeholder: "Ex.: financeiro@empresa.com.br",
    hint: "Informe o endereço de e-mail cadastrado como chave Pix.",
  },
  phone: {
    placeholder: "Ex.: +55 (11) 99999-9999",
    hint: "Informe o telefone com DDD; números brasileiros locais serão salvos no formato +55.",
  },
  random: {
    placeholder: "UUID completo da chave Pix",
    hint: "Cole o UUID completo gerado pelo banco, com ou sem hífens.",
  },
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function StoreWizard({ onCreated }: { onCreated: (s: StoreSettings) => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<InitStoreInput & { paymentMethods: string[] }>({
    name: "",
    slug: "",
    contactEmail: "",
    contactWhatsapp: "",
    paymentMethods: [],
  });

  useEffect(() => {
    fetch(`${BASE_URL}/api/users/me`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.tenant?.name || data?.tenant?.slug) {
          setForm((prev) => ({
            ...prev,
            name: prev.name || data.tenant.name || "",
            slug: prev.slug || data.tenant.slug || "",
          }));
        }
      })
      .catch(() => {});
  }, []);

  function set(field: string, value: unknown) {
    if (field === "name") {
      setForm((p) => ({ ...p, name: value as string, slug: !p.slug ? slugify(value as string) : p.slug }));
    } else {
      setForm((p) => ({ ...p, [field]: value }));
    }
  }

  function togglePayment(method: string) {
    setForm((p) => ({
      ...p,
      paymentMethods: p.paymentMethods.includes(method)
        ? p.paymentMethods.filter((m) => m !== method)
        : [...p.paymentMethods, method],
    }));
  }

  async function submit() {
    if (!form.name || !form.slug) {
      toast({ title: "Preencha nome e slug", variant: "destructive" });
      return;
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      toast({ title: "E-mail inválido", variant: "destructive" });
      return;
    }
    setLoading(true);
    const payload: InitStoreInput = {
      name: form.name,
      slug: form.slug,
      contactEmail: form.contactEmail || undefined,
      contactWhatsapp: form.contactWhatsapp || undefined,
      paymentMethods: form.paymentMethods,
    };
    try {
      const store = await storeApi.initStore(payload);
      toast({ title: "Loja criada com sucesso!" });
      onCreated(store);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not provisioned/i.test(msg)) {
        toast({
          title: "Cadastro de agência incompleto",
          description: "Conclua o cadastro da sua agência antes de criar a loja.",
          variant: "destructive",
        });
        setLocation("/onboarding");
      } else {
        toast({
          title: "Erro ao criar loja",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  const paymentOptions = [
    { id: "pix", label: "PIX" },
    { id: "boleto", label: "Boleto Bancário" },
    { id: "credit_card", label: "Cartão de Crédito" },
    { id: "debit_card", label: "Cartão de Débito" },
    { id: "transfer", label: "Transferência Bancária" },
  ];

  return (
    <div className="max-w-xl mx-auto py-12">
      <div className="mb-8 text-center">
        <Store className="w-16 h-16 mx-auto mb-4 text-primary" />
        <h1 className="text-3xl font-bold">Crie sua Loja Online</h1>
        <p className="text-muted-foreground mt-2">
          Configure sua vitrine e comece a vender em minutos.
        </p>
      </div>

      <div className="flex gap-2 justify-center mb-8">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 w-16 rounded-full transition-colors ${
              s <= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Passo 1 — Identidade da Loja</CardTitle>
            <CardDescription>Como sua loja vai aparecer para os clientes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Loja *</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ex: Viagens Fantásticas"
              />
            </div>
            <div className="space-y-2">
              <Label>URL da Loja (slug) *</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm whitespace-nowrap">visitecrm.com/loja/</span>
                <Input
                  value={form.slug}
                  onChange={(e) => set("slug", slugify(e.target.value))}
                  placeholder="viagens-fantasticas"
                />
              </div>
              {form.slug && (
                <p className="text-xs text-muted-foreground">
                  Sua loja ficará em: <span className="font-mono text-primary">/loja/{form.slug}</span>
                </p>
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => setStep(2)}
              disabled={!form.name || !form.slug}
            >
              Próximo
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Passo 2 — Contato</CardTitle>
            <CardDescription>Como os clientes podem entrar em contato com você.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>E-mail de Contato</Label>
              <Input
                type="email"
                value={form.contactEmail ?? ""}
                onChange={(e) => set("contactEmail", e.target.value)}
                placeholder="contato@agencia.com"
              />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp</Label>
              <Input
                value={form.contactWhatsapp ?? ""}
                onChange={(e) => set("contactWhatsapp", e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Próximo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Passo 3 — Formas de Pagamento</CardTitle>
            <CardDescription>Quais formas de pagamento você aceita?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {paymentOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => togglePayment(opt.id)}
                  className={`p-3 rounded-lg border text-sm font-medium transition-colors text-left ${
                    form.paymentMethods.includes(opt.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {form.paymentMethods.includes(opt.id) && (
                    <CheckCircle className="w-4 h-4 inline mr-1" />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                Voltar
              </Button>
              <Button className="flex-1" onClick={submit} disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Criar Loja
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function LojaConfiguracoes() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const isUploading = uploadingCount > 0;
  const handleUploadingChange = (uploading: boolean) =>
    setUploadingCount((prev) => (uploading ? prev + 1 : Math.max(0, prev - 1)));
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState<Partial<StoreSettings>>({});
  const [testingStripeConnection, setTestingStripeConnection] = useState(false);
  const [stripeConnectionResult, setStripeConnectionResult] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [showPixKey, setShowPixKey] = useState(false);

  const generateQr = useCallback(async (slug: string, updatedAt: string) => {
    const cacheVersion = Date.parse(updatedAt);
    const version = Number.isFinite(cacheVersion) ? String(cacheVersion) : encodeURIComponent(updatedAt);
    const fullUrl = `${window.location.origin}/loja/${slug}?v=${version}`;
    try {
      const dataUrl = await QRCodeLib.toDataURL(fullUrl, {
        width: 300,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl("");
    }
  }, []);

  useEffect(() => {
    storeApi
      .getSettings()
      .then((s) => {
        setStore(s);
        setForm(s);
        generateQr(s.slug, s.updatedAt);
      })
      .catch(() => setStore(null))
      .finally(() => setLoading(false));
  }, [generateQr]);

  function set(field: string, value: unknown) {
    setForm((p) => ({ ...p, [field]: value }));
    if (field === "stripePublicKey" || field === "stripeSecretKey") {
      setStripeConnectionResult(null);
    }
  }

  async function save() {
    const pixKey = typeof form.pixKey === "string" ? form.pixKey : "";
    const pixKeyType = typeof form.pixKeyType === "string" ? form.pixKeyType : "";
    const pixSettingsChanged = Boolean(pixKey.trim())
      || (form.pixEnabled ?? false) !== (store?.pixEnabled ?? false)
      || (form.pixKeyType ?? null) !== (store?.pixKeyType ?? null);
    const pixValidationError = validatePixManualConfig({
      enabled: form.pixEnabled ?? false,
      keyConfigured: form.pixKeyConfigured ?? false,
      key: pixKey,
      keyType: pixKeyType,
      storedKeyType: store?.pixKeyType,
    });

    if (pixSettingsChanged && pixValidationError) {
      toast({
        title: "Revise a configuração do Pix Manual",
        description: pixValidationError,
        variant: "destructive",
      });
      return;
    }

    const paymentMethods = (form.paymentMethods as string[] | undefined) ?? [];
    const storedPaymentMethods = store?.paymentMethods ?? [];
    const stripeSettingsChanged =
      (form.stripeEnabled ?? false) !== (store?.stripeEnabled ?? false)
      || (form.stripePublicKey ?? "") !== (store?.stripePublicKey ?? "")
      || Boolean(typeof form.stripeSecretKey === "string" && form.stripeSecretKey.trim())
      || Boolean(typeof form.stripeWebhookSecret === "string" && form.stripeWebhookSecret.trim())
      || STRIPE_STORE_PAYMENT_METHODS.some(
        (method) => paymentMethods.includes(method) !== storedPaymentMethods.includes(method),
      );
    const stripeIssues = validateStripeStoreConfig({
      enabled: form.stripeEnabled ?? false,
      paymentMethods,
      publishableKey: form.stripePublicKey,
      secretKey: form.stripeSecretKey,
      secretKeyConfigured: form.stripeSecretKeyConfigured ?? false,
      webhookSecret: form.stripeWebhookSecret,
      previousPublishableKey: store?.stripePublicKey,
    });
    if (stripeSettingsChanged && stripeIssues.length > 0) {
      toast({
        title: "Revise a configuração do Stripe",
        description: stripeIssues[0]?.message,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const updatePayload: Partial<StoreSettings> = { ...form };
      if (pixKey.trim()) {
        updatePayload.pixKey = normalizePixKey(pixKey, pixKeyType as PixKeyType);
        updatePayload.pixKeyType = pixKeyType;
      } else {
        // A blank value means "keep the encrypted key already stored".
        delete updatePayload.pixKey;
      }
      if (typeof form.stripePublicKey === "string") {
        updatePayload.stripePublicKey = form.stripePublicKey.trim();
      }
      if (typeof form.stripeSecretKey === "string" && form.stripeSecretKey.trim()) {
        updatePayload.stripeSecretKey = form.stripeSecretKey.trim();
      } else {
        // Stripe secrets are write-only; an empty field must not replace the saved credential.
        delete updatePayload.stripeSecretKey;
      }
      if (typeof form.stripeWebhookSecret === "string" && form.stripeWebhookSecret.trim()) {
        updatePayload.stripeWebhookSecret = form.stripeWebhookSecret.trim();
      } else {
        delete updatePayload.stripeWebhookSecret;
      }
      await storeApi.updateSettings(updatePayload);
      // Re-read the row without browser/intermediary cache so the form always
      // reflects the version that is actually persisted by the server.
      const latest = await storeApi.getSettings();
      setStore(latest);
      setForm(latest);
      await generateQr(latest.slug, latest.updatedAt);
      toast({ title: "Configurações salvas com sucesso!" });
    } catch (err: unknown) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function testStripeConnection() {
    const secretKey = typeof form.stripeSecretKey === "string"
      ? form.stripeSecretKey.trim()
      : "";
    const secretMode = getStripeCredentialMode(secretKey);
    const publishableMode = getStripeCredentialMode(form.stripePublicKey);
    if (secretMode && publishableMode && secretMode !== publishableMode) {
      setStripeConnectionResult({
        kind: "error",
        message: "A chave pública e a chave secreta precisam ser do mesmo ambiente (teste ou produção).",
      });
      return;
    }

    setTestingStripeConnection(true);
    setStripeConnectionResult(null);
    try {
      const result = await storeApi.testStripeConnection(
        secretKey ? { secretKey } : {},
      );
      setStripeConnectionResult({
        kind: "success",
        message: `Conexão verificada no ambiente de ${result.livemode ? "produção" : "teste"}.`,
      });
    } catch (err: unknown) {
      setStripeConnectionResult({
        kind: "error",
        message: err instanceof Error
          ? err.message
          : "Não foi possível validar a conexão com o Stripe. Tente novamente.",
      });
    } finally {
      setTestingStripeConnection(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!store) {
    return <StoreWizard onCreated={(s) => { setStore(s); setForm(s); }} />;
  }

  const paymentOptions = [
    { id: "pix", label: "PIX" },
    { id: "boleto", label: "Boleto Bancário" },
    { id: "credit_card", label: "Cartão de Crédito" },
    { id: "debit_card", label: "Cartão de Débito" },
    { id: "transfer", label: "Transferência Bancária" },
  ];

  function togglePayment(method: string) {
    const current = (form.paymentMethods as string[]) ?? [];
    set(
      "paymentMethods",
      current.includes(method)
        ? current.filter((m) => m !== method)
        : [...current, method]
    );
  }

  const storeUrl = `/loja/${store.slug}`;
  const shareCacheVersion = Date.parse(store.updatedAt);
  const shareVersion = Number.isFinite(shareCacheVersion)
    ? String(shareCacheVersion)
    : encodeURIComponent(store.updatedAt);
  const shareUrl = `${window.location.origin}${storeUrl}?v=${shareVersion}`;
  const paymentMethodsSelected = (form.paymentMethods as string[]) ?? [];
  const stripePaymentMethodsSelected = paymentMethodsSelected.filter(isStripeSupportedPaymentMethod);
  const stripeCredentialIssues = validateStripeStoreConfig({
    enabled: form.stripeEnabled ?? false,
    paymentMethods: paymentMethodsSelected,
    publishableKey: form.stripePublicKey,
    secretKey: form.stripeSecretKey,
    secretKeyConfigured: form.stripeSecretKeyConfigured ?? false,
    webhookSecret: form.stripeWebhookSecret,
    previousPublishableKey: store?.stripePublicKey,
  });
  const stripePublicKeyMode = getStripeCredentialMode(form.stripePublicKey);
  const publishedStripeTestKeyWarning = shouldWarnAboutPublishedStripeTestKey(
    import.meta.env.PROD,
    form.stripePublicKey,
  );
  const stripeWebhookUrl = store?.slug
    ? `${window.location.origin}${BASE_URL}/api/webhooks/stripe/${encodeURIComponent(store.slug)}`
    : "";
  const stripePublicKeyIssue = stripeCredentialIssues.find((issue) => issue.field === "publishableKey");
  const stripeSecretKeyIssue = stripeCredentialIssues.find((issue) => issue.field === "secretKey");
  const stripeWebhookSecretIssue = stripeCredentialIssues.find((issue) => issue.field === "webhookSecret");

  async function copyStripeWebhookUrl() {
    if (!stripeWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(stripeWebhookUrl);
      toast({ title: "URL do webhook copiada" });
    } catch {
      toast({
        title: "Não foi possível copiar a URL",
        description: "Selecione e copie o endereço exibido abaixo.",
        variant: "destructive",
      });
    }
  }
  const pixKeyValue = typeof form.pixKey === "string" ? form.pixKey : "";
  const pixKeyType = typeof form.pixKeyType === "string" ? form.pixKeyType : "";
  const pixKeyValidationError = validatePixManualConfig({
    enabled: form.pixEnabled ?? false,
    keyConfigured: form.pixKeyConfigured ?? false,
    key: pixKeyValue,
    keyType: pixKeyType,
    storedKeyType: store.pixKeyType,
  });
  const hasPendingPixKey = pixKeyValue.trim().length > 0;
  const pixKeyTypeChanged = (form.pixKeyType ?? null) !== (store.pixKeyType ?? null);
  const showPixValidationError = Boolean(
    pixKeyValidationError && (form.pixEnabled || hasPendingPixKey || pixKeyTypeChanged),
  );
  const pixKeyGuidance = PIX_KEY_GUIDANCE[pixKeyType] ?? {
    placeholder: "Informe a chave cadastrada no seu banco",
    hint: "Escolha o tipo correspondente ao cadastro da chave no banco.",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Configurações da Loja</h1>
          <div className="flex items-center gap-2 mt-1">
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <Globe className="w-3 h-3" />
              {store.slug}
              <ExternalLink className="w-3 h-3" />
            </a>
            <Badge variant={store.isActive ? "default" : "secondary"}>
              {store.isActive ? "Ativa" : "Inativa"}
            </Badge>
            {store.maintenanceMode && (
              <Badge variant="destructive">Em Manutenção</Badge>
            )}
          </div>
        </div>
        <Button onClick={save} disabled={saving || isUploading}>
          {(saving || isUploading) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isUploading ? "Aguardando upload..." : "Salvar Alterações"}
        </Button>
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="geral">
            <Store className="w-4 h-4 mr-1.5" />
            Geral
          </TabsTrigger>
          <TabsTrigger value="aparencia">
            <Palette className="w-4 h-4 mr-1.5" />
            Aparência
          </TabsTrigger>
          <TabsTrigger value="contato">
            <Phone className="w-4 h-4 mr-1.5" />
            Contato
          </TabsTrigger>
          <TabsTrigger value="seo">
            <Search className="w-4 h-4 mr-1.5" />
            SEO
          </TabsTrigger>
          <TabsTrigger value="dominio">
            <Link2 className="w-4 h-4 mr-1.5" />
            Domínio
          </TabsTrigger>
          <TabsTrigger value="pagamento">
            <CreditCard className="w-4 h-4 mr-1.5" />
            Pagamentos
          </TabsTrigger>
          <TabsTrigger value="politicas">
            <FileText className="w-4 h-4 mr-1.5" />
            Políticas
          </TabsTrigger>
          <TabsTrigger value="notificacoes">
            <Bell className="w-4 h-4 mr-1.5" />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="compartilhar">
            <Share2 className="w-4 h-4 mr-1.5" />
            Compartilhar
          </TabsTrigger>
        </TabsList>

        {/* ── GERAL ── */}
        <TabsContent value="geral" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Informações da Loja</CardTitle>
              <CardDescription>Nome, slug e descrição pública.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome da Loja</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Slug (URL)</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">/loja/</span>
                    <Input
                      value={form.slug ?? ""}
                      onChange={(e) => set("slug", slugify(e.target.value))}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tagline</Label>
                <Input
                  value={form.tagline ?? ""}
                  onChange={(e) => set("tagline", e.target.value)}
                  placeholder="Slogan ou frase de destaque"
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                  rows={3}
                  placeholder="Descreva sua loja para os visitantes..."
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status da Loja</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Loja Ativa</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Permite que os clientes acessem e comprem.</p>
                </div>
                <Switch
                  checked={form.isActive ?? true}
                  onCheckedChange={(v) => set("isActive", v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Modo Manutenção</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Exibe uma mensagem de manutenção para visitantes.</p>
                </div>
                <Switch
                  checked={form.maintenanceMode ?? false}
                  onCheckedChange={(v) => set("maintenanceMode", v)}
                />
              </div>
              {form.maintenanceMode && (
                <div className="space-y-2">
                  <Label>Mensagem de Manutenção</Label>
                  <Input
                    value={form.maintenanceMessage ?? ""}
                    onChange={(e) => set("maintenanceMessage", e.target.value)}
                    placeholder="Estamos em manutenção, voltamos em breve!"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── APARÊNCIA ── */}
        <TabsContent value="aparencia" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Cores da Marca</CardTitle>
              <CardDescription>Personalize as cores que aparecem na sua vitrine.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { field: "primaryColor", label: "Cor Principal", default: "#3B82F6" },
                  { field: "secondaryColor", label: "Cor Secundária", default: "#10B981" },
                  { field: "accentColor", label: "Cor de Destaque", default: "#F59E0B" },
                ].map(({ field, label, default: def }) => (
                  <div key={field} className="space-y-2">
                    <Label>{label}</Label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={(form as Record<string, string>)[field] ?? def}
                        onChange={(e) => set(field, e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border"
                      />
                      <Input
                        value={(form as Record<string, string>)[field] ?? def}
                        onChange={(e) => set(field, e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Imagens</CardTitle>
              <CardDescription>Envie o logo e o banner da sua loja (PNG, JPG, WEBP).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="space-y-2">
                <Label>Logo da Loja</Label>
                <p className="text-xs text-muted-foreground">Recomendado: fundo transparente (PNG) · máx. 2 MB</p>
                <CoverImageUpload
                  fileSizeMB="2"
                  value={form.logo ?? ""}
                  onChange={(url) => set("logo", url)}
                  onUploadingChange={handleUploadingChange}
                  disabled={saving}
                  previewClassName="h-24"
                  objectFit="contain"
                  emptyLabel="Clique ou arraste o logo aqui"
                />
              </div>
              <div className="space-y-2">
                <Label>Banner Principal</Label>
                <p className="text-xs text-muted-foreground">Exibido na página inicial da sua vitrine · máx. 4 MB</p>
                <CoverImageUpload
                  value={form.bannerHome ?? ""}
                  onChange={(url) => set("bannerHome", url)}
                  onUploadingChange={handleUploadingChange}
                  disabled={saving}
                  previewClassName="h-48"
                  objectFit="cover"
                  emptyLabel="Clique ou arraste o banner aqui"
                />
              </div>
              <div className="space-y-2">
                <Label>Banner Mobile</Label>
                <p className="text-xs text-muted-foreground">
                  Versão otimizada para smartphones (&lt;640 px) · máx. 4 MB.{" "}
                  Se não definido, o banner principal é usado em todos os dispositivos.
                </p>
                <CoverImageUpload
                  value={form.bannerMobile ?? ""}
                  onChange={(url) => set("bannerMobile", url)}
                  onUploadingChange={handleUploadingChange}
                  disabled={saving}
                  previewClassName="h-40"
                  objectFit="cover"
                  emptyLabel="Clique ou arraste o banner mobile aqui"
                />
              </div>
            </CardContent>
          </Card>

          {/* ── PREVIEW ── */}
          {(() => {
            const primaryColor = (form as Record<string, string>)["primaryColor"] ?? "#3B82F6";
            const secondaryColor = (form as Record<string, string>)["secondaryColor"] ?? "#10B981";
            const accentColor = (form as Record<string, string>)["accentColor"] ?? "#F59E0B";
            const activeBanner = previewMode === "mobile"
              ? (form.bannerMobile || form.bannerHome || "")
              : (form.bannerHome || "");
            return (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Pré-visualização da Vitrine</CardTitle>
                      <CardDescription className="mt-1">Hero da sua loja — atualiza em tempo real conforme você edita.</CardDescription>
                    </div>
                    <div className="flex rounded-lg border overflow-hidden shrink-0 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("desktop")}
                        className={`px-3 py-1.5 transition-colors ${previewMode === "desktop" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        Desktop
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("mobile")}
                        className={`px-3 py-1.5 transition-colors border-l ${previewMode === "mobile" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                      >
                        Mobile
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`transition-all duration-300 ${previewMode === "mobile" ? "max-w-[320px]" : "max-w-full"} mx-auto`}>
                    <div className="rounded-xl border overflow-hidden shadow-sm select-none">
                      {/* Navbar */}
                      <div className="h-10 flex items-center px-4 gap-3" style={{ background: primaryColor }}>
                        {form.logo ? (
                          <img src={form.logo} alt="logo" className="h-6 w-auto max-w-[80px] rounded object-contain bg-white/10 p-0.5" />
                        ) : (
                          <div className="w-6 h-6 bg-white/20 rounded shrink-0" />
                        )}
                        <span className="text-white text-sm font-semibold truncate">{form.name ?? "Minha Loja"}</span>
                        {previewMode === "desktop" && (
                          <div className="ml-auto flex gap-2">
                            <div className="w-12 h-2 rounded-full bg-white/30" />
                            <div className="w-12 h-2 rounded-full bg-white/30" />
                            <div className="w-12 h-2 rounded-full bg-white/30" />
                          </div>
                        )}
                      </div>
                      {/* Hero */}
                      <div className="relative overflow-hidden flex flex-col items-center justify-end text-center p-4" style={{ height: previewMode === "mobile" ? "140px" : "160px" }}>
                        {activeBanner ? (
                          <img
                            key={activeBanner}
                            src={activeBanner}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div
                            className="absolute inset-0"
                            style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
                          />
                        )}
                        <div
                          className="absolute inset-0"
                          style={{
                            background: activeBanner
                              ? "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.60) 100%)"
                              : "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.20) 100%)",
                          }}
                        />
                        <div className="relative z-10 flex flex-col items-center gap-1.5">
                          {form.logo && (
                            <img
                              src={form.logo}
                              alt="logo"
                              className="h-10 w-auto max-w-[120px] rounded-xl bg-white/95 p-1.5 shadow mb-1 object-contain"
                            />
                          )}
                          <div className="h-3 w-36 rounded-full bg-white/80" />
                          <div className="h-2 w-48 rounded-full bg-white/50" />
                          <div className="flex gap-2 mt-2">
                            <div
                              className="h-6 px-3 rounded-full flex items-center text-xs font-semibold bg-white"
                              style={{ color: primaryColor }}
                            >
                              Explorar
                            </div>
                            <div className="h-6 px-3 rounded-full flex items-center text-xs font-semibold border-2 border-white text-white">
                              Contato
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* Product cards */}
                      <div className="p-3 grid grid-cols-2 gap-2 bg-gray-50">
                        {[primaryColor, secondaryColor].map((color, i) => (
                          <div key={i} className="rounded-xl bg-white border overflow-hidden shadow-sm">
                            <div className="h-12" style={{ background: color + "33" }} />
                            <div className="p-2 space-y-1.5">
                              <div className="h-2 w-16 rounded-full bg-gray-200" />
                              <div className="flex items-center justify-between">
                                <div className="h-2 w-10 rounded-full" style={{ background: accentColor + "80" }} />
                                <div className="h-4 w-12 rounded-full" style={{ background: color }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {!activeBanner && (
                      <p className="text-center text-xs text-muted-foreground mt-2">
                        Adicione um banner acima para ver o hero com imagem.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        {/* ── CONTATO ── */}
        <TabsContent value="contato" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Informações de Contato</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>E-mail de Contato</Label>
                <Input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="contato@agencia.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(11) 3333-4444"
                />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp</Label>
                <Input
                  value={form.whatsapp ?? ""}
                  onChange={(e) => set("whatsapp", e.target.value)}
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div className="space-y-2">
                <Label>Endereço</Label>
                <Input
                  value={form.address ?? ""}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Rua, número, cidade - Estado"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Redes Sociais</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Instagram</Label>
                <Input
                  value={form.instagramUrl ?? ""}
                  onChange={(e) => set("instagramUrl", e.target.value)}
                  placeholder="https://instagram.com/minhaagencia"
                />
              </div>
              <div className="space-y-2">
                <Label>Facebook</Label>
                <Input
                  value={form.facebookUrl ?? ""}
                  onChange={(e) => set("facebookUrl", e.target.value)}
                  placeholder="https://facebook.com/minhaagencia"
                />
              </div>
              <div className="space-y-2">
                <Label>YouTube</Label>
                <Input
                  value={form.youtubeUrl ?? ""}
                  onChange={(e) => set("youtubeUrl", e.target.value)}
                  placeholder="https://youtube.com/c/minhaagencia"
                />
              </div>
              <div className="space-y-2">
                <Label>TikTok</Label>
                <Input
                  value={form.tiktokUrl ?? ""}
                  onChange={(e) => set("tiktokUrl", e.target.value)}
                  placeholder="https://tiktok.com/@minhaagencia"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SEO ── */}
        <TabsContent value="seo" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>SEO e Metatags</CardTitle>
              <CardDescription>Dados exibidos no Google e compartilhamentos em redes sociais.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-2">
                <Label>Título SEO (meta title)</Label>
                <Input
                  value={form.metaTitle ?? ""}
                  onChange={(e) => set("metaTitle", e.target.value)}
                  placeholder={`${form.name ?? "Minha Loja"} — Pacotes e Viagens`}
                />
                <p className="text-xs text-muted-foreground">Ideal entre 50–60 caracteres. ({(form.metaTitle ?? "").length}/60)</p>
              </div>
              <div className="space-y-2">
                <Label>Meta Descrição</Label>
                <Textarea
                  value={form.metaDescription ?? ""}
                  onChange={(e) => set("metaDescription", e.target.value)}
                  rows={3}
                  placeholder="Descrição que aparece nos resultados de busca..."
                />
                <p className="text-xs text-muted-foreground">Ideal entre 120–160 caracteres. ({(form.metaDescription ?? "").length}/160)</p>
              </div>
              <div className="space-y-2">
                <Label>Palavras-chave</Label>
                <Input
                  value={form.metaKeywords ?? ""}
                  onChange={(e) => set("metaKeywords", e.target.value)}
                  placeholder="viagens, pacotes, turismo, férias"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DOMÍNIO ── */}
        <TabsContent value="dominio" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Domínio Personalizado</CardTitle>
              <CardDescription>Aponte seu domínio próprio para esta loja.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Domínio Personalizado</Label>
                <Input
                  value={form.customDomain ?? ""}
                  onChange={(e) => set("customDomain", e.target.value)}
                  placeholder="www.minhaagencia.com.br"
                />
              </div>
              {form.customDomain && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800 space-y-1">
                    <p className="font-medium">Configuração de DNS necessária</p>
                    <p>Aponte o registro <span className="font-mono">CNAME</span> do domínio <strong>{form.customDomain}</strong> para:</p>
                    <p className="font-mono bg-amber-100 px-2 py-1 rounded">cname.visitecrm.com.br</p>
                    <p className="text-xs text-amber-600">A propagação pode levar até 48 horas.</p>
                  </div>
                </div>
              )}
              {store.domainVerified && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Domínio verificado e ativo
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  URL padrão: <span className="font-mono text-primary">/loja/{form.slug}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PAGAMENTOS ── */}
        <TabsContent value="pagamento" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Configurações de Pagamento</CardTitle>
              <CardDescription>Opções de parcelamento e valor mínimo de reserva.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valor mínimo do pedido (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.minOrderValue ?? ""}
                    onChange={(e) => set("minOrderValue", e.target.value || null)}
                    placeholder="0,00"
                  />
                  <p className="text-xs text-muted-foreground">Pedidos abaixo deste valor não podem ser finalizados.</p>
                </div>
                <div className="space-y-2">
                  <Label>Valor Mínimo de Reserva (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.minDepositAmount ?? ""}
                    onChange={(e) => set("minDepositAmount", e.target.value || null)}
                    placeholder="0,00"
                    data-testid="min-deposit-amount"
                  />
                  <p className="text-xs text-muted-foreground">Permite que clientes paguem apenas este valor mínimo no checkout. O restante será cobrado posteriormente. Deixe em branco para exigir pagamento integral.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Métodos Aceitos</CardTitle>
              <CardDescription>Selecione as formas de pagamento disponíveis na sua loja.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {paymentOptions.map((opt) => {
                  const selected = paymentMethodsSelected.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => togglePayment(opt.id)}
                      className={`p-4 rounded-lg border text-sm font-medium transition-colors text-left ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {selected && <CheckCircle className="w-4 h-4 inline mr-2" />}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Stripe */}
          <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Stripe</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={
                      !(form.stripeEnabled ?? false)
                        ? "secondary"
                        : stripePaymentMethodsSelected.length === 0 || stripeCredentialIssues.length > 0
                          ? "destructive"
                          : "default"
                    }>
                      {!(form.stripeEnabled ?? false)
                        ? "Desativado"
                        : stripePaymentMethodsSelected.length === 0
                          ? "Nenhum método Stripe selecionado"
                          : stripeCredentialIssues.length > 0
                            ? "Configuração incompleta"
                            : "Stripe ativo"}
                    </Badge>
                    {stripePublicKeyMode && (
                      <Badge variant="outline">
                        {stripePublicKeyMode === "test" ? "Ambiente de teste" : "Ambiente de produção"}
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription>
                  Configure e teste as credenciais antes de ativar cobranças. A conexão pode ser verificada sem salvar uma chave nova.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {publishedStripeTestKeyWarning && (
                  <div
                    role="status"
                    data-testid="published-stripe-test-key-warning"
                    className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-medium">Esta versão publicada está configurada para testes do Stripe.</p>
                      <p className="text-muted-foreground">
                        Se o Stripe estiver ativado, os pagamentos no checkout usarão o ambiente de teste e não gerarão cobranças reais.
                        A ativação continua permitida; para cobrar clientes, configure as chaves de produção.
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="stripe-enabled">Ativar Stripe</Label>
                  <Switch
                    id="stripe-enabled"
                    data-testid="stripe-enabled"
                    checked={form.stripeEnabled ?? false}
                    onCheckedChange={(v) => set("stripeEnabled", v)}
                  />
                </div>
                {form.stripeEnabled && stripePaymentMethodsSelected.length === 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                    Selecione cartão, Pix ou boleto em “Métodos Aceitos” para oferecer pagamentos processados pelo Stripe.
                  </div>
                )}
                  <div className="grid gap-4">
                    {stripeCredentialIssues.length > 0 && (
                      <div
                        role="alert"
                        className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                      >
                        <p className="mb-1 font-medium">Revise as credenciais antes de salvar:</p>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                          {stripeCredentialIssues.map((issue) => (
                            <li key={issue.field}>{issue.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="stripe-public-key">Chave pública</Label>
                        <Input
                          id="stripe-public-key"
                          data-testid="stripe-public-key"
                          autoComplete="off"
                          spellCheck={false}
                          value={form.stripePublicKey ?? ""}
                          onChange={(e) => set("stripePublicKey", e.target.value)}
                          placeholder="pk_test_... ou pk_live_..."
                          className="font-mono text-sm"
                          aria-invalid={Boolean(stripePublicKeyIssue)}
                          aria-describedby={stripePublicKeyIssue ? "stripe-public-key-error" : undefined}
                        />
                        {stripePublicKeyIssue ? (
                          <p id="stripe-public-key-error" className="text-xs text-destructive">
                            {stripePublicKeyIssue.message}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            A chave pública é exibida no checkout. Use o mesmo ambiente da chave secreta.
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label htmlFor="stripe-secret-key">Chave secreta</Label>
                          <Badge variant={form.stripeSecretKeyConfigured || form.stripeSecretKey ? "secondary" : "outline"}>
                            {form.stripeSecretKey?.trim()
                              ? "Nova chave informada"
                              : form.stripeSecretKeyConfigured
                                ? "Chave salva"
                                : "Não configurada"}
                          </Badge>
                        </div>
                        <Input
                          id="stripe-secret-key"
                          data-testid="stripe-secret-key"
                          type="password"
                          autoComplete="new-password"
                          spellCheck={false}
                          value={form.stripeSecretKey ?? ""}
                          onChange={(e) => set("stripeSecretKey", e.target.value)}
                          placeholder={form.stripeSecretKeyConfigured
                            ? "Deixe vazio para manter a chave salva"
                            : "sk_test_... ou sk_live_..."}
                          className="font-mono text-sm"
                          aria-invalid={Boolean(stripeSecretKeyIssue)}
                          aria-describedby={stripeSecretKeyIssue ? "stripe-secret-key-error" : "stripe-secret-key-hint"}
                        />
                        {stripeSecretKeyIssue ? (
                          <p id="stripe-secret-key-error" className="text-xs text-destructive">
                            {stripeSecretKeyIssue.message}
                          </p>
                        ) : (
                          <p id="stripe-secret-key-hint" className="text-xs text-muted-foreground">
                            A chave salva nunca é exibida. Deixe o campo vazio para mantê-la; uma chave nova substitui a atual.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={testStripeConnection}
                        disabled={testingStripeConnection}
                        data-testid="test-stripe-connection"
                      >
                        {testingStripeConnection
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <CreditCard className="mr-2 h-4 w-4" />}
                        {testingStripeConnection ? "Testando conexão..." : "Testar conexão"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Usa a nova chave digitada; deixe o campo vazio para testar a chave salva. O teste não altera as configurações.
                      </p>
                      {stripeConnectionResult && (
                        <p
                          role={stripeConnectionResult.kind === "error" ? "alert" : "status"}
                          aria-live="polite"
                          data-testid="stripe-connection-result"
                          className={`text-sm ${stripeConnectionResult.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                        >
                          {stripeConnectionResult.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="stripe-webhook-secret">Segredo do webhook</Label>
                        <Badge variant={form.stripeWebhookSecretConfigured || form.stripeWebhookSecret ? "secondary" : "outline"}>
                          {form.stripeWebhookSecret?.trim()
                            ? "Novo segredo informado"
                            : form.stripeWebhookSecretConfigured
                              ? "Segredo salvo"
                              : "Não configurado"}
                        </Badge>
                      </div>
                      <Input
                        id="stripe-webhook-secret"
                        data-testid="stripe-webhook-secret"
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={form.stripeWebhookSecret ?? ""}
                        onChange={(e) => set("stripeWebhookSecret", e.target.value)}
                        placeholder={form.stripeWebhookSecretConfigured
                          ? "Deixe vazio para manter o segredo salvo"
                          : "whsec_..."}
                        className="font-mono text-sm"
                        aria-invalid={Boolean(stripeWebhookSecretIssue)}
                        aria-describedby={stripeWebhookSecretIssue ? "stripe-webhook-secret-error" : undefined}
                      />
                      {stripeWebhookSecretIssue ? (
                        <p id="stripe-webhook-secret-error" className="text-xs text-destructive">
                          {stripeWebhookSecretIssue.message}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Configure o segredo de assinatura deste endpoint para confirmar pagamentos e processar reembolsos automaticamente.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Endpoint para cadastrar no Stripe</p>
                          <p className="text-xs text-muted-foreground">
                            Use a URL abaixo no painel do Stripe → Webhooks e selecione os eventos listados.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={copyStripeWebhookUrl}
                          disabled={!stripeWebhookUrl}
                          data-testid="copy-stripe-webhook-url"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copiar URL
                        </Button>
                      </div>
                      <code
                        data-testid="stripe-webhook-url"
                        className="block break-all rounded bg-background px-3 py-2 text-xs"
                      >
                        {stripeWebhookUrl}
                      </code>
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Eventos necessários</p>
                        <p className="break-words font-mono text-xs leading-relaxed text-muted-foreground">
                          payment_intent.succeeded, payment_intent.processing, payment_intent.requires_action,
                          payment_intent.payment_failed, charge.refunded, charge.dispute.created
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        O segredo por loja é recomendado. Sem ele, a confirmação depende de existir um segredo global configurado pela plataforma.
                      </p>
                      <a
                        href="https://dashboard.stripe.com/webhooks"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-foreground"
                      >
                        Abrir Webhooks no painel Stripe
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
              </CardContent>
            </Card>

          {/* MercadoPago */}
          <Card>
            <CardHeader>
              <CardTitle>Mercado Pago</CardTitle>
              <CardDescription>Aceite PIX, boleto e cartões via Mercado Pago.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Ativar Mercado Pago</Label>
                <Switch
                  checked={form.mpEnabled ?? false}
                  onCheckedChange={(v) => set("mpEnabled", v)}
                />
              </div>
              {form.mpEnabled && (
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <Label>Public Key</Label>
                    <Input
                      value={form.mpPublicKey ?? ""}
                      onChange={(e) => set("mpPublicKey", e.target.value)}
                      placeholder="APP_USR-..."
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Access Token</Label>
                    <Input
                      type="password"
                      value={form.mpAccessToken ?? ""}
                      onChange={(e) => set("mpAccessToken", e.target.value)}
                      placeholder={form.mpAccessTokenConfigured ? "•••••• (deixe em branco para manter)" : "APP_USR-..."}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PIX Manual */}
          {paymentMethodsSelected.includes("pix") && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-primary" />
                  PIX Manual
                </CardTitle>
                <CardDescription>
                  Gere QR Code e código Pix para pagamento direto. A confirmação depende da conferência da equipe.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="pix-manual-enabled">Ativar PIX Manual</Label>
                    <p className="text-xs text-muted-foreground">
                      Disponibiliza o Pix manual como opção de pagamento na vitrine.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        hasPendingPixKey
                          ? "bg-blue-100 text-blue-800"
                          : form.pixEnabled
                            ? form.pixKeyConfigured
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                            : "bg-muted text-muted-foreground"
                      }`}
                      role="status"
                    >
                      {hasPendingPixKey
                        ? form.pixEnabled ? "Alteração pendente" : "Chave pendente"
                        : form.pixEnabled
                          ? form.pixKeyConfigured ? "Ativo" : "Precisa de chave"
                          : form.pixKeyConfigured ? "Desativado · chave guardada" : "Desativado"}
                    </span>
                    <Switch
                      id="pix-manual-enabled"
                      checked={form.pixEnabled ?? false}
                      onCheckedChange={(v) => set("pixEnabled", v)}
                    />
                  </div>
                </div>
                {form.pixEnabled && (
                  <div className="space-y-4 border-t pt-4">
                    {form.pixKeyConfigured && (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          Há uma chave Pix protegida cadastrada. Deixe o campo vazio para mantê-la ou informe uma nova para substituí-la.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_15rem]">
                    <div className="space-y-2">
                      <Label htmlFor="pix-manual-key">Chave Pix</Label>
                      <div className="relative">
                        <Input
                          id="pix-manual-key"
                          type={showPixKey ? "text" : "password"}
                          value={pixKeyValue}
                          onChange={(e) => set("pixKey", e.target.value)}
                          placeholder={form.pixKeyConfigured
                            ? "Digite uma nova chave para substituir"
                            : pixKeyGuidance.placeholder}
                          autoComplete="off"
                          aria-invalid={showPixValidationError}
                          aria-describedby="pix-manual-key-help"
                          className="pr-11 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPixKey((visible) => !visible)}
                          aria-label={showPixKey ? "Ocultar chave Pix digitada" : "Mostrar chave Pix digitada"}
                          aria-pressed={showPixKey}
                          className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                          {showPixKey
                            ? <EyeOff className="h-4 w-4" />
                            : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p id="pix-manual-key-help" className="text-xs text-muted-foreground">
                        {pixKeyGuidance.hint} A chave salva nunca é exibida; deixe o campo vazio para mantê-la.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pix-manual-key-type">Tipo da chave</Label>
                      <select
                        id="pix-manual-key-type"
                        value={pixKeyType}
                        onChange={(e) => set("pixKeyType", e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                        aria-invalid={showPixValidationError}
                      >
                        <option value="" disabled>Selecione o tipo</option>
                        <option value="cpf">CPF</option>
                        <option value="cnpj">CNPJ</option>
                        <option value="email">E-mail</option>
                        <option value="phone">Telefone</option>
                        <option value="random">Chave Aleatória</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Escolha o mesmo tipo informado ao cadastrar a chave no banco.
                      </p>
                    </div>
                  </div>
                    {pixKeyValidationError && showPixValidationError && (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{pixKeyValidationError}</p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      O Pix Manual não confirma o pagamento automaticamente. Confira o recebimento no banco antes de confirmar o pedido.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Boleto */}
          {paymentMethodsSelected.includes("boleto") && (
            <Card>
              <CardHeader>
                <CardTitle>Boleto Bancário</CardTitle>
                <CardDescription>Configure instruções para pagamento via boleto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Ativar Boleto</Label>
                  <Switch
                    checked={form.boletoEnabled ?? false}
                    onCheckedChange={(v) => set("boletoEnabled", v)}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── POLÍTICAS ── */}
        <TabsContent value="politicas" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Políticas da Loja</CardTitle>
              <CardDescription>Textos exibidos na vitrine sobre regras e condições.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Política de Cancelamento</Label>
                <Textarea
                  value={form.cancellationPolicy ?? ""}
                  onChange={(e) => set("cancellationPolicy", e.target.value)}
                  rows={4}
                  placeholder="Descreva as regras de cancelamento..."
                />
              </div>
              <div className="space-y-2">
                <Label>Política de Reembolso</Label>
                <Textarea
                  value={form.refundPolicy ?? ""}
                  onChange={(e) => set("refundPolicy", e.target.value)}
                  rows={4}
                  placeholder="Como são feitos os reembolsos..."
                />
              </div>
              <div className="space-y-2">
                <Label>Política de Privacidade</Label>
                <Textarea
                  value={form.privacyPolicy ?? ""}
                  onChange={(e) => set("privacyPolicy", e.target.value)}
                  rows={4}
                  placeholder="Como coletamos e usamos os dados dos clientes..."
                />
              </div>
              <div className="space-y-2">
                <Label>Termos de Serviço</Label>
                <Textarea
                  value={form.termsOfService ?? ""}
                  onChange={(e) => set("termsOfService", e.target.value)}
                  rows={4}
                  placeholder="Termos e condições de uso da loja..."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── NOTIFICAÇÕES ── */}
        <TabsContent value="notificacoes" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Notificações de Pedidos</CardTitle>
              <CardDescription>Configure quando e como receber alertas de novos pedidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Notificações de Novos Pedidos</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Receba um e-mail sempre que um novo pedido for feito.
                  </p>
                </div>
                <Switch
                  checked={form.orderNotificationEnabled ?? true}
                  onCheckedChange={(v) => set("orderNotificationEnabled", v)}
                />
              </div>
              {form.orderNotificationEnabled && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>E-mail para Notificações</Label>
                    <Input
                      type="email"
                      value={form.notificationEmail ?? ""}
                      onChange={(e) => set("notificationEmail", e.target.value)}
                      placeholder="vendas@agencia.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      Deixe em branco para usar o e-mail de contato da loja.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── COMPARTILHAR ── */}
        <TabsContent value="compartilhar" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                QR Code da Loja
              </CardTitle>
              <CardDescription>
                Imprima ou compartilhe o QR Code para divulgar sua loja em materiais físicos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center gap-4">
                {qrDataUrl ? (
                  <div className="p-4 bg-white rounded-xl border shadow-sm inline-block">
                    <img
                      src={qrDataUrl}
                      alt={`QR Code da loja ${store.name}`}
                      width={220}
                      height={220}
                      className="block"
                    />
                  </div>
                ) : (
                  <div className="w-[236px] h-[236px] rounded-xl border bg-muted flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                )}
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Aponta para:</p>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center justify-center gap-1 font-mono"
                  >
                    {shareUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  variant="default"
                  disabled={!qrDataUrl}
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = qrDataUrl;
                    a.download = `qrcode-loja-${store.slug}.png`;
                    a.click();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Baixar PNG
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                     const url = shareUrl;
                    navigator.clipboard.writeText(url).then(() => {
                      toast({ title: "Link copiado!", description: url });
                    });
                  }}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copiar Link
                </Button>
              </div>

              <div className="rounded-lg bg-muted/50 border p-4 text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Dicas de uso</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Imprima em cartões de visita, flyers e banners.</li>
                  <li>Use em apresentações e propostas para clientes.</li>
                  <li>Adicione em perfis de redes sociais como link rápido.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
