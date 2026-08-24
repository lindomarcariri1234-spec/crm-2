import { useState } from "react";
import { useListReferrals, useListCommissions, useListDeals } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Download, FileText, FileSpreadsheet, Users, Map, CalendarCheck, DollarSign, Bus, Loader2, BarChart2,
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import {
  fmtDate,
  fmtCur,
  prepareClients,
  prepareTrips,
  prepareManifest,
  prepareReservations,
  prepareReferrals,
  prepareCommissions,
  preparePipeline,
  downloadXlsx,
  downloadPdf,
} from "./downloads-utils.js";

function downloadCsv(rows: string[][], filename: string) {
  const content = rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const FORMAT_STYLES: Record<string, string> = {
  csv: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
  xlsx: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  pdf: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100",
};

const FORMAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  csv: FileText, xlsx: FileSpreadsheet, pdf: FileText,
};

const REPORT_TYPES = [
  { value: "financial", label: "Financeiro", description: "Receitas, despesas e balanço" },
  { value: "sales", label: "Vendas", description: "Reservas e métricas de vendas" },
  { value: "clients", label: "Clientes", description: "Cadastro e histórico de clientes" },
  { value: "trips", label: "Viagens", description: "Catálogo de viagens por data de saída" },
  { value: "manifest", label: "Manifesto ANTT", description: "Passageiros por período de saída das viagens" },
] as const;

type ReportType = "financial" | "sales" | "clients" | "trips" | "manifest";
type ExportFormat = "csv" | "xlsx" | "pdf";

/** Fetches all pages from a paginated API endpoint and returns the merged data array. */
async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined | null>,
  pageSize = 500,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, page, limit: pageSize })) {
      if (value != null) searchParams.set(key, String(value));
    }
    const res = await fetch(`${endpoint}?${searchParams}`, { credentials: "include" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `Erro ao carregar dados (${res.status})`);
    }
    const json = await res.json() as { data: T[]; total: number };
    results.push(...json.data);
    if (results.length >= json.total || json.data.length < pageSize) break;
    page++;
  }
  return results;
}

