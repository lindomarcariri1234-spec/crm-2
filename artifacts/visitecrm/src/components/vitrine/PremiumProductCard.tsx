import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { StoreProduct } from "@/lib/storeApi";
import { calculateTripDuration } from "@/lib/tripDuration";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useCart } from "@/contexts/CartContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import { useComparison } from "@/contexts/ComparisonContext";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { FlashSaleCountdown } from "@/components/vitrine/FlashSaleCountdown";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Calendar,
  Clock,
  ShoppingCart,
  Star,
  Check,
  MessageCircle,
  Heart,
  Flame,
  Scale,
} from "lucide-react";

/**
 * Premium storefront product card, shared by the home featured grid and the
 * catalog. Superset of the original catalog card — preserves the image
 * slideshow (hover auto-advance on desktop, tap/swipe on touch, lazy-loaded via
 * IntersectionObserver), add-to-cart, favorites toggle, occupancy bar, discount
 * + featured badges, and the optional quick-view callback. Brand colors come
 * from the scoped Vitrine theme.
 */
export function PremiumProductCard({
  product,
  slug,
  whatsapp,
  onQuickView,
}: {
  product: StoreProduct;
  slug: string;
  whatsapp?: string | null;
  onQuickView?: (p: StoreProduct) => void;
}) {
  const [, navigate] = useLocation();
  const { addItem, openCart } = useCart();
  const { isFavorited, toggleFavorite } = useFavorites();
  const { isComparing, toggle: toggleCompare, isFull: compareFull } = useComparison();
  const { colors } = useVitrineTheme();

  const favItemType = product.tripId ? "trip" : "product";
  const favItemId = product.tripId ?? product.id;
  const isFav = isFavorited(favItemType, favItemId);
  const inCompare = isComparing(product.id);

  const priceNum = parseFloat(product.price);
  const displayPrice = product.salePrice ?? product.price;
  const displayPriceNum = parseFloat(displayPrice);
  const hasDiscount = !!product.salePrice;
  const discountPct =
    hasDiscount && priceNum > 0
      ? Math.round((1 - displayPriceNum / priceNum) * 100)
      : 0;
  const showInstallments = displayPriceNum >= 100;

  const isStockOut = product.trackInventory && (product.stockQuantity ?? 0) <= 0;
  const availableSeats = product.availableSeats ?? null;
  const totalCapacity = product.totalCapacity ?? null;
  const isTripSoldOut = availableSeats !== null && availableSeats <= 0;
  const isLastSeats =
    availableSeats !== null && availableSeats > 0 && availableSeats <= 10;
  const isOutOfStock = isStockOut || isTripSoldOut;
  const occupancyPct =
    totalCapacity && totalCapacity > 0 && availableSeats !== null
      ? Math.round(((totalCapacity - availableSeats) / totalCapacity) * 100)
      : null;
  const displayDate = product.tripId
    ? product.departureDate ?? product.startDate
    : product.startDate;
  const allInclusions =
    product.tripId && (product.inclusions ?? []).length > 0
      ? product.inclusions ?? []
      : product.includes ?? [];
  const inclusions = allInclusions.slice(0, 3);
  const inclusionsOverflow =
    allInclusions.length > 3 ? allInclusions.length - 3 : 0;

  const slideImages = [
    ...(product.images ?? []),
    ...(product.gallery ?? []),
  ].slice(0, 3);
  const hasSlideshow = slideImages.length > 1;
  const [slideIndex, setSlideIndex] = useState(0);
  const [galleryReady, setGalleryReady] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const didSwipeRef = useRef(false);

  useEffect(() => {
    setIsTouchDevice(
      window.matchMedia("(hover: none) and (pointer: coarse)").matches,
    );
  }, []);

  useEffect(() => {
    if (!hasSlideshow) return;
    const extraUrls = slideImages.slice(1);
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          let loaded = 0;
          extraUrls.forEach((src) => {
            const img = new Image();
            img.onload = img.onerror = () => {
              loaded += 1;
              if (loaded === extraUrls.length) setGalleryReady(true);
            };
            img.src = src;
          });
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSlideshow, slideImages.join(",")]);

  function handleMouseEnter() {
    if (!hasSlideshow || isTouchDevice || !galleryReady) return;
    intervalRef.current = setInterval(() => {
      setSlideIndex((i) => (i + 1) % slideImages.length);
    }, 900);
  }

  function handleMouseLeave() {
    if (isTouchDevice) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setSlideIndex(0);
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    didSwipeRef.current = false;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (!hasSlideshow || !galleryReady) return;
    if (Math.abs(dx) < 10) {
      didSwipeRef.current = false;
    } else if (dx < -30) {
      didSwipeRef.current = true;
      setSlideIndex((i) => (i + 1) % slideImages.length);
    } else if (dx > 30) {
      didSwipeRef.current = true;
      setSlideIndex((i) => (i - 1 + slideImages.length) % slideImages.length);
    }
  }

  function handleImageAreaClick(e: React.MouseEvent) {
    if (!isTouchDevice || !hasSlideshow || !galleryReady) return;
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    setSlideIndex((i) => (i + 1) % slideImages.length);
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function handleAdd() {
    if (isOutOfStock) return;
    addItem({
      productId: product.id,
      productName: product.name,
      unitPrice: displayPriceNum,
      image: product.images?.[0],
    });
    openCart();
  }

  function handleWhatsApp() {
    const wa = whatsapp?.replace(/\D/g, "");
    if (!wa) return;
    const text = encodeURIComponent(
      `Olá! Tenho interesse no pacote: ${product.name}`,
    );
    window.open(`https://wa.me/${wa}?text=${text}`, "_blank");
  }

  function handleCardClick() {
    if (onQuickView) {
      onQuickView(product);
    } else {
      navigate(`/loja/${slug}/produtos/${product.slug}`);
    }
  }

  const visibleSlides =
    hasSlideshow && galleryReady ? slideImages : slideImages.slice(0, 1);

  const duration =
    calculateTripDuration(
      product.departureDate ?? product.startDate,
      product.endDate,
      product.departureTime,
      product.returnTime,
    ) ?? (product.durationDays ? { formattedShort: `${product.durationDays}d` } : null);

  return (
    <div
      ref={cardRef}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-pointer"
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="relative h-52 overflow-hidden"
        style={{ background: colors.gradientHero }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleImageAreaClick}
      >
        {slideImages.length > 0 ? (
          <>
            {visibleSlides.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={product.name}
                loading="lazy"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                  i === slideIndex ? "opacity-100" : "opacity-0"
                } ${
                  i === 0 && !hasSlideshow
                    ? "transition-transform duration-500 group-hover:scale-105"
                    : ""
                }`}
              />
            ))}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/40">
            <MapPin className="h-12 w-12" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />

        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="rounded-full bg-black/70 px-4 py-1 text-sm font-bold text-white">
              Esgotado
            </span>
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {isLastSeats && !isOutOfStock && (
            <span className="flex animate-pulse items-center gap-1 rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-bold text-white shadow">
              <Flame className="h-3 w-3" /> Últimas vagas!
            </span>
          )}
          {hasDiscount && !isOutOfStock && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-bold shadow"
              style={{ background: colors.accent, color: colors.accentForeground }}
            >
              {discountPct > 0 ? `-${discountPct}%` : "PROMO"}
            </span>
          )}
        </div>

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <button
            type="button"
            aria-label={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(favItemType, favItemId);
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full shadow backdrop-blur transition-colors ${
              isFav
                ? "bg-red-500 text-white"
                : "bg-white/90 text-gray-500 hover:text-red-500"
            }`}
          >
            <Heart className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            aria-label={inCompare ? "Remover da comparação" : "Adicionar à comparação"}
            title={
              !inCompare && compareFull
                ? "Você já selecionou 3 pacotes para comparar"
                : inCompare
                  ? "Remover da comparação"
                  : "Comparar"
            }
            disabled={!inCompare && compareFull}
            onClick={(e) => {
              e.stopPropagation();
              toggleCompare({
                productId: product.id,
                productSlug: product.slug,
                name: product.name,
                image: product.images?.[0],
                priceAtAdd: displayPriceNum,
              });
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full shadow backdrop-blur transition-colors ${
              inCompare
                ? "text-white"
                : "bg-white/90 text-gray-500 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            }`}
            style={inCompare ? { background: colors.primary } : undefined}
          >
            <Scale className="h-4 w-4" />
          </button>
          {product.isFeatured && !isOutOfStock && (
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold shadow"
              style={{
                background: colors.secondary,
                color: colors.secondaryForeground,
              }}
            >
              <Star className="h-3 w-3 fill-current" /> Destaque
            </span>
          )}
        </div>

        {hasSlideshow && (
          <div
            className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 transition-opacity ${
              isTouchDevice ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {slideImages.map((_, i) => (
              <span
                key={i}
                role="button"
                aria-label={`Ir para imagem ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSlideIndex(i);
                }}
                className={`block cursor-pointer rounded-full transition-all duration-300 ${
                  i === slideIndex ? "h-1.5 w-4 bg-white" : "h-1.5 w-1.5 bg-white/60"
                }`}
                style={{ padding: "6px", margin: "-6px", boxSizing: "content-box" }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-1.5 line-clamp-2 font-semibold leading-snug text-foreground transition-colors group-hover:text-[color:var(--vitrine-primary)]">
          {product.name}
        </h3>

        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {product.originCity ? (
            <span className="flex items-center gap-1">
              <MapPin
                className="h-3.5 w-3.5"
                style={{ color: colors.primary }}
              />
              <span className="font-medium" style={{ color: colors.primary }}>
                {product.originCity}
              </span>
              <span>→</span>
              <span>{product.destination}</span>
            </span>
          ) : product.destination ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {product.destination}
            </span>
          ) : null}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {duration.formattedShort}
            </span>
          )}
          {displayDate && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(displayDate)}
              {product.departureTime && (
                <span className="font-medium">
                  às {product.departureTime}
                  {product.returnTime && `–${product.returnTime}`}
                </span>
              )}
              {!product.departureTime && product.returnTime && (
                <span className="font-medium">volta às {product.returnTime}</span>
              )}
            </span>
          )}
        </div>

        {product.shortDescription && (
          <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {product.shortDescription.replace(/<[^>]*>/g, "")}
          </p>
        )}

        {inclusions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {inclusions.map((inc, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  background: colors.secondarySoft,
                  color: colors.secondary,
                }}
              >
                <Check className="h-2.5 w-2.5" />
                {inc}
              </span>
            ))}
            {inclusionsOverflow > 0 && (
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                +{inclusionsOverflow}
              </span>
            )}
          </div>
        )}

        {occupancyPct !== null && totalCapacity !== null && (
          <div className="mb-3">
            <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
              <span>
                {availableSeats} vaga{availableSeats !== 1 ? "s" : ""}{" "}
                {availableSeats !== 1 ? "disponíveis" : "disponível"}
              </span>
              <span>{occupancyPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  occupancyPct >= 90
                    ? "bg-red-500"
                    : occupancyPct >= 70
                      ? "bg-amber-500"
                      : "bg-green-500"
                }`}
                style={{ width: `${occupancyPct}%` }}
              />
            </div>
          </div>
        )}

        {product.onSale && hasDiscount && !isOutOfStock && product.saleEndsAt && (
          <div className="mb-2">
            <FlashSaleCountdown endsAt={product.saleEndsAt} variant="badge" />
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            {hasDiscount && (
              <span className="mr-1 text-xs text-muted-foreground line-through">
                {formatCurrency(priceNum)}
              </span>
            )}
            <div
              className="text-lg font-bold leading-tight"
              style={{ color: colors.primary }}
            >
              {formatCurrency(displayPriceNum)}
            </div>
            {showInstallments && (
              <span className="text-[10px] text-muted-foreground">
                em até 10x de {formatCurrency(displayPriceNum / 10)}
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            {whatsapp && (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 border-green-300 text-green-600 hover:bg-green-50"
                onClick={(e) => {
                  e.stopPropagation();
                  handleWhatsApp();
                }}
                title="Perguntar via WhatsApp"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleAdd();
              }}
              disabled={isOutOfStock}
              style={
                !isOutOfStock
                  ? { background: colors.primary, color: colors.primaryForeground }
                  : undefined
              }
              className={`h-9 px-3.5 ${
                isOutOfStock ? "cursor-not-allowed bg-gray-200 text-gray-400" : ""
              }`}
            >
              {isOutOfStock ? (
                <span className="text-xs">Esgotado</span>
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
