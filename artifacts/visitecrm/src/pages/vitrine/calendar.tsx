import { useState, useEffect, useMemo } from "react";
import { localToday } from "@workspace/shared";
import { useLocation } from "wouter";
import { publicStoreApi, PublicStore, StoreProduct } from "@/lib/storeApi";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { FlashSaleCountdown } from "@/components/vitrine/FlashSaleCountdown";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Users,
  Clock,
  ArrowRight,
} from "lucide-react";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export default function VitrineCalendar({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { colors } = useVitrineTheme();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    // Use Brazil calendar date so the calendar opens on the correct month at 21h-midnight
    const [y, m] = localToday().split("-").map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    publicStoreApi
      .getProducts(slug, { limit: 200 })
      .then((res) => setProducts(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  const departuresByDate = useMemo(() => {
    const map = new Map<string, StoreProduct[]>();
    for (const p of products) {
      if (!p.departureDate) continue;
      const key = p.departureDate.slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [products]);

  useEffect(() => {
    if (initialized || products.length === 0) return;
    const [_ty, _tm, _td] = localToday().split("-").map(Number);
    const todayKey = dateKey(_ty, _tm - 1, _td);
    const upcoming = Array.from(departuresByDate.keys())
      .filter((k) => k >= todayKey)
      .sort();
    if (upcoming.length > 0) {
      const [y, m] = upcoming[0].split("-").map(Number);
      setCurrentMonth(new Date(y, m - 1, 1));
      setSelectedDate(upcoming[0]);
    }
    setInitialized(true);
  }, [products, departuresByDate, initialized]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Use Brazil calendar date so the "today" highlight is correct at 21h-midnight BRT
  const [_cy, _cm, _cd] = localToday().split("-").map(Number);
  const todayKey = dateKey(_cy, _cm - 1, _cd);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedTrips = selectedDate
    ? departuresByDate.get(selectedDate) ?? []
    : [];

  function goToMonth(delta: number) {
    setCurrentMonth(new Date(year, month + delta, 1));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 text-center">
        <span
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
          style={{ background: colors.primarySoft, color: colors.primary }}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Próximas saídas
        </span>
        <h1 className="text-3xl font-bold md:text-4xl">Calendário de Saídas</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
          Confira as próximas datas de embarque e garanta a sua vaga.
        </p>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : departuresByDate.size === 0 ? (
        <div className="rounded-2xl border bg-card py-16 text-center text-muted-foreground">
          <CalendarDays className="mx-auto mb-4 h-14 w-14 opacity-20" />
          <p className="text-lg">Nenhuma saída programada no momento.</p>
          <button
            className="mt-2 text-sm text-primary underline"
            onClick={() => navigate(`/loja/${slug}/produtos`)}
          >
            Ver todos os pacotes
          </button>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => goToMonth(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-muted"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-bold">
                {MONTHS[month]} {year}
              </h2>
              <button
                onClick={() => goToMonth(1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-muted"
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (d === null) return <div key={`empty-${i}`} />;
                const key = dateKey(year, month, d);
                const trips = departuresByDate.get(key);
                const hasTrips = !!trips && trips.length > 0;
                const isToday = key === todayKey;
                const isSelected = key === selectedDate;
                const isPast = key < todayKey;
                return (
                  <button
                    key={key}
                    disabled={!hasTrips}
                    onClick={() => hasTrips && setSelectedDate(key)}
                    className={cn(
                      "relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition-all",
                      hasTrips
                        ? "cursor-pointer font-semibold hover:-translate-y-0.5 hover:shadow-sm"
                        : "cursor-default text-muted-foreground/50",
                      isPast && !hasTrips && "opacity-40",
                      isToday && !isSelected && "ring-2 ring-offset-1",
                    )}
                    style={{
                      ...(isSelected
                        ? {
                            background: colors.primary,
                            color: colors.primaryForeground,
                          }
                        : hasTrips
                          ? {
                              background: colors.primarySoft,
                              color: colors.primary,
                            }
                          : {}),
                      ...(isToday && !isSelected
                        ? ({ "--tw-ring-color": colors.primary } as React.CSSProperties)
                        : {}),
                    }}
                  >
                    <span>{d}</span>
                    {hasTrips && (
                      <span
                        className="absolute bottom-1 rounded-full px-1 text-[9px] font-bold leading-tight"
                        style={
                          isSelected
                            ? {
                                background: colors.primaryForeground,
                                color: colors.primary,
                              }
                            : {
                                background: colors.primary,
                                color: colors.primaryForeground,
                              }
                        }
                      >
                        {trips!.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span
                className="inline-block h-3 w-3 rounded"
                style={{ background: colors.primarySoft }}
              />
              Dias com saídas disponíveis
            </div>
          </div>

          <div>
            {selectedDate && selectedTrips.length > 0 ? (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <CalendarDays
                    className="h-4 w-4"
                    style={{ color: colors.primary }}
                  />
                  {formatDate(selectedDate)}
                  <span className="font-normal text-muted-foreground">
                    · {selectedTrips.length}{" "}
                    {selectedTrips.length === 1 ? "saída" : "saídas"}
                  </span>
                </h3>
                {selectedTrips.map((trip) => {
                  const image =
                    trip.thumbnail ?? trip.images?.[0] ?? trip.gallery?.[0] ?? null;
                  const priceNum = parseFloat(trip.salePrice ?? trip.price);
                  const showCountdown =
                    trip.onSale &&
                    !!trip.salePrice &&
                    !!trip.saleEndsAt &&
                    new Date(trip.saleEndsAt).getTime() > Date.now();
                  return (
                    <button
                      key={trip.id}
                      onClick={() =>
                        navigate(`/loja/${slug}/produtos/${trip.slug}`)
                      }
                      className="flex w-full gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md"
                    >
                      {image ? (
                        <img
                          src={image}
                          alt={trip.name}
                          className="h-20 w-20 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: colors.gradientHero }}
                        >
                          <MapPin className="h-6 w-6 text-white/80" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="truncate font-semibold">{trip.name}</p>
                        {trip.destination && (
                          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {trip.destination}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {trip.durationDays != null && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {trip.durationDays}{" "}
                              {trip.durationDays === 1 ? "dia" : "dias"}
                            </span>
                          )}
                          {typeof trip.availableSeats === "number" && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {trip.availableSeats}{" "}
                              {trip.availableSeats === 1 ? "vaga" : "vagas"}
                            </span>
                          )}
                        </div>
                        {showCountdown && (
                          <FlashSaleCountdown
                            endsAt={trip.saleEndsAt!}
                            variant="badge"
                            className="mt-1.5"
                          />
                        )}
                        <div className="mt-auto flex items-center justify-between pt-1.5">
                          {Number.isFinite(priceNum) && (
                            <span
                              className="font-bold"
                              style={{ color: colors.primary }}
                            >
                              {formatCurrency(priceNum)}
                            </span>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 py-16 text-center text-muted-foreground">
                <CalendarDays className="mb-3 h-12 w-12 opacity-20" />
                <p className="px-6 text-sm">
                  Selecione um dia destacado para ver as saídas.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
