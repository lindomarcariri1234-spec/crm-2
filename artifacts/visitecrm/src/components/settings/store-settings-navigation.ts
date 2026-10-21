import { Bell, CreditCard, FileText, Link2, Palette, Phone, Search, Share2, Store } from "lucide-react";
import type { SettingsNavigationGroup } from "./SettingsNavigation";

export const STORE_SETTINGS_NAVIGATION_GROUPS: readonly SettingsNavigationGroup[] = [
  {
    label: "Loja e vitrine",
    items: [
      { value: "geral", label: "Geral", icon: Store },
      { value: "aparencia", label: "Aparência", icon: Palette },
      { value: "contato", label: "Contato", icon: Phone },
    ],
  },
  {
    label: "Descoberta",
    items: [
      { value: "seo", label: "SEO", icon: Search },
      { value: "dominio", label: "Domínio", icon: Link2 },
      { value: "compartilhar", label: "Compartilhar", icon: Share2 },
    ],
  },
  {
    label: "Operação",
    items: [
      { value: "pagamento", label: "Pagamentos", icon: CreditCard },
      { value: "politicas", label: "Políticas", icon: FileText },
      { value: "notificacoes", label: "Notificações", icon: Bell },
    ],
  },
];
