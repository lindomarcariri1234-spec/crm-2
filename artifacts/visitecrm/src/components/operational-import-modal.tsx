import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { normalizeSpreadsheetHeader, readSpreadsheetPreview, type LocalSpreadsheetPreview } from "@/lib/spreadsheet-import-preview";

export type ImportEntity =
  | "clients"
  | "trips"
  | "reservations"
  | "payments"
  | "expenses"
  | "referrals"
  | "commissions"
  | "deals";
type RowAction = "created" | "updated" | "duplicate" | "ignored" | "rejected";
type Phase = "idle" | "previewing" | "ready" | "importing" | "complete";

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

interface ImportContract {
  version: number;
  columns: Array<{ key: string; label: string; required: boolean; format: string; example: string }>;
  dependencies: ImportEntity[];
  derivedFieldsExcluded: string[];
}

interface Props {
  entity: ImportEntity;
  title: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const entityLabels: Record<ImportEntity, string> = {
  clients: "clientes",
  trips: "viagens",
  reservations: "reservas",
  payments: "pagamentos",
  expenses: "despesas",
  referrals: "indicações",
  commissions: "comissões",
  deals: "negociações",
};

const actionLabels: Record<RowAction, string> = {
  created: "Criar",
  updated: "Atualizar",
  duplicate: "Duplicado",
  ignored: "Ignorar",
  rejected: "Rejeitar",
};

const actionClasses: Record<RowAction, string> = {
  created: "bg-emerald-50 text-emerald-700 border-emerald-200",
  updated: "bg-blue-50 text-blue-700 border-blue-200",
  duplicate: "bg-amber-50 text-amber-700 border-amber-200",
  ignored: "bg-slate-50 text-slate-700 border-slate-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function isDuplicate(row: RowResult): boolean {
  return row.action === "duplicate" || (
    row.action === "rejected"
    && /duplicad|já existe|mesmo arquivo|repetido/i.test(row.reason ?? "")
  );
}

function countRows(report: ImportReport | null) {
  const results = report?.results ?? [];
  return {
    created: results.filter(row => row.action === "created").length,
    updated: results.filter(row => row.action === "updated").length,
    duplicate: results.filter(isDuplicate).length,
    ignored: results.filter(row => row.action === "ignored").length,
    errors: results.filter(row => row.action === "rejected" && !isDuplicate(row)).length,
  };
}

export function sanitizeImportFailureCell(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

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
  const data = await response.json().catch(() => ({})) as {
    error?: string;
    message?: string;
    report?: ImportReport;
    replayed?: boolean;
  };
  if (!response.ok) throw new Error(data.message ?? data.error ?? "Não foi possível processar a planilha.");
  if (!data.report) throw new Error("A resposta da importação é inválida.");
  return data;
}

export function OperationalImportModal({ entity, title, open, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commitLockRef = useRef(false);
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [contentBase64, setContentBase64] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [localPreview, setLocalPreview] = useState<LocalSpreadsheetPreview | null>(null);
  const [contract, setContract] = useState<ImportContract | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const busy = phase === "previewing" || phase === "importing";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContract(null);
    void fetch(`/api/spreadsheet-imports/contracts/${entity}`, { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar o contrato desta importação.");
        return response.json() as Promise<ImportContract>;
      })
      .then(value => { if (!cancelled) setContract(value); })
      .catch(error => {
        if (!cancelled) {
          toast({
            title: "Contrato indisponível",
            description: error instanceof Error ? error.message : String(error),
            variant: "destructive",
          });
        }
      });
    return () => { cancelled = true; };
  }, [entity, open, toast]);

