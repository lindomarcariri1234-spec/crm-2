import "./_group.css";
import { useState } from "react";
import { Building2, CreditCard, Puzzle, Bell, Palette, Users, Key, ToggleLeft, Crown, GitBranch, DatabaseBackup, Wrench, type LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

type TabOption = { value: string; label: string; icon: LucideIcon };

const groups: { label: string; options: TabOption[] }[] = [
  { label: "Agência", options: [{ value: "agency", label: "Agência", icon: Building2 }, { value: "customization", label: "Personalização", icon: Palette }] },
  { label: "Conta", options: [{ value: "plan", label: "Plano", icon: CreditCard }, { value: "team", label: "Equipe", icon: Users }, { value: "apikeys", label: "Chaves API", icon: Key }] },
  { label: "Operação", options: [{ value: "integrations", label: "Integrações", icon: Puzzle }, { value: "notifications", label: "Notificações", icon: Bell }, { value: "features", label: "Funcionalidades", icon: ToggleLeft }, { value: "pipelines", label: "Pipelines", icon: GitBranch }] },
  { label: "Relacionamento e dados", options: [{ value: "clube", label: "Clube", icon: Crown }, { value: "backup", label: "Backup de Dados", icon: DatabaseBackup }, { value: "integrity", label: "Integridade", icon: Wrench }] },
];

export function Improved() {
  const [activeTab, setActiveTab] = useState("agency");

  return (
    <main className="min-h-screen space-y-6 bg-background p-6 text-foreground">
      <header className="rounded-3xl border border-[#D9CBBE] bg-[#FFF9F0] px-6 py-5 shadow-sm">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4C8B5F]">Bastidores da agência · Cariri</p>
        <h1 className="text-3xl font-bold tracking-tight text-[#5D3E2A]">Configurações</h1>
        <p className="mt-1 text-sm text-[#71808C]">Deixe a operação com a sua cara e mantenha os serviços essenciais prontos para a próxima saída.</p>
      </header>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger aria-label="Seção de configurações" className="h-12 rounded-xl border-[#DCE3E8] bg-white">
              <SelectValue placeholder="Escolha uma seção" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav className="hidden rounded-2xl border border-[#DCE3E8] bg-white/85 p-2 shadow-sm lg:block">
          <p className="px-3 py-2 text-xs font-semibold">Seções da agência</p>
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.label} className="space-y-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
                <TabsList aria-label={group.label} className="flex h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-xl bg-transparent p-0">
                  {group.options.map(({ value, label, icon: Icon }) => (
                    <TabsTrigger key={value} value={value} className="w-full justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm whitespace-normal data-[state=active]:bg-[#EAF1F4] data-[state=active]:text-[#1E5B8C] data-[state=active]:shadow-none">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </section>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
        <Card className="mt-4 overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Perfil da Agência</CardTitle>
            <CardDescription>Informações da agência, logotipo e cores do sistema</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">As seções da agência ficam agrupadas em um menu lateral; em telas menores, a mesma organização aparece em um seletor.</CardContent>
        </Card>
        {groups.flatMap((group) => group.options).map(({ value, label }) => (
          <TabsContent key={value} value={value} className="sr-only">{label}</TabsContent>
        ))}
        </div>
        </div>
      </Tabs>
    </main>
  );
}
