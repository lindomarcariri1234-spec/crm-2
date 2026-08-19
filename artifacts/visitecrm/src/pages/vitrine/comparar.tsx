import { useState, useEffect, Fragment, type ReactNode } from "react";
import { useLocation } from "wouter";
import { publicStoreApi, PublicStore, StoreProduct } from "@/lib/storeApi";
import { useComparison, type ComparisonItem } from "@/contexts/ComparisonContext";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { formatCurrency } from "@/lib/utils";
import { calculateTripDuration } from "@/lib/tripDuration";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  X,
  Scale,
  Loader2,
  Check,
  Calendar,
  Zap,
} from "lucide-react";

interface ComparisonCol {
  item: ComparisonItem;
  product: StoreProduct | null;
}

function effectivePrice(p: StoreProduct): number {
  return parseFloat(p.salePrice ?? p.price);
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}

function dateRange(p: StoreProduct): string | null {
  const start = formatDate(p.tripId ? p.departureDate ?? p.startDate : p.startDate);
  const end = formatDate(p.tripId ? p.returnDate ?? p.endDate : p.endDate);
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? null;
}

function durationLabel(p: StoreProduct): string | null {
  const d = calculateTripDuration(
    p.departureDate ?? p.startDate,
    p.endDate ?? p.returnDate,
    p.departureTime,
    p.returnTime
  );
  if (d?.formattedShort) return d.formattedShort;
  if (p.durationDays) {
    return `${p.durationDays} dia${p.durationDays !== 1 ? "s" : ""}${
      p.durationNights ? ` / ${p.durationNights} noite${p.durationNights !== 1 ? "s" : ""}` : ""
    }`;
  }
  return null;
}

function inclusionsOf(p: StoreProduct): string[] {
  const trip = p.inclusions ?? [];
  if (trip.length > 0) return trip;
  return p.includes ?? [];
}

