import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type ImportEntity = "clients" | "trips" | "reservations";
type RowAction = "created" | "updated" | "ignored" | "rejected";

interface RowResult {
  line: number;
  sourceKey?: string;
  label?: string;
  action: RowAction;
  reason?: string;
}

interface ImportReport {
  entity: ImportEntity;
  contractVersion: 1;
  filename: string;
  totalRows: number;
  results: RowResult[];
}

interface Props {
  entity: ImportEntity;
  title: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const actionLabels: Record<RowAction, string> = {
  created: "Criar",
  updated: "Atualizar",
  ignored: "Ignorar",
  rejected: "Rejeitar",
};

const actionClasses: Record<RowAction, string> = {
  created: "bg-emerald-50 text-emerald-700 border-emerald-200",
  updated: "bg-blue-50 text-blue-700 border-blue-200",
  ignored: "bg-slate-50 text-slate-700 border-slate-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

async function postImport(path: "preview" | "import", body: Record<string, unknown>) {
  const response = await fetch(`/api/spreadsheet-imports/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: string; message?: string; report?: ImportReport; replayed?: boolean };
  if (!response.ok) throw new Error(data.message ?? data.error ?? "Não foi possível processar a planilha.");
  if (!data.report) throw new Error("A resposta da importação é inválida.");
  return data;
}

export function OperationalImportModal({ entity, title, open, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [contentBase64, setContentBase64] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setContentBase64("");
    setReport(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function preview(selected: File) {
    setBusy(true);
    setReport(null);
    try {
      if (selected.size > 5 * 1024 * 1024) throw new Error("O arquivo excede o limite de 5 MB.");
      const base64 = await fileToBase64(selected);
      const result = await postImport("preview", { entity, filename: selected.name, contentBase64: base64 });
      setFile(selected);
      setContentBase64(base64);
      setReport(result.report!);
    } catch (error) {
      reset();
      toast({ title: "Planilha inválida", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !contentBase64 || !report) return;
    setBusy(true);
    try {
      const result = await postImport("import", {
        entity,
        filename: file.name,
        contentBase64,
        idempotencyKey: crypto.randomUUID(),
      });
      setReport(result.report!);
      const imported = result.report!.results.filter(row => row.action === "created" || row.action === "updated").length;
      const rejected = result.report!.results.filter(row => row.action === "rejected").length;
      toast({
        title: result.replayed ? "Importação já processada" : "Importação concluída",
        description: `${imported} linha(s) gravada(s) e ${rejected} rejeitada(s).`,
        variant: rejected > 0 ? "destructive" : "default",
      });
      if (imported > 0) onImported();
    } catch (error) {
      toast({ title: "Erro na importação", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const rejected = report?.results.filter(row => row.action === "rejected").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Use o modelo versionado. O arquivo é validado e pré-visualizado antes de qualquer gravação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/spreadsheet-imports/templates/${entity}.csv`}><Download className="w-4 h-4 mr-2" />Modelo CSV</a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/spreadsheet-imports/templates/${entity}.xlsx`}><FileSpreadsheet className="w-4 h-4 mr-2" />Modelo XLSX</a>
            </Button>
          </div>

          <button
            type="button"
            className="w-full border-2 border-dashed rounded-lg p-7 text-center hover:bg-muted/30 transition-colors"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" /> : <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />}
            <span className="text-sm text-muted-foreground">{file ? file.name : "Selecionar arquivo CSV ou XLSX (máximo 5 MB e 2.000 linhas)"}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={event => { const selected = event.target.files?.[0]; if (selected) void preview(selected); }}
          />

          {report && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Prévia do contrato v{report.contractVersion} · {report.totalRows} linha(s)</p>
                {rejected > 0
                  ? <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{rejected} rejeitada(s)</span>
                  : <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Arquivo válido</span>}
              </div>
              <div className="border rounded-lg max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0"><tr><th className="text-left p-2">Linha</th><th className="text-left p-2">ID Externo</th><th className="text-left p-2">Ação</th><th className="text-left p-2">Motivo</th></tr></thead>
                  <tbody>
                    {report.results.map(row => (
                      <tr key={`${row.line}-${row.sourceKey ?? ""}`} className="border-t">
                        <td className="p-2">{row.line}</td>
                        <td className="p-2">{row.sourceKey ?? row.label ?? "—"}</td>
                        <td className="p-2"><Badge variant="outline" className={actionClasses[row.action]}>{actionLabels[row.action]}</Badge></td>
                        <td className="p-2 text-muted-foreground">{row.reason ?? "Pronta para processar"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>Fechar</Button>
          <Button onClick={() => void commit()} disabled={busy || !report || report.results.every(row => row.action === "rejected")}>
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando</> : "Confirmar importação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}