import "./_group.css";
import { Bell, CreditCard, FileText, Link2, Palette, Phone, Search, Share2, Store } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const tabs = [
  ["geral", "Geral", Store],
  ["aparencia", "Aparência", Palette],
  ["contato", "Contato", Phone],
  ["seo", "SEO", Search],
  ["dominio", "Domínio", Link2],
  ["pagamento", "Pagamentos", CreditCard],
  ["politicas", "Políticas", FileText],
  ["notificacoes", "Notificações", Bell],
  ["compartilhar", "Compartilhar", Share2],
] as const;

export function Current() {
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
      <Tabs defaultValue="geral">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-border bg-white/85 p-1.5 shadow-sm">
          {tabs.map(([value, label, Icon]) => (
            <TabsTrigger key={value} value={value} className="flex items-center gap-1.5">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Card className="mt-4 rounded-2xl border-border bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Informações da Loja</CardTitle>
            <CardDescription>Nome, endereço e descrição pública.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">As nove seções aparecem juntas em uma única faixa de abas.</CardContent>
        </Card>
        {tabs.map(([value, label]) => (
          <TabsContent key={value} value={value} className="sr-only">{label}</TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
