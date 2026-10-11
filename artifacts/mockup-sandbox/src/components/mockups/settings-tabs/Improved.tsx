import "./_group.css";
import { useState } from "react";
import { Building2, CreditCard, Puzzle, Bell, Palette, Users, Key, ToggleLeft, Crown, GitBranch, DatabaseBackup, Wrench, ChevronRight, type LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

type TabOption = { value: string; label: string; icon: LucideIcon };

const groups: { label: string; options: TabOption[] }[] = [
  { label: "Conta", options: [{ value: "agency", label: "Agência", icon: Building2 }, { value: "plan", label: "Plano", icon: CreditCard }, { value: "team", label: "Equipe", icon: Users }, { value: "apikeys", label: "Chaves API", icon: Key }] },
  { label: "Operação", options: [{ value: "integrations", label: "Integrações", icon: Puzzle }, { value: "notifications", label: "Notificações", icon: Bell }, { value: "features", label: "Funcionalidades", icon: ToggleLeft }, { value: "pipelines", label: "Pipelines", icon: GitBranch }] },
  { label: "Marca e relacionamento", options: [{ value: "customization", label: "Personalização", icon: Palette }, { value: "clube", label: "Clube", icon: Crown }] },
  { label: "Dados e integridade", options: [{ value: "backup", label: "Backup de Dados", icon: DatabaseBackup }, { value: "integrity", label: "Integridade", icon: Wrench }] },
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
        <div className="md:hidden">
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
        <div className="relative hidden md:block">
          <div className="settings-tabs-scroll overflow-x-auto overscroll-x-contain pb-1">
            <TabsList aria-label="Seções das configurações" className="flex h-auto w-max min-w-full flex-nowrap justify-start gap-1 rounded-2xl border border-[#DCE3E8] bg-white/85 p-1.5 shadow-sm">
              {groups.flatMap((group) => group.options).map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground xl:hidden">
            Role horizontalmente para acessar todas as seções <ChevronRight className="h-3.5 w-3.5" />
          </p>
        </div>
        <Card className="mt-4 overflow-hidden rounded-2xl border-[#DCE3E8] bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Perfil da Agência</CardTitle>
            <CardDescription>Informações da agência, logotipo e cores do sistema</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">No celular, escolha a seção por uma lista agrupada; no computador, as abas ficam alinhadas em uma única faixa.</CardContent>
        </Card>
        {groups.flatMap((group) => group.options).map(({ value, label }) => (
          <TabsContent key={value} value={value} className="sr-only">{label}</TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