export default function VitrineComparar({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { items, remove, clear } = useComparison();
  const { colors } = useVitrineTheme();

  const [fresh, setFresh] = useState<Record<string, StoreProduct>>({});
  const [loading, setLoading] = useState(true);

  const idKey = items.map((i) => i.productSlug).join(",");

  useEffect(() => {
    let cancelled = false;
    if (items.length === 0) {
      setFresh({});
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.allSettled(
      items.map((i) => publicStoreApi.getProduct(slug, i.productSlug))
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, StoreProduct> = {};
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          map[items[idx].productId] = r.value;
        }
      });
      setFresh(map);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, idKey]);

  const cols: ComparisonCol[] = items.map((item) => ({
    item,
    product: fresh[item.productId] ?? null,
  }));

  function Row({
    label,
    render,
  }: {
    label: string;
    render: (col: ComparisonCol) => ReactNode;
  }) {
    return (
      <Fragment>
        <div className="flex items-center bg-muted/40 p-3 text-xs font-semibold text-muted-foreground">
          {label}
        </div>
        {cols.map((col) => (
          <div key={col.item.productId} className="bg-white p-3 text-sm text-foreground">
            {render(col)}
          </div>
        ))}
      </Fragment>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <button
        onClick={() => navigate(`/loja/${slug}/produtos`)}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Voltar para o catálogo
      </button>

      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6" style={{ color: colors.primary }} />
          <h1 className="text-2xl font-bold">Comparar pacotes</h1>
        </div>
        {items.length > 0 && (
          <button
            onClick={clear}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed py-16 text-center">
          <Scale className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            Você ainda não selecionou pacotes para comparar.
          </p>
          <Button
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            style={{ background: colors.primary, color: colors.primaryForeground }}
          >
            Explorar pacotes
          </Button>
        </div>
      ) : (
        <>
          {items.length === 1 && (
            <div className="mb-4 rounded-lg bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
              Adicione mais um pacote para comparar lado a lado.
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto pb-4">
              <div
                className="grid gap-px overflow-hidden rounded-2xl border border-black/5 bg-black/5"
                style={{
                  gridTemplateColumns: `minmax(96px, 130px) repeat(${cols.length}, minmax(190px, 1fr))`,
                  minWidth: cols.length > 1 ? `${130 + cols.length * 200}px` : undefined,
                }}
              >
                {/* Header */}
                <div className="bg-white p-3" />
                {cols.map((col) => {
                  const p = col.product;
                  const image = p?.images?.[0] ?? col.item.image;
                  return (
                    <div key={col.item.productId} className="relative bg-white p-3">
                      <button
                        type="button"
                        aria-label="Remover da comparação"
                        onClick={() => remove(col.item.productId)}
                        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/5 text-gray-500 transition-colors hover:bg-black/10 hover:text-gray-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/loja/${slug}/produtos/${col.item.productSlug}`)}
                        className="block w-full text-left"
                      >
                        <div
                          className="mb-2 h-24 w-full overflow-hidden rounded-lg"
                          style={{ background: colors.gradientHero }}
                        >
                          {image && (
                            <img
                              src={image}
                              alt={p?.name ?? col.item.name}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm font-semibold leading-snug">
                          {p?.name ?? col.item.name}
                        </p>
                      </button>
                    </div>
                  );
                })}

                <Row
                  label="Preço"
                  render={(col) => {
                    const p = col.product;
                    if (!p) {
                      return (
                        <span className="font-bold" style={{ color: colors.primary }}>
                          {formatCurrency(col.item.priceAtAdd)}
                        </span>
                      );
                    }
                    const eff = effectivePrice(p);
                    const hasDiscount = !!p.salePrice;
                    return (
                      <div>
                        {hasDiscount && (
                          <span className="mr-1 block text-xs text-muted-foreground line-through">
                            {formatCurrency(parseFloat(p.price))}
                          </span>
                        )}
                        <span className="text-base font-bold" style={{ color: colors.primary }}>
                          {formatCurrency(eff)}
                        </span>
                        <span className="text-xs text-muted-foreground"> / pessoa</span>
                      </div>
                    );
                  }}
                />

                <Row
                  label="Datas"
                  render={(col) => {
                    const p = col.product;
                    const range = p ? dateRange(p) : null;
                    return range ? (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        {range}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    );
                  }}
                />

                <Row
                  label="Duração"
                  render={(col) => {
                    const d = col.product ? durationLabel(col.product) : null;
                    return d ? <span>{d}</span> : <span className="text-muted-foreground">—</span>;
                  }}
                />

                <Row
                  label="Inclusões"
                  render={(col) => {
                    const list = col.product ? inclusionsOf(col.product) : [];
                    if (list.length === 0) return <span className="text-muted-foreground">—</span>;
                    return (
                      <ul className="space-y-1">
                        {list.slice(0, 6).map((inc, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs">
                            <Check
                              className="mt-0.5 h-3 w-3 shrink-0"
                              style={{ color: colors.secondary }}
                            />
                            <span>{inc}</span>
                          </li>
                        ))}
                        {list.length > 6 && (
                          <li className="text-xs text-muted-foreground">+{list.length - 6}</li>
                        )}
                      </ul>
                    );
                  }}
                />

                <Row
                  label="Vagas"
                  render={(col) => {
                    const p = col.product;
                    if (!p || p.availableSeats == null) {
                      return <span className="text-muted-foreground">—</span>;
                    }
                    const seats = p.availableSeats;
                    if (seats <= 0) return <span className="font-medium text-red-500">Esgotado</span>;
                    return (
                      <span className={seats <= 10 ? "font-medium text-amber-600" : ""}>
                        {seats} vaga{seats !== 1 ? "s" : ""}
                        {p.totalCapacity ? ` / ${p.totalCapacity}` : ""}
                      </span>
                    );
                  }}
                />

                <Row
                  label=""
                  render={(col) => {
                    const p = col.product;
                    const soldOut =
                      !!p &&
                      ((p.availableSeats != null && p.availableSeats <= 0) ||
                        (p.trackInventory && (p.stockQuantity ?? 0) <= 0));
                    const isTrip = !!(p?.tripId ?? col.item.productSlug);
                    const goReserve = () => {
                      if (p?.tripId) {
                        navigate(`/loja/${slug}/reservar/${col.item.productSlug}`);
                      } else {
                        navigate(`/loja/${slug}/produtos/${col.item.productSlug}`);
                      }
                    };
                    return (
                      <Button
                        size="sm"
                        className="w-full font-semibold"
                        disabled={soldOut}
                        onClick={goReserve}
                        style={
                          !soldOut
                            ? { background: colors.accent, color: colors.accentForeground }
                            : undefined
                        }
                      >
                        {soldOut ? (
                          "Esgotado"
                        ) : p?.tripId ? (
                          <>
                            <Zap className="mr-1 h-4 w-4" /> Reservar
                          </>
                        ) : (
                          "Ver pacote"
                        )}
                      </Button>
                    );
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
