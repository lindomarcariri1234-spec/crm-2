import { useRef, useState } from "react";
import { AlertCircle, Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  buildReservationCsvData,
  parseReservationCsv,
  resolveReservationCsvData,
  type ReservationImportClient,
  type ReservationImportTrip,
} from "@/lib/reservation-csv-import";

interface ReservationCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function downloadTemplate() {
  const headers = ["Cliente", "Viagem", "Saída", "Status", "Assentos", "Valor Total (R$)", "Valor Pago (R$)", "Forma de Pagamento", "Parcelas"];
  const example = ["Maria da Silva", "Excursão para Natal", "15/12/2026", "pending", "12", "1.890,00", "500,00", "PIX", "3"];
  const csv = [headers, example].map(row => row.map(cell => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo_reservas.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchAllPages<T>(resource: "clients" | "trips"): Promise<T[]> {
  const items: T[] = [];
  const limit = 500;
  let page = 1;
  let total = Infinity;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  while (items.length < total) {
    const response = await fetch(`${basePath}/api/${resource}?page=${page}&limit=${limit}`, { credentials: "include" });
    if (!response.ok) throw new Error(`Não foi possível carregar ${resource === "clients" ? "clientes" : "viagens"}.`);
    const payload = await response.json() as { data?: T[]; total?: number };
    const pageItems = payload.data ?? [];
    items.push(...pageItems);
    total = payload.total ?? items.length;
    if (pageItems.length === 0) break;
    page += 1;
  }

  return items;
}

interface ImportedReservationResponse {
  id: string;
  status: string;
}

async function sendReservationImportRequest(
  path: string,
  method: "POST" | "PATCH",
  data: Record<string, unknown>,
): Promise<ImportedReservationResponse> {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${basePath}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-visitecrm-import": "reservation-csv",
    },
    body: JSON.stringify(data),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw { data: body };
  }
  if (typeof body.id !== "string" || typeof body.status !== "string") {
    throw { data: { error: "A resposta da reserva importada é inválida." } };
  }
  return { id: body.id, status: body.status };
}

export function ReservationCsvImportModal({ open, onClose, onImported }: ReservationCsvImportModalProps) {
  const { toast } = useToast();
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

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseReservationCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        toast({ title: "CSV inválido", description: "O arquivo precisa conter cabeçalho e pelo menos uma reserva.", variant: "destructive" });
        return;
      }
      const dataRows = parsed.slice(1).filter(row => row.some(cell => cell.trim()));
      setHeaders(parsed[0]);
      setRows(dataRows);
      setPreview(dataRows.slice(0, 5));
      setErrors([]);
      setSuccessCount(0);
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  }

  async function handleImport() {
    if (!rows.length || importing) return;
    setImporting(true);
    setProgress(0);
    setSuccessCount(0);
    setErrors([]);

    let clients: ReservationImportClient[];
    let trips: ReservationImportTrip[];
    try {
      [clients, trips] = await Promise.all([
        fetchAllPages<ReservationImportClient>("clients"),
        fetchAllPages<ReservationImportTrip>("trips"),
      ]);
    } catch (error) {
      setImporting(false);
      toast({ title: "Não foi possível preparar a importação", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
      return;
    }

    const importErrors: string[] = [];
    let imported = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const lineNumber = index + 2;
      const parsed = buildReservationCsvData(headers, rows[index], lineNumber);
      if (parsed.error || !parsed.data) {
        importErrors.push(parsed.error ?? `Linha ${lineNumber}: dados inválidos`);
        setProgress(Math.round(((index + 1) / rows.length) * 100));
        continue;
      }

      const resolved = resolveReservationCsvData(parsed.data, clients, trips, lineNumber);
      if (resolved.error || !resolved.data) {
        importErrors.push(resolved.error ?? `Linha ${lineNumber}: dados inválidos`);
      } else {
        try {
          const created = await sendReservationImportRequest("/api/reservations", "POST", {
            tripId: resolved.data.tripId,
            clientId: resolved.data.clientId,
            seats: resolved.data.seats,
            totalValue: resolved.data.totalValue,
            paidValue: resolved.data.paidValue,
            paymentMethod: resolved.data.paymentMethod,
            installments: resolved.data.installments,
          });
          if (created.status !== resolved.data.status) {
            await sendReservationImportRequest(`/api/reservations/${created.id}`, "PATCH", { status: resolved.data.status });
          }
          imported += 1;
          setSuccessCount(imported);
        } catch (error: unknown) {
          const responseData = (error as { data?: Record<string, unknown> })?.data
            ?? (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
          const message = typeof responseData?.error === "string" ? responseData.error : "erro ao criar reserva";
          importErrors.push(`Linha ${lineNumber}: ${resolved.data.clientName} — ${message}`);
        }
      }
      setProgress(Math.round(((index + 1) / rows.length) * 100));
    }

    setImporting(false);
    setErrors(importErrors);
    if (imported > 0) onImported();
    if (importErrors.length === 0) {
      toast({ title: `${imported} reserva(s) importada(s) com sucesso!` });
      onClose();
      reset();
    } else {
      toast({ title: `Importação concluída: ${imported} criada(s), ${importErrors.length} erro(s)`, variant: "destructive" });
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
          <DialogTitle>Importar Reservas via CSV</DialogTitle>
          <DialogDescription>
            O arquivo deve informar cliente, viagem e valor total. Cliente e viagem precisam já estar cadastrados nesta agência.
            A data de saída ajuda a identificar viagens com o mesmo nome.
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
                <p className="text-sm font-medium">Pré-visualização (primeiras 5 reservas)</p>
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

          {!importing && successCount > 0 && <p className="text-sm text-green-700">{successCount} reserva(s) criada(s) nesta importação.</p>}
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
            {importing ? `Importando ${progress}%...` : "Importar reservas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}