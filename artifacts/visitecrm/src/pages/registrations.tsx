import { Link } from "wouter";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, Bus, Hotel, MapPin, Package, LayoutGrid, Navigation } from "lucide-react";

const SECTIONS = [
  {
    title: "Fornecedores",
    description: "Gerencie empresas e prestadores de serviço vinculados às viagens",
    icon: Truck,
    href: "/cadastros/fornecedores",
    color: "text-blue-500",
    bg: "bg-blue-50",
  },
  {
    title: "Veículos",
    description: "Cadastre ônibus, vans e outros veículos utilizados nas excursões",
    icon: Bus,
    href: "/cadastros/veiculos",
    color: "text-green-500",
    bg: "bg-green-50",
  },
  {
    title: "Hospedagens",
    description: "Hotéis, pousadas e acomodações parceiras da agência",
    icon: Hotel,
    href: "/cadastros/hospedagens",
    color: "text-purple-500",
    bg: "bg-purple-50",
  },
  {
    title: "Destinos",
    description: "Cadastre destinos com atrações, descrições e imagens",
    icon: MapPin,
    href: "/cadastros/destinos",
    color: "text-orange-500",
    bg: "bg-orange-50",
  },
  {
    title: "Produtos",
    description: "Seguros, transfers e outros produtos para venda na loja",
    icon: Package,
    href: "/cadastros/produtos",
    color: "text-pink-500",
    bg: "bg-pink-50",
  },
  {
    title: "Layouts de Assentos",
    description: "Crie mapas de assentos personalizados para vincular às viagens",
    icon: LayoutGrid,
    href: "/cadastros/layouts",
    color: "text-indigo-500",
    bg: "bg-indigo-50",
  },
  {
    title: "Locais de Embarque",
    description: "Cadastre os pontos de coleta utilizados nas excursões",
    icon: Navigation,
    href: "/cadastros/locais-embarque",
    color: "text-teal-500",
    bg: "bg-teal-50",
  },
];

export default function Registrations() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cadastros</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie fornecedores, veículos, hospedagens, destinos, produtos e locais de embarque
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.href} href={section.href}>
              <Card className="cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all">
                <CardHeader className="pb-3">
                  <div
                    className={`w-10 h-10 rounded-lg ${section.bg} flex items-center justify-center mb-2`}
                  >
                    <Icon className={`w-5 h-5 ${section.color}`} />
                  </div>
                  <CardTitle className="text-base">{section.title}</CardTitle>
                  <CardDescription className="text-xs">{section.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
