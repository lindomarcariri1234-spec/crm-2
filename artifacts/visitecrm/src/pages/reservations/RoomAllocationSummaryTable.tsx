import type { RoomAllocationSummary } from "@workspace/api-client-react";
import { BedDouble, Calculator } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export function RoomAllocationSummaryTable({
  summary,
  accommodationName,
  compact = false,
}: {
  summary: RoomAllocationSummary;
  accommodationName?: string | null;
  compact?: boolean;
}) {
  const hasMissingRate = summary.rows.some(row => row.subtotal == null);

  return (
    <section className={`rounded-xl border bg-card ${compact ? "p-4" : "p-5"} space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <BedDouble className="mt-0.5 h-4 w-4 text-indigo-600" />
          <div>
            <h3 className="font-semibold">Locação da hospedagem</h3>
            <p className="text-xs text-muted-foreground">
              {accommodationName ? `${accommodationName} · ` : ""}
              {summary.nights} noite{summary.nights === 1 ? "" : "s"} de hospedagem
            </p>
          </div>
        </div>
        <Calculator className="h-4 w-4 text-muted-foreground" />
      </div>

      {summary.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          Nenhum quarto foi alocado ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-100 text-left text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Acomodação</th>
                <th className="px-3 py-2.5 font-semibold">Qtd.</th>
                <th className="px-3 py-2.5 font-semibold">Hóspedes/Quarto</th>
                <th className="px-3 py-2.5 font-semibold">Diária (R$)</th>
                <th className="px-3 py-2.5 font-semibold">Pacote {summary.nights} Noites (Un.)</th>
                <th className="px-3 py-2.5 text-right font-semibold">Subtotal (R$)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.rows.map((row) => (
                <tr key={`${row.category}-${row.guestsPerRoom}-${row.pricePerNight ?? "sem-diaria"}`}>
                  <td className="px-3 py-2.5 font-medium">{row.category}</td>
                  <td className="px-3 py-2.5">{row.roomCount}</td>
                  <td className="px-3 py-2.5">{row.guestsPerRoom} pessoas</td>
                  <td className="px-3 py-2.5">{formatValue(row.pricePerNight)}</td>
                  <td className="px-3 py-2.5">{formatValue(row.packageValue)}</td>
                  <td className="px-3 py-2.5 text-right font-medium">{formatValue(row.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-yellow-50 font-semibold text-slate-800 dark:bg-yellow-950/30 dark:text-yellow-50">
              <tr>
                <td className="px-3 py-2.5 uppercase">Total geral</td>
                <td className="px-3 py-2.5">{summary.totalRooms}</td>
                <td className="px-3 py-2.5">{summary.totalGuests} pessoas</td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5 text-right">{formatValue(summary.totalValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {hasMissingRate && summary.rows.length > 0 && (
        <p className="text-xs text-amber-700">
          Cadastre a diária de cada quarto para completar o cálculo do pacote e do subtotal.
        </p>
      )}
    </section>
  );
}

function formatValue(value: number | null): string {
  return value == null ? "—" : formatCurrency(value);
}
