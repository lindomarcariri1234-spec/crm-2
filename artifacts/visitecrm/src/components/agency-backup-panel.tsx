import { useState, type ChangeEvent } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";
import { parseBackupText, validateBackupDownload, type ParsedBackup } from "@/lib/backup-file";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Building2,
  DatabaseBackup,
  Download,
  FileJson,
  Loader2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseBackupFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1] ?? null;
}

interface BackupImportGroupResult {
  created: number;
  duplicate: number;
  skipped: number;
  errors: Array<{ sourceId?: string; label?: string; error: string }>;
}

interface BackupImportUserMatch {
  sourceId: string;
  email: string | null;
  name: string | null;
}

interface BackupImportReport {
  agencia: { updated: boolean };
  usuarios: { matched: number; fallbackToImporter: number; fallbackDetails: BackupImportUserMatch[] };
  clientes: BackupImportGroupResult;
  viagens: BackupImportGroupResult;
  reservas: BackupImportGroupResult;
  passageiros: BackupImportGroupResult;
  embarqueLocais: BackupImportGroupResult;
  checkins: BackupImportGroupResult;
  automacoes: BackupImportGroupResult;
  automacaoAcoes: BackupImportGroupResult;
  automacaoLogs: BackupImportGroupResult;
  indicacoes: BackupImportGroupResult;
  lojaProdutos: BackupImportGroupResult;
  lojaCupons: BackupImportGroupResult;
  lojaPedidos: BackupImportGroupResult;
  lojaItensPedido: BackupImportGroupResult;
  pagamentos: BackupImportGroupResult;
  despesas: BackupImportGroupResult;
}

const BACKUP_IMPORT_GROUP_LABELS: Record<keyof Omit<BackupImportReport, "agencia" | "usuarios">, string> = {
  clientes: "Clientes",
  viagens: "Viagens",
  reservas: "Reservas",
  passageiros: "Passageiros",
  embarqueLocais: "Locais de embarque",
  checkins: "Check-ins",
  automacoes: "Automações",
  automacaoAcoes: "Ações de automação",
  automacaoLogs: "Logs de automação",
  indicacoes: "Indicações",
  lojaProdutos: "Produtos da loja",
  lojaCupons: "Cupons da loja",
  lojaPedidos: "Pedidos da loja",
  lojaItensPedido: "Itens de pedido da loja",
  pagamentos: "Pagamentos",
  despesas: "Despesas",
};

