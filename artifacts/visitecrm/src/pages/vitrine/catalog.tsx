import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { publicStoreApi, PublicStore, StoreProduct, StoreCategory } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Loader2, Search, MapPin, SlidersHorizontal, X, ArrowUpDown } from "lucide-react";
import { ProductQuickView } from "@/components/vitrine/ProductQuickView";
import { PremiumProductCard } from "@/components/vitrine/PremiumProductCard";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

interface Filters {
  search: string;
  category: string;
  destination: string;
  type: string;
  minPrice: string;
  maxPrice: string;
  departureFrom: string;
  minSeats: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  category: "all",
  destination: "all",
  type: "all",
  minPrice: "",
  maxPrice: "",
  departureFrom: "",
  minSeats: "",
  sort: "default",
};

function FilterPanel({
  filters,
  setFilters,
  categories,
  destinations,
  primaryColor,
  onClose,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  categories: StoreCategory[];
  destinations: string[];
  primaryColor: string;
  onClose?: () => void;
}) {
  const [local, setLocal] = useState<Filters>(filters);

  useEffect(() => {
    setLocal(filters);
  }, [filters]);

  function apply() {
    setFilters(local);
    onClose?.();
  }

  function reset() {
    const empty: Filters = { ...EMPTY_FILTERS };
    setLocal(empty);
    setFilters(empty);
    onClose?.();
  }

  const hasActive =
    local.category !== "all" ||
    local.destination !== "all" ||
    local.type !== "all" ||
    !!local.minPrice ||
    !!local.maxPrice ||
    !!local.departureFrom ||
    !!local.minSeats;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-base">Filtros</h3>
        {hasActive && (
          <button
            onClick={reset}
            className="text-xs text-red-500 flex items-center gap-1 hover:text-red-700"
          >
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
            Categoria
          </Label>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={local.category === "all"}
                onChange={() => setLocal((p) => ({ ...p, category: "all" }))}
                className="accent-primary"
              />
              Todas
            </label>
            {categories.map((cat) => (
              <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={local.category === cat.id}
                  onChange={() => setLocal((p) => ({ ...p, category: cat.id }))}
                  className="accent-primary"
                />
                {cat.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
          Tipo
        </Label>
        <div className="space-y-1">
          {[
            { value: "all", label: "Todos" },
            { value: "package", label: "Pacotes" },
            { value: "tour", label: "Passeios" },
            { value: "cruise", label: "Cruzeiros" },
            { value: "hotel", label: "Hotéis" },
            { value: "service", label: "Serviços" },
          ].map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={local.type === value}
                onChange={() => setLocal((p) => ({ ...p, type: value }))}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {destinations.length > 0 && (
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
            Destino
          </Label>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                checked={local.destination === "all"}
                onChange={() => setLocal((p) => ({ ...p, destination: "all" }))}
                className="accent-primary"
              />
              Todos
            </label>
            {destinations.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={local.destination === d}
                  onChange={() => setLocal((p) => ({ ...p, destination: d }))}
                  className="accent-primary"
                />
                {d}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
          Faixa de Preço
        </Label>
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            placeholder="Mín"
            value={local.minPrice}
            onChange={(e) => setLocal((p) => ({ ...p, minPrice: e.target.value }))}
            className="h-8 text-sm"
          />
          <span className="text-muted-foreground text-xs">até</span>
          <Input
            type="number"
            placeholder="Máx"
            value={local.maxPrice}
            onChange={(e) => setLocal((p) => ({ ...p, maxPrice: e.target.value }))}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
          Data de partida (a partir de)
        </Label>
        <Input
          type="date"
          value={local.departureFrom}
          onChange={(e) => setLocal((p) => ({ ...p, departureFrom: e.target.value }))}
          className="h-8 text-sm"
        />
      </div>

      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
          Passageiros
        </Label>
        <Select
          value={local.minSeats || "any"}
          onValueChange={(v) =>
            setLocal((p) => ({ ...p, minSeats: v === "any" ? "" : v }))
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Qualquer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Qualquer quantidade</SelectItem>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}+ {n === 1 ? "passageiro" : "passageiros"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={apply}
        className="w-full text-white"
        style={{ backgroundColor: primaryColor }}
      >
        Aplicar Filtros
      </Button>
    </div>
  );
}

export default function VitrineCatalog({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const { colors } = useVitrineTheme();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const initialCategory = params.get("categoryId") ?? "all";
  const initialSearch = params.get("search") ?? "";
  const initialDestination = params.get("destination") ?? "all";
  const initialDepartureFrom = params.get("departureFrom") ?? "";
  const initialMinSeats = params.get("minSeats") ?? "";

  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [quickViewProduct, setQuickViewProduct] = useState<StoreProduct | null>(null);
  const LIMIT = 12;

  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    search: initialSearch,
    category: initialCategory,
    destination: initialDestination,
    departureFrom: initialDepartureFrom,
    minSeats: initialMinSeats,
  });

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [pendingOrder, setPendingOrder] = useState<{ orderNumber: string; reservationExpiresAt: string; storeSlug: string } | null>(null);
  const [pendingCountdown, setPendingCountdown] = useState<string | null>(null);
  const [pendingExpired, setPendingExpired] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pending_order");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.storeSlug !== slug) return;
      if (new Date(parsed.reservationExpiresAt).getTime() <= Date.now()) {
        localStorage.removeItem("pending_order");
        return;
      }
      setPendingOrder(parsed);
    } catch {
      localStorage.removeItem("pending_order");
    }
  }, [slug]);

  useEffect(() => {
    if (!pendingOrder) return;
    let timer: ReturnType<typeof setInterval>;
    const tick = () => {
      const diff = new Date(pendingOrder.reservationExpiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setPendingCountdown("00:00");
        setPendingExpired(true);
        localStorage.removeItem("pending_order");
        clearInterval(timer);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setPendingCountdown(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pendingOrder]);

  function dismissPendingOrder() {
    setPendingOrder(null);
    setPendingCountdown(null);
    setPendingExpired(false);
    localStorage.removeItem("pending_order");
  }

  async function load() {
    setLoading(true);
    try {
      const queryParams: Record<string, string | number | boolean> = {
        page,
        limit: LIMIT,
      };
      if (filters.search) queryParams.search = filters.search;
      if (filters.category !== "all") queryParams.categoryId = filters.category;
      if (filters.destination !== "all") queryParams.destination = filters.destination;
      if (filters.type !== "all") queryParams.type = filters.type;
      if (filters.minPrice) queryParams.minPrice = filters.minPrice;
      if (filters.maxPrice) queryParams.maxPrice = filters.maxPrice;
      if (filters.departureFrom) queryParams.departureFrom = filters.departureFrom;
      if (filters.minSeats) queryParams.minSeats = filters.minSeats;
      if (filters.sort && filters.sort !== "default") queryParams.sort = filters.sort;
      const res = await publicStoreApi.getProducts(slug, queryParams);
      setProducts(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    publicStoreApi.getCategories(slug).then(setCategories);
    publicStoreApi.getProducts(slug, { limit: 200 }).then((res) => {
      const dests = Array.from(
        new Set(res.data.map((p) => p.destination).filter(Boolean) as string[])
      ).sort();
      setDestinations(dests);
    });
  }, [slug]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.category, filters.destination, filters.type, filters.minPrice, filters.maxPrice, filters.departureFrom, filters.minSeats, filters.sort]);

  useEffect(() => {
    load();
  }, [slug, page, filters]);

  const totalPages = Math.ceil(total / LIMIT);

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.destination !== "all" ||
    filters.type !== "all" ||
    !!filters.minPrice ||
    !!filters.maxPrice ||
    !!filters.departureFrom ||
    !!filters.minSeats;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {pendingOrder && pendingCountdown !== null && !pendingExpired && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="text-sm flex-1">
            Assentos reservados para o pedido{" "}
            <strong className="font-mono">{pendingOrder.orderNumber}</strong>
            {" — "}conclua o pagamento em{" "}
            <strong className="font-mono">{pendingCountdown}</strong>
          </span>
          <button onClick={dismissPendingOrder} className="shrink-0 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="mb-6">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em]"
          style={{ color: colors.accent }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: colors.accent }}
          />
          Catálogo
        </span>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          Nossos Pacotes
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {loading
            ? "Carregando pacotes..."
            : `${total} pacote${total !== 1 ? "s" : ""} ${total !== 1 ? "disponíveis" : "disponível"}`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar destinos, pacotes..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>

        <Select
          value={filters.sort}
          onValueChange={(v) => setFilters((f) => ({ ...f, sort: v }))}
        >
          <SelectTrigger className="w-48 shrink-0">
            <ArrowUpDown className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Relevância</SelectItem>
            <SelectItem value="price_asc">Menor Preço</SelectItem>
            <SelectItem value="price_desc">Maior Preço</SelectItem>
            <SelectItem value="newest">Mais Recente</SelectItem>
            <SelectItem value="popular">Mais Popular</SelectItem>
            <SelectItem value="rating">Melhor Avaliado</SelectItem>
          </SelectContent>
        </Select>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="shrink-0 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              Filtros
              {hasActiveFilters && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.primary }}
                />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72">
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
            </SheetHeader>
            <div className="mt-6">
              <FilterPanel
                filters={filters}
                setFilters={(f) => {
                  setFilters(f);
                  setFiltersOpen(false);
                }}
                categories={categories}
                destinations={destinations}
                primaryColor={colors.primary}
                onClose={() => setFiltersOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilters((f) => ({ ...f, category: "all" }))}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filters.category === "all"
                ? "border-transparent"
                : "border-border hover:bg-muted"
            }`}
            style={
              filters.category === "all"
                ? { backgroundColor: colors.primary, color: colors.primaryForeground }
                : {}
            }
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilters((f) => ({ ...f, category: cat.id }))}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.category === cat.id
                  ? "border-transparent"
                  : "border-border hover:bg-muted"
              }`}
              style={
                filters.category === cat.id
                  ? { backgroundColor: colors.primary, color: colors.primaryForeground }
                  : {}
              }
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <MapPin className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg">Nenhum pacote encontrado.</p>
          {(filters.search || hasActiveFilters) && (
            <button
              className="mt-2 text-primary underline text-sm"
              onClick={() => setFilters({ ...EMPTY_FILTERS })}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.map((product) => (
              <PremiumProductCard
                key={product.id}
                product={product}
                slug={slug}
                whatsapp={store.contactWhatsapp}
                onQuickView={setQuickViewProduct}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="flex items-center px-4 text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próximo
              </Button>
            </div>
          )}
        </>
      )}

      {quickViewProduct && (
        <ProductQuickView
          product={quickViewProduct}
          store={store}
          storeSlug={slug}
          open={!!quickViewProduct}
          onClose={() => setQuickViewProduct(null)}
        />
      )}
    </div>
  );
}
