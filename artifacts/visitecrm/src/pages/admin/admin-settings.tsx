import { useState } from "react";
import {
  useListFeatureFlags,
  useUpdateFeatureFlag,
  useCreateFeatureFlag,
  useListPlatformSettings,
  useUpdatePlatformSetting,
  type FeatureFlag,
  type PlatformSetting,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Settings2, Globe, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListFeatureFlagsQueryKey, getListPlatformSettingsQueryKey } from "@workspace/api-client-react";

interface FlagModalProps {
  onClose: () => void;
}

function CreateFlagModal({ onClose }: FlagModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createFlag = useCreateFeatureFlag();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function handleSave() {
    if (!key || !name) return;
    try {
      await createFlag.mutateAsync({ data: { key, name, description: description || undefined } });
      await queryClient.invalidateQueries({ queryKey: getListFeatureFlagsQueryKey() });
      toast({ title: "Feature flag criada" });
      onClose();
    } catch {
      toast({ title: "Erro ao criar feature flag", variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Feature Flag</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium">Chave (key)</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="new_dashboard" />
          </div>
          <div>
            <label className="text-sm font-medium">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo Dashboard" />
          </div>
          <div>
            <label className="text-sm font-medium">Descrição</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Habilita o novo dashboard..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createFlag.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={createFlag.isPending || !key || !name}>
            {createFlag.isPending ? "Criando..." : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlagRow({ flag }: { flag: FeatureFlag }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateFlag = useUpdateFeatureFlag();
  const [rollout, setRollout] = useState(flag.rolloutPercent.toString());

  async function toggleFlag() {
    try {
      await updateFlag.mutateAsync({ id: flag.id, data: { isEnabled: !flag.isEnabled } });
      await queryClient.invalidateQueries({ queryKey: getListFeatureFlagsQueryKey() });
    } catch {
      toast({ title: "Erro ao atualizar flag", variant: "destructive" });
    }
  }

  async function saveRollout() {
    const pct = parseInt(rollout) || 0;
    try {
      await updateFlag.mutateAsync({ id: flag.id, data: { rolloutPercent: Math.max(0, Math.min(100, pct)) } });
      await queryClient.invalidateQueries({ queryKey: getListFeatureFlagsQueryKey() });
      toast({ title: "Rollout atualizado" });
    } catch {
      toast({ title: "Erro ao atualizar rollout", variant: "destructive" });
    }
  }

  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{flag.name}</div>
        <div className="text-xs font-mono text-muted-foreground">{flag.key}</div>
        {flag.description && <div className="text-xs text-muted-foreground mt-0.5">{flag.description}</div>}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={rollout}
            onChange={(e) => setRollout(e.target.value)}
            onBlur={saveRollout}
            className="w-20 h-8 text-sm"
            min={0}
            max={100}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <button
          onClick={toggleFlag}
          className={`w-10 h-6 rounded-full relative transition-colors ${flag.isEnabled ? "bg-indigo-600" : "bg-muted-foreground/30"}`}
          disabled={updateFlag.isPending}
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${flag.isEnabled ? "translate-x-5" : "translate-x-1"}`}
          />
        </button>
        <Badge variant={flag.isEnabled ? "default" : "secondary"} className="w-16 justify-center">
          {flag.isEnabled ? "Ativo" : "Inativo"}
        </Badge>
      </div>
    </div>
  );
}

const EMAIL_SETTING_KEYS = new Set(["redis_alert_email"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SettingRow({ setting }: { setting: PlatformSetting }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSetting = useUpdatePlatformSetting();
  const [value, setValue] = useState(setting.value ?? "");
  const [dirty, setDirty] = useState(false);

  const isEmailSetting = EMAIL_SETTING_KEYS.has(setting.key);
  const emailError = isEmailSetting && value.trim() !== "" && !EMAIL_REGEX.test(value.trim())
    ? "Insira um endereço de e-mail válido"
    : null;

  function handleChange(v: string) {
    setValue(v);
    setDirty(v !== (setting.value ?? ""));
  }

  async function handleSave() {
    if (emailError) return;
    try {
      await updateSetting.mutateAsync({ key: setting.key, data: { value } });
      await queryClient.invalidateQueries({ queryKey: getListPlatformSettingsQueryKey() });
      toast({ title: "Configuração salva" });
      setDirty(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : undefined;
      toast({ title: msg ?? "Erro ao salvar configuração", variant: "destructive" });
    }
  }

  const renderInput = () => {
    if (setting.type === "boolean") {
      const boolVal = value === "true";
      return (
        <button
          onClick={() => { handleChange(boolVal ? "false" : "true"); }}
          className={`w-10 h-6 rounded-full relative transition-colors ${boolVal ? "bg-indigo-600" : "bg-muted-foreground/30"}`}
        >
          <span
            className={`block w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${boolVal ? "translate-x-5" : "translate-x-1"}`}
          />
        </button>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className={`h-8 text-sm max-w-xs ${emailError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
          type={isEmailSetting ? "email" : setting.type === "number" ? "number" : "text"}
        />
        {emailError && <p className="text-xs text-red-600">{emailError}</p>}
      </div>
    );
  };

  const canSave = dirty && !emailError;

  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{setting.label}</div>
        <div className="text-xs font-mono text-muted-foreground">{setting.key}</div>
        {setting.description && <div className="text-xs text-muted-foreground mt-0.5">{setting.description}</div>}
      </div>
      <div className="flex items-center gap-3">
        {renderInput()}
        {canSave && (
          <Button size="sm" variant="outline" className="h-8" onClick={handleSave} disabled={updateSetting.isPending}>
            <Save className="w-3 h-3 mr-1" />
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}

const platformUrl: string =
  (import.meta.env.VITE_APP_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "https://visitecrm.com");

export default function AdminSettings() {
  const { data: flags = [], isLoading: flagsLoading } = useListFeatureFlags();
  const { data: platformSettings = [], isLoading: settingsLoading } = useListPlatformSettings();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground text-sm mt-1">Configurações globais da plataforma e feature flags</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Informações da Plataforma
          </CardTitle>
          <p className="text-sm text-muted-foreground">Dados gerais sobre a instância atual</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome da Plataforma</label>
              <Input defaultValue="VisiteCRM" className="h-8 text-sm mt-1" readOnly />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">URL da Plataforma</label>
              <Input defaultValue={platformUrl} className="h-8 text-sm mt-1" readOnly />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Configurações Globais
          </CardTitle>
          <p className="text-sm text-muted-foreground">Parâmetros gerais que afetam todo o comportamento da plataforma</p>
        </CardHeader>
        <CardContent className="p-0">
          {settingsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-muted-foreground">Carregando...</div>
            </div>
          ) : platformSettings.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Nenhuma configuração disponível
            </div>
          ) : (
            <div>
              {platformSettings.map((setting) => (
                <SettingRow key={setting.key} setting={setting} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Feature Flags
            </CardTitle>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Nova Flag
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Controle a ativação de funcionalidades por percentual de rollout</p>
        </CardHeader>
        <CardContent className="p-0">
          {flagsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-muted-foreground">Carregando...</div>
            </div>
          ) : flags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
              <p className="text-sm">Nenhuma feature flag cadastrada</p>
              <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Criar primeira flag
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {flags.map((flag) => (
                <FlagRow key={flag.id} flag={flag} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && <CreateFlagModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
