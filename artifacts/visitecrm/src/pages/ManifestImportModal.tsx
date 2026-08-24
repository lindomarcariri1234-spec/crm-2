import { useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { parseManifestFile, type ManifestPassengerRow } from "@/lib/manifest-import";

interface Result {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
  errors: string[];
}

export function ManifestImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [rows, setRows] = useState<ManifestPassengerRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [importing, setImporting] = useState(false);

  function reset() {
    setRows([]); setHeaders([]); setParseErrors([]); setResult(null);
  }

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = await parseManifestFile(file);
      setRows(parsed.rows); setHeaders(parsed.headers); setParseErrors(parsed.errors); setResult(null);
      if (!parsed.rows.length) toast({ title: "Nenhuma linha válida encontrada", variant: "destructive" });
    } catch (error) {
      toast({ title: "Não foi possível ler o arquivo", description: error instanceof Error ? error.message : "Arquivo inválido.", variant: "destructive" });
    }
  }

  async function importRows() {
    if (!rows.length || importing) return;
    setImporting(true); setResult(null);
    try {
      const response = await fetch("/api/reservations/import-manifest", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = await response.json().catch(() => ({})) as Result & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível importar o manifesto.");
      setResult(body);
      toast({ title: "Importação concluída", description: `${body.created} criado(s) e ${body.updated} atualizado(s).` });
    } catch (error) {
      toast({ title: "Erro na importação", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  const issues = [...parseErrors, ...(result?.errors ?? []), ...(result?.warnings ?? [])];
  return (
    <Dialog open={open} onOpenChange={value => { if (!value && !importing) { reset(); onClose(); } }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar Manifesto ANTT</DialogTitle>
          <DialogDescription>
            Envie o Excel do Manifesto ANTT ou um CSV equivalente. A importação só adiciona ou atualiza passageiros de reservas já existentes nesta agência; não altera check-ins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={importing}>
              <Upload className="mr-2 h-4 w-4" /> Selecionar XLSX ou CSV
            </Button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={selectFile} />
            {headers.length > 0 && <span className="text-xs text-muted-foreground">{rows.length} linha(s) pronta(s) para importar</span>}
          </div>

          {headers.length > 0 && (
            <>
              <div className="overflow-auto rounded-md border max-h-56">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr>{headers.slice(0, 8).map((header, index) => <th className="whitespace-nowrap px-2 py-2 text-left" key={`${header}-${index}`}>{header}</th>)}</tr></thead>
                  <tbody>{rows.slice(0, 5).map(row => <tr className="border-t" key={row.line}>
                    <td className="px-2 py-2">{row.line}</td><td className="px-2 py-2">{row.tripName}</td><td className="px-2 py-2">{row.departureDate}</td><td className="px-2 py-2">{row.reservationNumber}</td><td className="px-2 py-2">{row.name}</td><td className="px-2 py-2">{row.cpf ?? "—"}</td><td className="px-2 py-2">{row.birthDate ?? "—"}</td><td className="px-2 py-2">{row.ageCategory ?? "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground"><FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" /> Prévia das primeiras 5 linhas. Colunas: {headers.join(", ")}.</p>
            </>
          )}
          {importing && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Importando todas as linhas no servidor…</p>}
          {result && <p className="text-sm"><strong>{result.created}</strong> criado(s), <strong>{result.updated}</strong> atualizado(s) e <strong>{result.skipped}</strong> ignorado(s).</p>}
          {issues.length > 0 && <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-3">
            {issues.map((issue, index) => <p className="flex gap-1 text-xs text-amber-900" key={`${issue}-${index}`}><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{issue}</p>)}
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={importing}>Fechar</Button>
          <Button onClick={importRows} disabled={importing || rows.length === 0}>{importing ? "Importando…" : "Importar passageiros"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}