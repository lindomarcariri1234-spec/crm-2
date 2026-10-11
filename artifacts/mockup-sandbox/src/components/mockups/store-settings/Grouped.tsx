import "./_group.css";
import { useState } from "react";
import { Bell, CreditCard, FileText, Link2, Palette, Phone, Search, Share2, Store } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const groups = [
  { label: "Loja e vitrine", items: [["geral", "Geral", Store], ["aparencia", "Aparência", Palette], ["contato", "Contato", Phone]] },
  { label: "Descoberta", items: [["seo", "SEO", Search], ["dominio", "Domínio", Link2], ["compartilhar", "Compartilhar", Share2]] },
  { label: "Operação", items: [["pagamento", "Pagamentos", CreditCard], ["politicas", "Políticas", FileText], ["notificacoes", "Notificações", Bell]] },
] as const;

const tabs = [
  ["geral", "Geral"],
  ["aparencia", "Aparência"],
  ["contato", "Contato"],
  ["seo", "SEO"],
  ["dominio", "Domínio"],
  ["compartilhar", "Compartilhar"],
  ["pagamento", "Pagamentos"],
  ["politicas", "Políticas"],
  ["notificacoes", "Notificações"],
] as const;

export function Grouped() {
  const [activeTab, setActiveTab] = useState("geral");
  return (
    <main className="min-h-screen space-y-5 bg-background p-6 text-foreground">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Minha Loja</p>
          <h1 className="text-2xl font-semibold tracking-tight">Configurações da Loja</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie sua vitrine, pagamentos e informações públicas.</p>
        </div>
        <button className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Salvar Alterações</button>
      </header>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="lg:hidden">
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger aria-label="Seção de configurações da loja" className="h-12 rounded-xl border-border bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.items.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav className="hidden rounded-2xl border border-border bg-white/85 p-2 shadow-sm lg:block">
            <p className="px-3 py-2 text-xs font-semibold">Seções da loja</p>
            <div className="space-y-3">
              {groups.map((group) => (
                <section key={group.label} className="space-y-1">
                  <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
                  <TabsList aria-label={group.label} className="flex h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-xl bg-transparent p-0">
                    {group.items.map(([value, label, Icon]) => (
                      <TabsTrigger key={value} value={value} className="w-full justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm whitespace-normal data-[state=active]:bg-[#EAF1F4] data-[state=active]:text-[#1E5B8C] data-[state=active]:shadow-none">
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </section>
              ))}
            </div>
          </nav>
          <div className="min-w-0">
            <Card className="rounded-2xl border-border bg-white/90 shadow-sm">
              <CardHeader>
                <CardTitle>Informações da Loja</CardTitle>
                <CardDescription>Nome, endereço e descrição pública.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">A navegação mantém as nove seções agrupadas e em uma área própria da loja.</CardContent>
            </Card>
            {tabs.map(([value, label]) => <TabsContent key={value} value={value} className="sr-only">{label}</TabsContent>)}
          </div>
        </div>
      </Tabs>
    </main>
  );
}