export default function Downloads() {
  const { toast } = useToast();

  const [reportType, setReportType] = useState<ReportType>("financial");
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const [quickStart, setQuickStart] = useState(monthStart);
  const [quickEnd, setQuickEnd] = useState(today);

  // Bounded datasets — kept as eager hooks (these never approach 5 000 records)
  const { data: referralsData } = useListReferrals();
  const { data: commissionsData } = useListCommissions();
  const { data: openDealsData } = useListDeals({ status: "open" });
  const { data: lostDealsData } = useListDeals({ status: "lost" });

  // Track which quick-download card is currently loading
  const [quickLoading, setQuickLoading] = useState<string | null>(null);

  async function serverExport(fmt: ExportFormat) {
    setExporting(fmt);
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType, format: fmt, startDate, endDate }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Erro ao gerar relatório");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `relatorio.${fmt}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Relatório exportado com sucesso!" });
    } catch (err) {
      toast({ title: "Erro na exportação", description: String(err), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  // --- Async prepare functions (server-side date filter + full pagination) ---

  async function _prepareClients() {
    const all = await fetchAllPages("/api/clients", { dateFrom: quickStart, dateTo: quickEnd });
    return prepareClients(all as Parameters<typeof prepareClients>[0], quickStart, quickEnd);
  }

  async function _prepareTrips() {
    // Trips are filtered by departure date client-side (no server-side departure-date param)
    const all = await fetchAllPages("/api/trips", {});
    return prepareTrips(all as Parameters<typeof prepareTrips>[0], quickStart, quickEnd);
  }

  async function _prepareManifest() {
    // Manifest filters by trip departure date client-side
    const all = await fetchAllPages("/api/reservations", {});
    return prepareManifest(all as Parameters<typeof prepareManifest>[0], quickStart, quickEnd);
  }

  function _prepareReferrals() {
    const all = (referralsData && "data" in referralsData ? referralsData.data : []) ?? [];
    return Promise.resolve(prepareReferrals(all, quickStart, quickEnd));
  }

  function _prepareCommissions() {
    return Promise.resolve(prepareCommissions(commissionsData ?? [], quickStart, quickEnd));
  }

  async function _prepareReservations() {
    const all = await fetchAllPages<{
      id: string; client?: { name?: string } | null; trip?: { name?: string; departureDate?: string } | null;
      status: string; seats?: unknown[] | null; totalValue?: number; paidValue?: number; balance?: number;
      paymentMethod?: string | null; installments?: number | null; createdAt: string;
    }>("/api/reservations", { dateFrom: quickStart, dateTo: quickEnd });
    return prepareReservations(
      all as Parameters<typeof prepareReservations>[0],
      quickStart,
      quickEnd,
    );
  }

  async function preparePayments() {
    const all = await fetchAllPages<{
      id: string; type: string; category: string; description?: string | null;
      amount?: number; status: string; dueDate?: string; paidAt?: string | null;
      paymentMethod?: string | null; installmentNumber?: number | null; createdAt: string;
    }>("/api/payments", { dateFrom: quickStart, dateTo: quickEnd });
    const headers = ["ID", "Tipo", "Categoria", "Descrição", "Valor (R$)", "Status", "Vencimento", "Pagamento", "Forma", "Parcela", "Criado em"];
    const rows = all.map(p => [
      p.id, p.type, p.category, p.description ?? "",
      fmtCur(p.amount), p.status,
      fmtDate(p.dueDate), fmtDate(p.paidAt ?? undefined),
      p.paymentMethod ?? "",
      String(p.installmentNumber ?? ""),
      fmtDate(p.createdAt),
    ]);
    return { headers, rows, count: all.length };
  }

  function _preparePipeline() {
    const open = openDealsData ?? [];
    const lost = lostDealsData ?? [];
    return Promise.resolve(
      preparePipeline([...open, ...lost], quickStart, quickEnd),
    );
  }

  function makeFormats(
    label: string,
    prepare: () => Promise<{ headers: string[]; rows: string[][]; count: number }>,
    filenameBase: string,
  ) {
    const makeAction = (fmt: ExportFormat) => async () => {
      if (quickLoading) return;
      setQuickLoading(`${filenameBase}-${fmt}`);
      try {
        const { headers, rows, count } = await prepare();
        if (!rows.length) { toast({ title: `Sem dados de ${label} para exportar no período` }); return; }
        const filename = `${filenameBase}_${format(new Date(), "yyyyMMdd")}.${fmt}`;
        if (fmt === "csv") downloadCsv([headers, ...rows], filename);
        else if (fmt === "xlsx") downloadXlsx(headers, rows, filename);
        else downloadPdf(label, headers, rows, filename);
        toast({ title: `${count} registros exportados!` });
      } catch (err) {
        toast({ title: `Erro ao exportar ${label}`, description: String(err), variant: "destructive" });
      } finally {
        setQuickLoading(null);
      }
    };

    return (["csv", "xlsx", "pdf"] as ExportFormat[]).map(fmt => ({
      label: fmt.toUpperCase(),
      format: fmt,
      action: makeAction(fmt),
      loadingKey: `${filenameBase}-${fmt}`,
    }));
  }

  const exports = [
    {
      label: "Clientes",
      description: "Lista completa de clientes com dados de contato e histórico",
      icon: Users,
      formats: makeFormats("Clientes", _prepareClients, "clientes"),
    },
    {
      label: "Viagens",
      description: "Catálogo de viagens com datas, preços e ocupação (filtro por data de saída)",
      icon: Map,
      formats: makeFormats("Viagens", _prepareTrips, "viagens"),
    },
    {
      label: "Reservas",
      description: "Relatório de reservas com status e valores",
      icon: CalendarCheck,
      formats: makeFormats("Reservas", _prepareReservations, "reservas"),
    },
    {
      label: "Relatório Financeiro",
      description: "Receitas, despesas, pagamentos e balanço",
      icon: DollarSign,
      formats: makeFormats("Financeiro", preparePayments, "financeiro"),
    },
    {
      label: "Lista de Passageiros (ANTT)",
      description: "Manifesto de passageiros (filtro por data de saída da viagem)",
      icon: Bus,
      formats: makeFormats("Manifesto", _prepareManifest, "manifesto_passageiros"),
    },
    {
      label: "Relatório de Indicações",
      description: "Programa de indicações e bônus pagos",
      icon: Users,
      formats: makeFormats("Indicações", _prepareReferrals, "indicacoes"),
    },
    {
      label: "Comissões de Vendedores",
      description: "Relatório de comissões por vendedor e por período",
      icon: DollarSign,
      formats: makeFormats("Comissões", _prepareCommissions, "comissoes"),
    },
    {
      label: "Pipeline de Negócios",
      description: "Leads, negócios abertos e perdidos com motivo de perda",
      icon: BarChart2,
      formats: makeFormats("Pipeline", _preparePipeline, "pipeline"),
    },
  ];

  const selectedReport = REPORT_TYPES.find(r => r.value === reportType);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Downloads e Exportações</h1>
        <p className="text-sm text-muted-foreground">
          Exporte relatórios completos em CSV, Excel ou PDF, ou faça downloads rápidos diretamente no navegador.
        </p>
      </div>

      {/* Server-side reports panel */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            Exportar Relatório
          </CardTitle>
          <CardDescription className="text-xs">
            Gera relatórios completos com múltiplas abas (Excel) ou tabelas formatadas (PDF)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5 min-w-[180px]">
              <Label className="text-xs">Tipo de relatório</Label>
              <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedReport && (
                <p className="text-[11px] text-muted-foreground">{selectedReport.description}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Data início</Label>
              <Input
                type="date"
                className="h-8 text-sm w-[140px]"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Data fim</Label>
              <Input
                type="date"
                className="h-8 text-sm w-[140px]"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {(["csv", "xlsx", "pdf"] as ExportFormat[]).map(fmt => {
                const FmtIcon = fmt === "xlsx" ? FileSpreadsheet : FileText;
                const isLoading = exporting === fmt;
                return (
                  <Button
                    key={fmt}
                    variant="outline"
                    size="sm"
                    className={`${FORMAT_STYLES[fmt]} border`}
                    onClick={() => serverExport(fmt)}
                    disabled={exporting !== null}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <FmtIcon className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {fmt.toUpperCase()}
                    {!isLoading && <Download className="w-3 h-3 ml-1.5" />}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick downloads */}
      <div>
        <h2 className="text-base font-semibold mb-3 text-muted-foreground">Downloads rápidos</h2>
        <Card className="mb-4 bg-muted/40">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Período — início</Label>
                <Input
                  type="date"
                  className="h-8 text-sm w-[140px]"
                  value={quickStart}
                  onChange={e => setQuickStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Período — fim</Label>
                <Input
                  type="date"
                  className="h-8 text-sm w-[140px]"
                  value={quickEnd}
                  onChange={e => setQuickEnd(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pb-1">
                Os dados são buscados do servidor ao clicar — sem limite de registros.
                <br />Para Viagens e Manifesto, usa a <strong>data de saída</strong>; para os demais, a <strong>data de criação</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exports.map((exp) => {
          const Icon = exp.icon;
          return (
            <Card key={exp.label}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  {exp.label}
                </CardTitle>
                <CardDescription className="text-xs">{exp.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {exp.formats.map(({ label, format: fmt, action, loadingKey }) => {
                    const FmtIcon = FORMAT_ICON[fmt] ?? FileText;
                    const isLoading = quickLoading === loadingKey;
                    return (
                      <Button
                        key={fmt}
                        variant="outline"
                        size="sm"
                        className={`${FORMAT_STYLES[fmt] ?? ""} border`}
                        onClick={action}
                        disabled={quickLoading !== null}
                      >
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <FmtIcon className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {label}
                        {!isLoading && <Download className="w-3 h-3 ml-1.5" />}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
