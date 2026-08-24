import { useRef, useState } from "react";
import { Download, Loader2, Upload, AlertCircle } from "lucide-react";
import { useCreateTrip } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { buildTripCsvData, parseTripFile, TRIP_CSV_HEADERS } from "@/lib/trip-csv-import";

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
  const createTrip = useCreateTrip();
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);

  function reset() {
    setHeaders([]);
    setRows([]);
    setPreview([]);
    setErrors([]);
    setProgress(0);
    setSuccessCount(0);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseTripFile(file);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setPreview(parsed.rows.slice(0, 5));
      setErrors([]);
      setSuccessCount(0);
    } catch (error) {
      toast({
        title: "Arquivo inválido",
        description: error instanceof Error ? error.message : "Não foi possível ler o arquivo de viagens.",
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  }

  async function handleImport() {
    if (!rows.length || importing) return;
    setImporting(true);
    setProgress(0);
    setSuccessCount(0);
    setErrors([]);
    const importErrors: string[] = [];
    let imported = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const result = buildTripCsvData(headers, rows[index], index + 2);
      if (result.error || !result.data) {
        importErrors.push(result.error ?? `Linha ${index + 2}: dados inválidos`);
      } else {
        try {
          await createTrip.mutateAsync({ data: result.data });
          imported += 1;
          setSuccessCount(imported);
        } catch (error: unknown) {
          const responseData = (error as { data?: Record<string, unknown> })?.data
            ?? (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
          const message = typeof responseData?.error === "string"
            ? responseData.error
            : "erro ao criar viagem";
          importErrors.push(`Linha ${index + 2}: ${result.data.name} — ${message}`);
        }
      }
      setProgress(Math.round(((index + 1) / rows.length) * 100));
    }

    setImporting(false);
    setErrors(importErrors);
    onImported();
    if (importErrors.length === 0) {
      toast({ title: `${imported} viagens importadas com sucesso!` });
      onClose();
      reset();
    } else {
      toast({
        title: `Importação concluída: ${imported} criada(s), ${importErrors.length} erro(s)`,
        variant: "destructive",
      });
    }
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
          <DialogTitle>Importar Viagens</DialogTitle>
          <DialogDescription>
            Nome, destino, cidade/UF de destino, data de saída e preço adulto são obrigatórios.
            Aceita CSV ou XLSX; dados de ocupação, IDs e tenant da origem não são importados.
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
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => { void handleFile(event); }}
            />
          </div>

          {headers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Pré-visualização (primeiras 5 viagens)</p>
                <span className="text-xs text-muted-foreground">{rows.length} registro(s) detectado(s)</span>
              </div>
              <div className="overflow-x-auto border rounded-lg max-h-64">
                <table className="text-xs w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>{headers.slice(0, 8).map((header, index) => <th key={`${header}-${index}`} className="px-2 py-2 text-left font-medium whitespace-nowrap">{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t">
                        {row.slice(0, 8).map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-2 truncate max-w-[150px]">{cell || "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Colunas detectadas: {headers.join(", ")}</p>
            </div>
          )}

          {importing && (
            <div className="space-y-2">
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Importando... {progress}%
              </p>
            </div>
          )}

          {!importing && successCount > 0 && (
            <p className="text-sm text-green-700">{successCount} viagem(ns) criada(s) nesta importação.</p>
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
          <Button onClick={handleImport} disabled={importing || rows.length === 0}>
            {importing ? `Importando ${progress}%...` : "Importar viagens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}