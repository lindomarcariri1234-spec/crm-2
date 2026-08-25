import { useRef, useState } from "react";
import { Download, Loader2, Upload, AlertCircle } from "lucide-react";
import type { CreateTripBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { buildTripCsvData, parseTripCsv, TRIP_CSV_HEADERS } from "@/lib/trip-csv-import";

interface TripCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function downloadTemplate() {
  const example = [
    "Excursão para Natal", "Praias do RN", "Natal", "RN", "15/12/2026",
    "20/12/2026", "06:00", "18:00", "1890,00", "950,00", "1600,00", "46",
    "excursao", "standard", "Juazeiro do Norte", "CE", "Praça Central; Rodoviária",
    "Transporte ida e volta; Guia turístico", "Despesas pessoais", "Ônibus",
    "ABC-1234", "João da Silva", "Maria Guia", "Agência", "draft",
  ];
  const csv = [TRIP_CSV_HEADERS, example]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = "modelo_viagens.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

export function TripCsvImportModal({ open, onClose, onImported }: TripCsvImportModalProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [validRows, setValidRows] = useState<Array<{ line: number; data: CreateTripBody }>>([]);
  const [preview, setPreview] = useState<Array<{ line: number; data?: CreateTripBody }>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [importIdempotencyKey, setImportIdempotencyKey] = useState("");

  function reset() {
    setHeaders([]);
    setRows([]);
    setValidRows([]);
    setPreview([]);
    setErrors([]);
    setProgress(0);
    setSuccessCount(0);
    setIgnoredCount(0);
    setImportIdempotencyKey("");
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTripCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        toast({ title: "CSV inválido", description: "O arquivo precisa conter cabeçalho e pelo menos uma viagem.", variant: "destructive" });
        return;
      }
      const dataRows = parsed.slice(1).filter(row => row.some(cell => cell.trim()));
      const validated = dataRows.map((row, index) => ({
        line: index + 2,
        result: buildTripCsvData(parsed[0], row, index + 2),
      }));
      const validationErrors = validated.flatMap(({ result }) => result.error ? [result.error] : []);
      const importable = validated.flatMap(({ line, result }) => result.data ? [{ line, data: result.data }] : []);
      setHeaders(parsed[0]);
      setRows(dataRows);
      setValidRows(importable);
      setPreview(validated.slice(0, 5).map(({ line, result }) => ({ line, data: result.data })));
      setErrors(validationErrors);
      setSuccessCount(0);
      setIgnoredCount(0);
      setProgress(0);
      setImportIdempotencyKey(crypto.randomUUID());
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  }

  async function handleImport() {
    if (!validRows.length || importing) return;
    setImporting(true);
    setProgress(0);
    setSuccessCount(0);
    setIgnoredCount(0);
    const requestIdempotencyKey = importIdempotencyKey || crypto.randomUUID();
    if (!importIdempotencyKey) setImportIdempotencyKey(requestIdempotencyKey);
    const importErrors: string[] = [];
    let imported = 0;
    let ignored = 0;
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const importRows = rows.map((row, index) => ({
      line: index + 2,
      data: buildTripCsvData(headers, row, index + 2).data ?? {},
    }));
    setProgress(10);

    try {
      const response = await fetch(`${basePath}/api/trips/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: requestIdempotencyKey,
          rows: importRows,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        results?: Array<{ line: number; name: string; status: "created" | "duplicate" | "error"; error?: string }>;
      };
      if (!response.ok) {
        importErrors.push(body.error ?? "A importação não foi concluída. Tente retomar.");
      } else {
        const results = body.results ?? [];
        imported = results.filter(result => result.status === "created").length;
        ignored = results.filter(result => result.status === "duplicate").length;
        setSuccessCount(imported);
        setIgnoredCount(ignored);
        importErrors.push(
          ...results
            .filter(result => result.status === "error")
            .map(result => `Linha ${result.line}: ${result.name} — ${result.error ?? "erro ao criar viagem"}`),
        );
        if (imported > 0) onImported();
      }
      setProgress(100);
    } catch {
      importErrors.push("Importação interrompida por erro de rede. Clique em retomar para continuar sem duplicar viagens.");
    }

    setImporting(false);
    setErrors(importErrors);
    if (importErrors.length === 0) setImportIdempotencyKey("");
    toast({
      title: importErrors.length
        ? "Importação interrompida ou concluída com erros"
        : `Importação concluída: ${imported} criada(s), ${ignored} ignorada(s)`,
      variant: importErrors.length ? "destructive" : "default",
    });
  }

  function handleClose() {
    if (importing) return;
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) handleClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar Viagens via CSV</DialogTitle>
          <DialogDescription>
            Nome, destino, cidade/UF de destino, data de saída e preço adulto são obrigatórios.
            Datas podem usar DD/MM/AAAA ou ISO e valores podem usar o formato brasileiro. Registros são validados antes da confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-2" /> Baixar modelo CSV
            </Button>
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" /> Selecionar arquivo
            </Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {headers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Pré-visualização (primeiras 5 viagens)</p>
                <span className="text-xs text-muted-foreground">
                  {rows.length} registro(s): {validRows.length} pronto(s), {rows.length - validRows.length} com erro
                </span>
              </div>
              <div className="overflow-x-auto border rounded-lg max-h-64">
                <table className="text-xs w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      {["Linha", "Nome", "Destino", "Saída", "Preço adulto", "Capacidade", "Status"].map(header => (
                        <th key={header} className="px-2 py-2 text-left font-medium whitespace-nowrap">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(({ line, data }) => (
                      <tr key={line} className="border-t">
                        <td className="px-2 py-2">{line}</td>
                        <td className="px-2 py-2 truncate max-w-[220px]">{data?.name ?? "Inválida"}</td>
                        <td className="px-2 py-2 truncate max-w-[150px]">{data ? `${data.destinationCity}/${data.destinationState}` : "—"}</td>
                        <td className="px-2 py-2">{data?.departureDate ?? "—"}</td>
                        <td className="px-2 py-2">{data?.priceAdult ?? "—"}</td>
                        <td className="px-2 py-2">{data?.totalCapacity ?? "—"}</td>
                        <td className="px-2 py-2">{data?.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Colunas detectadas: {headers.join(", ")}. IDs, agência de origem, slugs, auditoria e ocupação não são importados.
              </p>
            </div>
          )}

          {importing && (
            <div className="space-y-2">
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                 <Loader2 className="w-3 h-3 animate-spin" /> Enviando lote... {progress}%
              </p>
            </div>
          )}

          {!importing && (successCount > 0 || ignoredCount > 0) && (
            <p className="text-sm text-green-700">
              Resumo: {successCount} criada(s), {ignoredCount} ignorada(s) por já existir e {errors.length} erro(s).
            </p>
          )}
          {errors.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto border rounded-lg p-3 bg-destructive/10">
              {errors.map((error, index) => (
                <p key={index} className="text-xs text-destructive flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>Cancelar</Button>
          <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
            {importing
              ? `Enviando lote ${progress}%...`
              : importIdempotencyKey && errors.length > 0
                ? `Retomar importação (${rows.length} linha(s))`
                : `Confirmar e importar ${rows.length} viagem(ns)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}