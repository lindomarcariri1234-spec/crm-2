import "./_group.css";
import { Building2, CreditCard, Puzzle, Bell, Palette, Users, Key, ToggleLeft, Crown, GitBranch, DatabaseBackup, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const tabs = [
  ["agency", "Agência", Building2],
  ["plan", "Plano", CreditCard],
  ["integrations", "Integrações", Puzzle],
  ["notifications", "Notificações", Bell],
  ["customization", "Personalização", Palette],
  ["team", "Equipe", Users],
  ["apikeys", "Chaves API", Key],
  ["features", "Funcionalidades", ToggleLeft],
  ["clube", "Clube", Crown],
  ["pipelines", "Pipelines", GitBranch],
  ["backup", "Backup de Dados", DatabaseBackup],
  ["integrity", "Integridade", Wrench],
] as const;

export function Current() {
  return (
    <main className="min-h-screen space-y-6 bg-background p-6 text-foreground">
      <header className="rounded-3xl border border-[#D9CBBE] bg-[#FFF9F0] px-6 py-5 shadow-sm">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4C8B5F]">Bastidores da agência · Cariri</p>
        <h1 className="text-3xl font-bold tracking-tight text-[#5D3E2A]">Configurações</h1>
        <p className="mt-1 text-sm text-[#71808C]">Deixe a operação com a sua cara e mantenha os serviços essenciais prontos para a próxima saída.</p>
      </header>
      <Tabs defaultValue="agency">
        <TabsList className="flex h-auto w-full max-w-full flex-nowrap justify-start gap-1 overflow-x-auto rounded-2xl border border-[#DCE3E8] bg-white/85 p-1.5 shadow-sm">
          {tabs.map(([value, label, Icon]) => (
            <TabsTrigger key={value} value={value} className="flex shrink-0 items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Card className="mt-4 overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Perfil da Agência</CardTitle>
            <CardDescription>Informações da agência, logotipo e cores do sistema</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">As seções ficam em uma faixa longa; em telas menores é necessário percorrer horizontalmente.</CardContent>
        </Card>
        {tabs.map(([value, label]) => (
          <TabsContent key={value} value={value} className="sr-only">
            {label}
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
