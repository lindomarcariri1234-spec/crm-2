import "./_group.css";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const classificationLabel = "Novo";
const legacyStage = "Lead";

export function Explanation() {
  return (
    <main className="client-pipeline-status-sandbox flex min-h-screen items-center justify-center bg-background p-6">
      <div className="mx-auto max-w-md space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Classificação automática do cliente</p>
          <Badge variant="outline" className="text-xs">
            {classificationLabel}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A classificação descreve o perfil do cliente. A etapa do negócio é acompanhada no quadro do Pipeline
          e pode avançar automaticamente com a reserva, o pagamento e as datas da viagem.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 sm:items-start">
          <div className="space-y-2">
            <Label>Etapa antiga do cadastro (somente leitura)</Label>
            <Select value={legacyStage} disabled>
              <SelectTrigger aria-label="Etapa antiga do cadastro, somente leitura">
                <SelectValue placeholder="Sem etapa antiga" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem etapa antiga</SelectItem>
                <SelectItem value={legacyStage}>{legacyStage}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground sm:pt-7">
            Este valor legado não move cartões e não altera a classificação. Para mudar a etapa, mova o negócio
            no quadro do Pipeline.
          </p>
        </div>
      </div>
    </main>
  );
}