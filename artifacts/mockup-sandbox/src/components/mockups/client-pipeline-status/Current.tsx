import "./_group.css";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const stages = ["Lead", "Reserva Criada", "Pagamento Confirmado"];

export function Current() {
  return (
    <main className="client-pipeline-status-sandbox flex min-h-screen items-center justify-center bg-background p-6">
      <div className="mx-auto max-w-md rounded-lg border bg-card p-5 shadow-sm">
        <div className="space-y-2">
          <Label>Status no Pipeline</Label>
          <Select value="Lead">
            <SelectTrigger>
              <SelectValue placeholder="Selecionar..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {stages.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {stage}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </main>
  );
}