function BackupImportReportView({ report }: { report: BackupImportReport }) {
  const groupKeys = Object.keys(BACKUP_IMPORT_GROUP_LABELS) as Array<keyof typeof BACKUP_IMPORT_GROUP_LABELS>;
  const totalErrors = groupKeys.reduce((acc, key) => acc + report[key].errors.length, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          Agência
        </div>
        <p className="mt-1 text-muted-foreground">
          {report.agencia.updated
            ? "Configurações e marca da agência atualizadas com os dados do backup."
            : "Nenhum dado de agência encontrado para atualizar."}
        </p>
      </div>
      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Users className="w-4 h-4 text-muted-foreground" />
          Usuários (referência)
        </div>
        <p className="mt-1 text-muted-foreground">
          {report.usuarios.matched} associados por e-mail a contas existentes
          {report.usuarios.fallbackToImporter > 0 && (
            <> · {report.usuarios.fallbackToImporter} sem conta correspondente (associados a você)</>
          )}
          .
        </p>
        {report.usuarios.fallbackDetails.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {report.usuarios.fallbackDetails.slice(0, 10).map((user, index) => (
              <li key={user.sourceId ?? index}>{user.name ?? "Sem nome"} {user.email ? `(${user.email})` : ""}</li>
            ))}
            {report.usuarios.fallbackDetails.length > 10 && (
              <li>e mais {report.usuarios.fallbackDetails.length - 10}...</li>
            )}
          </ul>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tipo de registro</th>
              <th className="px-3 py-2 text-right font-medium">Criados</th>
              <th className="px-3 py-2 text-right font-medium">Já existiam</th>
              <th className="px-3 py-2 text-right font-medium">Ignorados</th>
              <th className="px-3 py-2 text-right font-medium">Erros</th>
            </tr>
          </thead>
          <tbody>
            {groupKeys.map((key) => {
              const group = report[key];
              const hasErrors = group.errors.length > 0;
              return (
                <tr key={key} className="border-t">
                  <td className="px-3 py-2">{BACKUP_IMPORT_GROUP_LABELS[key]}</td>
                  <td className="px-3 py-2 text-right">{group.created}</td>
                  <td className="px-3 py-2 text-right">{group.duplicate}</td>
                  <td className="px-3 py-2 text-right">{group.skipped}</td>
                  <td className={`px-3 py-2 text-right ${hasErrors ? "font-medium text-destructive" : ""}`}>
                    {group.errors.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalErrors > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Detalhes dos erros
          </div>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
            {groupKeys.flatMap((key) =>
              report[key].errors.slice(0, 20).map((error, index) => (
                <li key={`${key}-${index}`}>
                  <span className="font-medium">{BACKUP_IMPORT_GROUP_LABELS[key]}:</span> {error.error}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AgencyBackupPanel() {
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [isGenerating, setIsGenerating] = useState(false);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedBackup, setParsedBackup] = useState<ParsedBackup | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<BackupImportReport | null>(null);
  const [importIdempotencyKey, setImportIdempotencyKey] = useState<string | null>(null);

  async function handleGenerateBackup() {
    setIsGenerating(true);
    setReceivedBytes(0);
    try {
      const response = await fetch(`${BASE}/api/backup/export`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as
          | { error?: string; message?: string }
          | null;
        throw new Error(payload?.message ?? payload?.error ?? "Não foi possível gerar o backup.");
      }
      if (!response.body) {
        const blob = await validateBackupDownload(await response.blob(), response.headers.get("Content-Type"));
        downloadBackupBlob(blob, response.headers.get("Content-Disposition"));
        setReceivedBytes(blob.size);
        toast({ title: "Backup gerado com sucesso", description: "O download do arquivo foi iniciado." });
        return;
      }

      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value as BlobPart);
          total += value.byteLength;
          setReceivedBytes(total);
        }
      }
      const blob = await validateBackupDownload(
        new Blob(chunks, { type: "application/json" }),
        response.headers.get("Content-Type"),
      );
      downloadBackupBlob(blob, response.headers.get("Content-Disposition"));
      toast({ title: "Backup gerado com sucesso", description: "O download do arquivo foi iniciado." });
    } catch (error) {
      toast({
        title: "Erro ao gerar backup",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setImportReport(null);
    setParseError(null);
    setSelectedFile(null);
    setParsedBackup(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setParseError("Selecione um arquivo .json gerado pela exportação de backup.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackupText(String(reader.result ?? ""));
        setSelectedFile(file);
        setParsedBackup(parsed);
        setConfirmOpen(true);
      } catch (error) {
        setParseError(error instanceof Error ? error.message : "Não foi possível validar o arquivo selecionado.");
      }
    };
    reader.onerror = () => setParseError("Não foi possível ler o arquivo selecionado.");
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!parsedBackup) return;
    setConfirmOpen(false);
    setIsImporting(true);
    setImportReport(null);
    try {
      const idempotencyKey = importIdempotencyKey ?? crypto.randomUUID();
      setImportIdempotencyKey(idempotencyKey);
      const response = await fetch(`${BASE}/api/backup/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, backup: parsedBackup }),
      });
      const payload = await response.json().catch(() => null) as
        | { report?: BackupImportReport; replayed?: boolean; message?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? "Não foi possível restaurar o backup.");
      }
      if (!payload?.report) throw new Error("Resposta inesperada do servidor.");
      setImportReport(payload.report);
      setImportIdempotencyKey(null);
      setSelectedFile(null);
      setParsedBackup(null);
      toast({
        title: payload.replayed ? "Backup já havia sido restaurado" : "Backup restaurado com sucesso",
        description: "Veja o relatório abaixo para os detalhes por tipo de registro.",
      });
    } catch (error) {
      toast({
        title: "Erro ao restaurar backup",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  }

  function downloadBackupBlob(blob: Blob, contentDisposition: string | null) {
    const filename = parseBackupFilename(contentDisposition)
      ?? `backup-agencia-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  if (me?.role !== ROLES.AGENCY_ADMIN) return null;

  return (
    <div className="space-y-3" data-testid="agency-backup-panel">
      <section aria-labelledby="backup-export-title" className="rounded-md border bg-muted/20 px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 id="backup-export-title" className="flex items-center gap-1.5 text-sm font-medium">
              <DatabaseBackup className="h-4 w-4 text-muted-foreground" />
              Exportar cópia completa
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground" data-testid="text-backup-export-description">
              JSON com os dados operacionais da agência. Não inclui credenciais; contém dados pessoais e deve ser guardado em local seguro.
            </p>
          </div>
          <Button
            onClick={handleGenerateBackup}
            disabled={isGenerating}
            size="sm"
            className="shrink-0 gap-2"
            data-testid="button-generate-agency-backup"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isGenerating ? "Gerando..." : "Baixar backup"}
          </Button>
        </div>
        {isGenerating && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span data-testid="status-backup-export-progress">
              {receivedBytes > 0
                ? `Montando arquivo... ${formatBackupBytes(receivedBytes)} recebidos`
                : "Preparando exportação..."}
            </span>
            <span>Não feche esta página enquanto o arquivo é gerado.</span>
          </div>
        )}
      </section>

      <section aria-labelledby="backup-restore-title" className="rounded-md border px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 id="backup-restore-title" className="flex items-center gap-1.5 text-sm font-medium">
              <Upload className="h-4 w-4 text-muted-foreground" />
              Restaurar de arquivo
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Use um backup JSON válido. Usuários são associados por e-mail quando possível; registros existentes não são duplicados.
            </p>
          </div>
          <Button variant="outline" asChild disabled={isImporting} className="shrink-0 gap-2">
            <label
              htmlFor="agency-backup-json-file"
              className="cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
              data-testid="label-agency-backup-file"
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              {isImporting ? "Restaurando..." : "Selecionar JSON"}
            </label>
          </Button>
          <input
            id="agency-backup-json-file"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={isImporting}
            onChange={handleFileSelected}
            aria-label="Selecionar arquivo JSON de backup"
            data-testid="input-agency-backup-file"
          />
        </div>
        {parseError && (
          <div className="mt-2 flex items-center gap-2 text-xs text-destructive" data-testid="status-backup-parse-error">
            <XCircle className="h-4 w-4 shrink-0" />
            {parseError}
          </div>
        )}
        {importReport && (
          <div className="pt-2">
            <h3 className="mb-2 text-sm font-medium">Relatório da restauração</h3>
            <BackupImportReportView report={importReport} />
          </div>
        )}
      </section>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar dados deste backup?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-2 block">
                <strong>Origem:</strong>{" "}
                {String((parsedBackup?.tenant as { name?: string; slug?: string } | undefined)?.name
                  ?? (parsedBackup?.tenant as { slug?: string } | undefined)?.slug
                  ?? ((parsedBackup as Record<string, unknown> | null)?.meta as { tenantName?: string } | undefined)?.tenantName
                  ?? "Agência identificada no backup")}
                <br />
                <strong>Destino:</strong> {me?.tenant?.name ?? "sua agência atual"}
              </span>
              O arquivo <strong>{selectedFile?.name}</strong> será usado para recriar clientes,
              viagens, reservas, embarque/check-in, automações, indicações, loja e financeiro na
              sua agência. Registros já existentes serão identificados e ignorados — nenhum dado
              atual será removido. Esta ação não pode ser desfeita automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setSelectedFile(null); setParsedBackup(null); }}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport}>Restaurar backup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
