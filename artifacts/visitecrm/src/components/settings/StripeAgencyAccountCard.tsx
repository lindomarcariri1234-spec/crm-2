import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  ShieldOff,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getStripeCredentialMode } from "@/lib/stripe-store-config";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const INTEGRATION_TYPE = "stripe_account";

interface StripeAgencyConfig {
  integrationId: string | null;
  name: string;
  config: Record<string, string>;
  maskedSecrets: Record<string, string | null>;
  environment: "production" | "test";
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
}

interface StripeIntegrationLog {
  id: string;
  level: string;
  message: string;
  actorName: string | null;
  createdAt: string;
}

function ConnectionBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <Badge className="border border-green-200 bg-green-50 text-xs text-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Conectada
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="border border-red-200 bg-red-50 text-xs text-red-700">
        <AlertCircle className="mr-1 h-3 w-3" />
        Erro
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">Não verificada</Badge>;
}

export function StripeAgencyAccountCard() {
  const { toast } = useToast();
  const [data, setData] = useState<StripeAgencyConfig | null>(null);
  const [name, setName] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [environment, setEnvironment] = useState<"production" | "test">("production");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<StripeIntegrationLog[]>([]);
  const [loadError, setLoadError] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch(`${BASE}/api/integrations/${INTEGRATION_TYPE}`, {
        credentials: "include",
      });
      if (response.status === 403) {
        setLoadError("Você não tem permissão para gerenciar a conta Stripe da agência.");
        return;
      }
      if (!response.ok) throw new Error("Não foi possível carregar a conta Stripe da agência.");
      const result = (await response.json()) as StripeAgencyConfig;
      setData(result);
      setName(result.name ?? "");
      setPublishableKey(result.config?.publishableKey ?? "");
      setSecretKey("");
      setWebhookSecret("");
      setEnvironment(result.environment ?? "production");
      setEnabled(result.enabled ?? false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Erro ao carregar a configuração.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const response = await fetch(`${BASE}/api/integrations/${INTEGRATION_TYPE}/logs`, {
        credentials: "include",
      });
      if (response.ok) setLogs((await response.json()) as StripeIntegrationLog[]);
    } catch {
      // Logs are supplementary; keep the configuration usable if they fail to load.
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(`${BASE}/api/integrations/${INTEGRATION_TYPE}/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { publishableKey },
          secrets: { secretKey, webhookSecret },
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const ok = response.ok && result.ok === true;
      const message = result.message ?? result.error ?? "Não foi possível testar a conexão.";
      setTestResult({ ok, message });
      toast({
        title: ok ? "Conexão Stripe verificada" : "Falha ao testar a conexão",
        description: message,
        ...(!ok ? { variant: "destructive" as const } : {}),
      });
      await loadLogs();
    } catch {
      const message = "Não foi possível testar a conexão com o Stripe.";
      setTestResult({ ok: false, message });
      toast({ title: "Falha ao testar a conexão", description: message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const response = await fetch(`${BASE}/api/integrations/${INTEGRATION_TYPE}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          config: { publishableKey },
          secrets: { secretKey, webhookSecret },
          environment,
          enabled,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "Não foi possível salvar a configuração.");
      }
      setTestResult(null);
      toast({ title: "Conta Stripe da agência salva" });
      await loadConfig();
      await loadLogs();
    } catch (error) {
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Não foi possível salvar a configuração.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function revokeCredentials() {
    setRevoking(true);
    try {
      const response = await fetch(`${BASE}/api/integrations/${INTEGRATION_TYPE}/revoke`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Não foi possível revogar as credenciais.");
      toast({ title: "Credenciais da conta da agência revogadas" });
      await loadConfig();
      await loadLogs();
    } catch (error) {
      toast({
        title: "Erro ao revogar",
        description: error instanceof Error ? error.message : "Não foi possível revogar as credenciais.",
        variant: "destructive",
      });
    } finally {
      setRevoking(false);
    }
  }

  const hasSavedSecret = Boolean(data?.maskedSecrets?.secretKey);
  const credentialMode = getStripeCredentialMode(publishableKey)
    ?? getStripeCredentialMode(secretKey);
  const selectedMode = environment === "production" ? "live" : "test";
  const environmentMismatch = credentialMode != null && credentialMode !== selectedMode;
  const enteredSecretMode = getStripeCredentialMode(secretKey);
  const keyPairMismatch =
    getStripeCredentialMode(publishableKey) != null
    && enteredSecretMode != null
    && getStripeCredentialMode(publishableKey) !== enteredSecretMode;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">Conta Stripe da agência</CardTitle>
          {data && <ConnectionBadge status={data.status} />}
        </div>
        <CardDescription>
          Credenciais gerais da agência. São independentes das credenciais da loja e não controlam o checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando configuração...
          </div>
        ) : loadError ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {loadError}
          </p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agency-stripe-name">Nome da configuração (opcional)</Label>
                <Input
                  id="agency-stripe-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Conta Stripe da agência"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agency-stripe-publishable">Chave publicável (opcional)</Label>
                <Input
                  id="agency-stripe-publishable"
                  value={publishableKey}
                  onChange={(event) => setPublishableKey(event.target.value)}
                  placeholder="pk_test_... ou pk_live_..."
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="agency-stripe-secret">Chave secreta</Label>
                  {hasSavedSecret && <Badge variant="secondary">Chave salva</Badge>}
                </div>
                <Input
                  id="agency-stripe-secret"
                  type="password"
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.target.value)}
                  placeholder={hasSavedSecret ? "Deixe vazio para manter a chave salva" : "sk_test_... ou sk_live_..."}
                  autoComplete="new-password"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                {hasSavedSecret && (
                  <p className="text-xs text-muted-foreground">
                    A chave salva não é exibida. Uma nova chave só a substitui ao salvar.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="agency-stripe-webhook-secret">Segredo do webhook (opcional)</Label>
                  {data?.maskedSecrets?.webhookSecret && <Badge variant="secondary">Segredo salvo</Badge>}
                </div>
                <Input
                  id="agency-stripe-webhook-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                  placeholder={data?.maskedSecrets?.webhookSecret ? "Deixe vazio para manter o segredo salvo" : "whsec_..."}
                  autoComplete="new-password"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                {data?.maskedSecrets?.webhookSecret && (
                  <p className="text-xs text-muted-foreground">
                    O segredo salvo não é exibido. Deixe em branco para mantê-lo.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="agency-stripe-environment">Ambiente da conta</Label>
                  <p className="text-xs text-muted-foreground">
                    {environment === "production" ? "Produção" : "Teste (sandbox)"}
                  </p>
                </div>
                <Select
                  value={environment}
                  onValueChange={(value) => setEnvironment(value as "production" | "test")}
                >
                  <SelectTrigger id="agency-stripe-environment" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Produção</SelectItem>
                    <SelectItem value="test">Teste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="agency-stripe-enabled">Ativar conta da agência</Label>
                  <p className="text-xs text-muted-foreground">Ativa esta integração separada da loja.</p>
                </div>
                <Switch id="agency-stripe-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>

            {(environmentMismatch || keyPairMismatch) && (
              <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Revise o ambiente das credenciais Stripe.
                </p>
                <p className="mt-1 text-muted-foreground">
                  {keyPairMismatch
                    ? "A chave publicável e a nova chave secreta indicam ambientes diferentes."
                    : `A chave informada indica o ambiente de ${credentialMode === "test" ? "teste" : "produção"}, mas o ambiente selecionado está como ${environment === "production" ? "produção" : "teste"}.`}
                </p>
              </div>
            )}

            {data?.lastError && data.status === "error" && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {data.lastError}
              </p>
            )}
            {data?.lastSyncAt && (
              <p className="text-xs text-muted-foreground">
                Última verificação: {new Date(data.lastSyncAt).toLocaleString("pt-BR")}
              </p>
            )}
            {testResult && (
              <p
                role={testResult.ok ? "status" : "alert"}
                aria-live="polite"
                className={`text-sm ${testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
              >
                {testResult.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => void testConnection()} disabled={testing || saving}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                Testar conexão
              </Button>
              <Button type="button" onClick={() => void saveConfig()} disabled={saving || testing}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar conta da agência
              </Button>

              {hasSavedSecret && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={revoking}>
                      {revoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />}
                      Revogar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revogar as credenciais da conta da agência?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso apagará as credenciais desta integração e a desativará. As credenciais da loja não serão alteradas.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void revokeCredentials()}>
                        Revogar credenciais
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  setShowLogs((current) => !current);
                  if (!showLogs) void loadLogs();
                }}
              >
                <History className="mr-2 h-4 w-4" />
                {showLogs ? "Ocultar logs" : "Ver logs"}
              </Button>
            </div>

            {showLogs && (
              <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {logs.length === 0 ? (
                  <p className="p-3 text-center text-xs text-muted-foreground">Nenhum registro ainda.</p>
                ) : logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 p-3 text-xs">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      log.level === "error" ? "bg-red-500" : log.level === "warn" ? "bg-amber-500" : "bg-green-500"
                    }`} />
                    <div className="min-w-0">
                      <p className="break-words">{log.message}</p>
                      <p className="text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString("pt-BR")}
                        {log.actorName ? ` · ${log.actorName}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
