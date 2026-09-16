import { useState } from "react";
import { Link } from "wouter";
import { useListAccommodations } from "@workspace/api-client-react";
import { Building2, ChevronRight, Hotel, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AccommodationOperationsPanel } from "@/components/accommodation-operations-panel";

export default function PmsHospedagens() {
  const { data: accommodations = [], isError, isLoading } = useListAccommodations();
  const [selectedId, setSelectedId] = useState("");
  const selected = accommodations.find((accommodation) => accommodation.id === selectedId);
  const activeAccommodation = selected ?? accommodations[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span>PMS</span>
            <ChevronRight className="h-4 w-4" />
            <span>Hospedagens</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-6 w-6 text-primary" />
            Operação de hospedagens
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Controle o inventário, tarifas, bloqueios, estadias e a jornada de hospedagem integrada ao CRM e às excursões.
          </p>
        </div>
        <Link href="/cadastros/hospedagens" className="text-sm font-medium text-primary hover:underline">
          Consultar cadastro de parceiros
        </Link>
      </div>

      <Card className="border-primary/15 bg-primary/[0.03]">
        <CardContent className="flex gap-3 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            Esta é a área operacional do PMS. O cadastro em <strong className="text-foreground">Cadastros → Hospedagens</strong> continua sendo apenas a base de referência de hotéis, pousadas e parceiros.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hotel className="h-4 w-4 text-primary" />
            Selecione a hospedagem
          </CardTitle>
          <CardDescription>Escolha o estabelecimento para consultar e operar seus dados de PMS.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          ) : isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar as hospedagens parceiras.</p>
          ) : accommodations.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">Nenhuma hospedagem cadastrada</p>
              <p className="mt-1 text-sm text-muted-foreground">Cadastre um parceiro antes de iniciar a operação PMS.</p>
              <Link href="/cadastros/hospedagens" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
                Ir para cadastro de hospedagens
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="pms-accommodation">Estabelecimento</Label>
                <select
                  id="pms-accommodation"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={activeAccommodation?.id ?? ""}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {accommodations.map((accommodation) => (
                    <option key={accommodation.id} value={accommodation.id}>
                      {accommodation.name}{accommodation.city ? ` — ${accommodation.city}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {activeAccommodation && (
                <Badge variant={activeAccommodation.status === "active" ? "default" : "secondary"} className="h-6 w-fit">
                  {activeAccommodation.status === "active" ? "Parceiro ativo" : "Parceiro inativo"}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {activeAccommodation && (
        <AccommodationOperationsPanel accommodationId={activeAccommodation.id} />
      )}
    </div>
  );
}