  function reset() {
    commitLockRef.current = false;
    setFile(null);
    setContentBase64("");
    setReport(null);
    setLocalPreview(null);
    setPhase("idle");
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function preview(selected: File) {
    setPhase("previewing");
    setProgress(15);
    setReport(null);
    setFile(selected);
    try {
      const parsed = await readSpreadsheetPreview(selected);
      setLocalPreview(parsed);
      setProgress(45);
      const base64 = await fileToBase64(selected);
      const result = await postImport("preview", { entity, filename: selected.name, contentBase64: base64 });
      setContentBase64(base64);
      setReport(result.report!);
      setPhase("ready");
      setProgress(100);
    } catch (error) {
      reset();
      toast({
        title: "Planilha inválida",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  }

  async function commit() {
    if (commitLockRef.current || !file || !contentBase64 || !report || phase !== "ready") return;
    commitLockRef.current = true;
    setPhase("importing");
    setProgress(20);
    try {
      const idempotencyKey = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${file.name}`;
      const result = await postImport("import", {
        entity,
        filename: file.name,
        contentBase64,
        idempotencyKey,
      });
      setReport(result.report!);
      setProgress(100);
      setPhase("complete");
      const imported = result.report!.results.filter(row => row.action === "created" || row.action === "updated").length;
      const counts = countRows(result.report!);
      toast({
        title: result.replayed ? "Importação já processada" : "Importação concluída",
        description: `${imported} linha(s) gravada(s), ${counts.duplicate} duplicado(s) e ${counts.errors} erro(s).`,
        variant: counts.errors > 0 ? "destructive" : "default",
      });
      if (imported > 0) onImported();
    } catch (error) {
      setPhase("ready");
      setProgress(100);
      toast({
        title: "Erro na importação",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      commitLockRef.current = false;
    }
  }

  const counts = countRows(report);
  const recognizedColumns = contract?.columns.filter(column =>
    localPreview?.normalizedHeaders.includes(normalizeSpreadsheetHeader(column.key)),
  ) ?? [];
  const unknownColumns = localPreview?.headers.filter((_, index) =>
    !contract?.columns.some(column =>
      normalizeSpreadsheetHeader(column.key) === localPreview.normalizedHeaders[index],
    ),
  ) ?? [];
  const failedRows = report?.results.filter(row => row.action === "rejected" || isDuplicate(row)) ?? [];
  const alreadyImported = phase !== "complete"
    && Boolean(report?.results.length)
    && report!.results.every(row => row.action === "ignored");
  const hasImportableRows = Boolean(report?.results.some(row =>
    row.action === "created" || row.action === "updated",
  ));

  function downloadFailures() {
    if (!failedRows.length) return;
    const quote = (value: string) => `"${sanitizeImportFailureCell(value).replace(/"/g, "\"\"")}"`;
    const content = [
      ["Linha", "ID Externo", "Ação", "Problema"],
      ...failedRows.map(row => [
        String(row.line),
        row.sourceKey ?? "",
        actionLabels[isDuplicate(row) ? "duplicate" : row.action],
        row.reason ?? "",
      ]),
    ].map(row => row.map(quote).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `falhas_${entity}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Use o modelo versionado de {entityLabels[entity]}. A prévia valida o contrato antes de qualquer gravação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {contract && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
              <p className="font-medium">Contrato v{contract.version} · campos obrigatórios marcados no modelo</p>
              <p className="text-muted-foreground">
                Dependências: {contract.dependencies.length
                  ? `${contract.dependencies.map(dependency => entityLabels[dependency]).join(", ")}. Importe esses conjuntos primeiro.`
                  : "nenhuma."}
              </p>
              {contract.derivedFieldsExcluded.length > 0 && (
                <p className="text-muted-foreground">
                  Esta operação grava somente as colunas do modelo; não recalcula/importa: {contract.derivedFieldsExcluded.join(", ")}.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/spreadsheet-imports/templates/${entity}.csv`}>
                <Download className="w-4 h-4 mr-2" />Modelo CSV
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/spreadsheet-imports/templates/${entity}.xlsx`}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />Modelo XLSX
              </a>
            </Button>
          </div>

          <button
            type="button"
            className="w-full border-2 border-dashed rounded-lg p-7 text-center hover:bg-muted/30 transition-colors"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy
              ? <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />
              : <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />}
            <span className="text-sm text-muted-foreground">
              {file ? file.name : "Selecionar arquivo CSV ou XLSX (máximo 5 MB e 2.000 linhas)"}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={event => {
              const selected = event.target.files?.[0];
              if (selected) void preview(selected);
              event.target.value = "";
            }}
          />

          {busy && (
            <div className="space-y-1">
              <Progress value={progress} aria-label={phase === "previewing" ? "Validando planilha" : "Importando planilha"} />
              <p className="text-xs text-muted-foreground">
                {phase === "previewing" ? "Lendo arquivo e validando contrato…" : "Gravando linhas com segurança…"} {progress}%
              </p>
            </div>
          )}

          {localPreview && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Arquivo: {file?.name ?? "selecionado"} · {localPreview.rows.length} linha(s)</p>
              <p className="text-xs text-muted-foreground">
                Colunas reconhecidas: {recognizedColumns.length
                  ? recognizedColumns.map(column => column.label).join(", ")
                  : "nenhuma"}
                {unknownColumns.length > 0 && ` · Não reconhecidas: ${unknownColumns.join(", ")}`}
              </p>
              <div className="border rounded-lg max-h-48 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      {localPreview.headers.map((header, index) => (
                        <th className="text-left p-2 whitespace-nowrap" key={`${header}-${index}`}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {localPreview.rows.slice(0, 5).map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t">
                        {localPreview.headers.map((_, columnIndex) => (
                          <td className="p-2 max-w-[180px] truncate" key={columnIndex}>{row[columnIndex] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Prévia das primeiras 5 linhas. A numeração original é preservada no resultado.
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {phase === "complete" ? "Relatório da importação" : "Prévia do contrato"} v{report.contractVersion} · {report.totalRows} linha(s)
                </p>
                {alreadyImported
                  ? <span className="text-xs text-amber-700 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Este arquivo já foi importado</span>
                  : counts.errors + counts.duplicate > 0
                  ? <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{counts.errors} erro(s), {counts.duplicate} duplicado(s)</span>
                  : <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Arquivo válido</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  ["Criados", counts.created, "text-emerald-700"],
                  ["Atualizados", counts.updated, "text-blue-700"],
                  ["Duplicados", counts.duplicate, "text-amber-700"],
                  ["Ignorados", counts.ignored, "text-slate-700"],
                  ["Erros", counts.errors, "text-destructive"],
                ].map(([label, value, color]) => (
                  <div className="rounded-md border p-2" key={String(label)}>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className={`text-lg font-semibold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="border rounded-lg max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Linha</th>
                      <th className="text-left p-2">ID Externo</th>
                      <th className="text-left p-2">Ação</th>
                      <th className="text-left p-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map(row => {
                      const displayAction = isDuplicate(row) ? "duplicate" : row.action;
                      return (
                        <tr key={`${row.line}-${row.sourceKey ?? ""}`} className="border-t">
                          <td className="p-2">{row.line}</td>
                          <td className="p-2">{row.sourceKey ?? row.label ?? "—"}</td>
                          <td className="p-2"><Badge variant="outline" className={actionClasses[displayAction]}>{actionLabels[displayAction]}</Badge></td>
                          <td className="p-2 text-muted-foreground">{row.reason ?? "Pronta para processar"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {failedRows.length > 0 && (
                <Button variant="outline" size="sm" onClick={downloadFailures}>
                  <Download className="w-4 h-4 mr-2" />Baixar falhas para correção ({failedRows.length})
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>Fechar</Button>
          <Button
            onClick={() => void commit()}
            disabled={busy || phase !== "ready" || !hasImportableRows}
          >
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando</> : "Confirmar importação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}