import { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { useLocation } from "wouter";
import { publicStoreApi, PublicStore, StoreProduct, StoreReview, PartnerProductInfo } from "@/lib/storeApi";
import { calculateTripDuration } from "@/lib/tripDuration";
import { getTripVideoEmbedUrl } from "@/lib/tripVideoEmbed";
import { formatCurrency } from "@/lib/utils";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { SectionHeader } from "@/components/vitrine/SectionHeader";
import { PremiumProductCard } from "@/components/vitrine/PremiumProductCard";
import { InstallmentSimulator } from "@/components/vitrine/InstallmentSimulator";
import { PriceAlert } from "@/components/vitrine/PriceAlert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  Calendar,
  Clock,
  ChevronLeft,
  Star,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  MessageCircle,
  Share2,
  Check,
  Zap,
  Search,
  X,
  Maximize2,
  Images,
  Download,
  ShieldCheck,
  Heart,
  Video,
} from "lucide-react";
import { useFavorites } from "@/contexts/FavoritesContext";
import { applyStorefrontMetadata } from "@/lib/storefrontMetadata";

function GalleryThumb({
  src,
  index,
  onClick,
}: {
  src: string;
  index: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className="relative aspect-square rounded-xl overflow-hidden bg-muted group focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={`Ver foto ${index + 1}`}
    >
      <div
        className="absolute inset-0 bg-muted animate-pulse"
        style={{ opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}
        aria-hidden="true"
      />
      {inView && (
        <img
          src={src}
          alt={`Galeria ${index + 1}`}
          className="relative w-full h-full object-cover group-hover:scale-105"
          style={{
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.4s ease, transform 0.3s",
          }}
          onLoad={() => setLoaded(true)}
        />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
      </div>
    </button>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${
            s <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

function Lightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [shareCopied, setShareCopied] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const lightboxTouchStartX = useRef<number | null>(null);

  useEffect(() => {
    setImgLoaded(false);
  }, [index]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("photo", String(index + 1));
    window.history.replaceState({}, "", url.toString());
  }, [index]);

  useEffect(() => {
    return () => {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("photo");
      window.history.replaceState({}, "", cleanUrl.toString());
    };
  }, []);

  useEffect(() => {
    window.history.pushState({ visitecrm_lightbox: true }, "");
    const handlePop = () => { onClose(); };
    window.addEventListener("popstate", handlePop);
    return () => { window.removeEventListener("popstate", handlePop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") window.history.back();
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [images.length]);

  function handleSharePhoto(e: React.MouseEvent) {
    e.stopPropagation();
    const shareUrl = `${window.location.href.split("?")[0]}?photo=${index + 1}`;
    if (navigator.share) {
      navigator.share({ url: shareUrl, text: `Foto ${index + 1}` }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }).catch(() => {});
    }
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const imageUrl = images[index];
    const filename = imageUrl.split("/").pop()?.split("?")[0] ?? `foto-${index + 1}.jpg`;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleLightboxTouchStart(e: React.TouchEvent) {
    lightboxTouchStartX.current = e.touches[0].clientX;
  }

  function handleLightboxTouchEnd(e: React.TouchEvent) {
    if (lightboxTouchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX.current;
    lightboxTouchStartX.current = null;
    if (Math.abs(dx) < 30) return;
    if (dx < 0) setIndex((i) => (i + 1) % images.length);
    else setIndex((i) => (i - 1 + images.length) % images.length);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={() => window.history.back()}
      onTouchStart={handleLightboxTouchStart}
      onTouchEnd={handleLightboxTouchEnd}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10" onClick={(e) => e.stopPropagation()}>
        <p className="text-white/60 text-sm">
          {index + 1} / {images.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
            onClick={handleSharePhoto}
            aria-label="Compartilhar foto"
          >
            {shareCopied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Copiado!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4" />
                <span>Compartilhar</span>
              </>
            )}
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
            onClick={handleDownload}
            aria-label="Baixar foto"
          >
            <Download className="w-4 h-4" />
            <span>Baixar</span>
          </button>
          <button
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            onClick={() => window.history.back()}
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {images.length > 1 && (
        <>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + images.length) % images.length); }}
            aria-label="Anterior"
          >
            <PrevIcon className="w-6 h-6" />
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % images.length); }}
            aria-label="Próxima"
          >
            <NextIcon className="w-6 h-6" />
          </button>
        </>
      )}

      <div
        className="relative max-w-5xl max-h-[85vh] mx-4 flex flex-col items-center gap-3 mt-12"
        onClick={(e) => e.stopPropagation()}
      >
        {!imgLoaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-10 h-10 animate-spin text-white/60" />
          </div>
        )}
        <img
          key={images[index]}
          src={images[index]}
          alt={`Imagem ${index + 1}`}
          className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-2xl transition-opacity duration-300"
          style={{ opacity: imgLoaded ? 1 : 0 }}
          onLoad={() => setImgLoaded(true)}
        />
        {images.length > 1 && (
          <div className="flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`rounded-full transition-all ${i === index ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/40 hover:bg-white/60"}`}
              />
            ))}
          </div>
        )}
        <p className="text-white/60 text-xs">
          Use ← → para navegar, Esc para fechar
        </p>
      </div>
    </div>
  );
}

export default function VitrineProduct({
  slug,
  productSlug,
  store,
}: {
  slug: string;
  productSlug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { colors } = useVitrineTheme();
  const { isFavorited, toggleFavorite } = useFavorites();
  const [product, setProduct] = useState<(StoreProduct & { reviews: StoreReview[] }) | null>(null);
  const [partnerInfo, setPartnerInfo] = useState<PartnerProductInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);
  const heroTouchStartX = useRef<number | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<{ variantName: string; label: string; price: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"descricao" | "requisitos" | "destaques">("descricao");
  const [related, setRelated] = useState<StoreProduct[]>([]);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function openLightbox(imgs: string[], idx: number) {
    setLightboxImages(imgs);
    setLightboxIndex(idx);
    setLightboxOpen(true);
  }

  useEffect(() => {
    setLoading(true);
    publicStoreApi
      .getProduct(slug, productSlug)
      .then((p) => {
        setProduct(p);
        publicStoreApi.getPartnerInfo(slug, productSlug)
          .then((info) => setPartnerInfo(info.hasPartner ? info : null))
          .catch(() => setPartnerInfo(null));
        // AI-assisted recommendations (best-effort); fall back to a plain
        // product listing if the endpoint is unavailable.
        publicStoreApi.getRecommendations(slug, productSlug, 3)
          .then((r) => {
            const recs = (r.data ?? []).filter((x) => x.id !== p.id).slice(0, 3);
            if (recs.length > 0) {
              setRelated(recs);
              return;
            }
            publicStoreApi.getProducts(slug, { limit: 4 }).then((g) => {
              setRelated(g.data.filter((x) => x.id !== p.id).slice(0, 3));
            }).catch(() => {});
          })
          .catch(() => {
            publicStoreApi.getProducts(slug, { limit: 4 }).then((g) => {
              setRelated(g.data.filter((x) => x.id !== p.id).slice(0, 3));
            }).catch(() => {});
          });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug, productSlug]);

  useEffect(() => {
    if (product) applyStorefrontMetadata(store, window.location.pathname, product);
  }, [product, store]);

  useEffect(() => {
    if (!product) return;
    const params = new URLSearchParams(window.location.search);
    const photoParam = params.get("photo");
    if (photoParam === null) return;
    const oneBased = parseInt(photoParam, 10);
    const idx = oneBased - 1;
    const allImgs = [...(product.images ?? []), ...(product.gallery ?? [])];
    if (!isNaN(idx) && idx >= 0 && idx < allImgs.length) {
      setLightboxImages(allImgs);
      setLightboxIndex(idx);
      setLightboxOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("photo");
      window.history.replaceState({}, "", url.toString());
    }
  }, [product?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">Produto não encontrado</h2>
        <Button variant="outline" onClick={() => navigate(`/loja/${slug}/produtos`)}>
          Ver Catálogo
        </Button>
      </div>
    );
  }

  const basePrice = parseFloat(product.salePrice ?? product.price);
  const effectivePrice = selectedVariant ? selectedVariant.price : basePrice;
  const images = product.images ?? [];
  const gallery = product.gallery ?? [];
  const allImages = [...images, ...gallery];
  const includes = product.includes ?? [];
  const excludes = product.excludes ?? [];
  const features = product.features ?? [];
  const requirements = product.requirements ?? [];
  const variants = product.variants ?? [];
  const isSoldOut =
    product.tripId && product.availableSeats != null
      ? product.availableSeats <= 0
      : product.trackInventory && product.stockQuantity != null && product.stockQuantity <= 0;

  const favItemType = product.tripId ? "trip" : "product";
  const favItemId = product.tripId ?? product.id;
  const isFav = isFavorited(favItemType, favItemId);

  function handleReserveNow() {
    navigate(`/loja/${slug}/reservar/${productSlug}`);
  }

  function handleWhatsApp() {
    const phone = store.contactWhatsapp?.replace(/\D/g, "");
    if (!phone) return;
    const variant = selectedVariant ? ` (${selectedVariant.label})` : "";
    const text = encodeURIComponent(
      `Olá! Tenho interesse no pacote *${product!.name}*${variant} — R$ ${effectivePrice.toFixed(2)}. Poderia me dar mais informações?`
    );
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
  }

  const avgRating =
    product.reviews.length > 0
      ? product.reviews.reduce((a, r) => a + r.rating, 0) / product.reviews.length
      : 0;

  function handleShare() {
    if (!product) return;
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: product.name, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const tabs = [
    { key: "descricao" as const, label: "Descrição", show: !!product.description },
    { key: "requisitos" as const, label: "Requisitos", show: requirements.length > 0 },
    { key: "destaques" as const, label: "Destaques", show: features.length > 0 },
  ].filter((t) => t.show);

  const defaultTab = tabs[0]?.key ?? "descricao";
  const currentTab = tabs.find((t) => t.key === activeTab) ? activeTab : defaultTab;

  const typeLabel =
    product.type === "package"
      ? "Pacote"
      : product.type === "service"
        ? "Serviço"
        : product.type === "tour"
          ? "Passeio"
          : product.type === "excursion"
            ? "Excursão"
            : "Produto";

  const hasInfoGrid =
    !!(product.startDate ||
      product.departureDate ||
      product.durationDays ||
      product.endDate ||
      product.returnDate ||
      (product.tripId && product.availableSeats != null) ||
      (product.trackInventory && product.stockQuantity != null));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-28 lg:pb-12">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => navigate(`/loja/${slug}/produtos`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Voltar ao Catálogo
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          title="Compartilhar"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <span className="text-green-500">Link copiado!</span>
            </>
          ) : (
            <>
              <Share2 className="w-4 h-4" />
              Compartilhar
            </>
          )}
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr]">
        {/* LEFT: gallery */}
        <div>
          {/* Hero carousel */}
          <div
            className="relative rounded-2xl overflow-hidden bg-muted h-72 sm:h-96"
            onTouchStart={(e) => { heroTouchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (heroTouchStartX.current === null || images.length <= 1) return;
              const dx = e.changedTouches[0].clientX - heroTouchStartX.current;
              heroTouchStartX.current = null;
              if (Math.abs(dx) < 30) return;
              if (dx < 0) setImgIndex((i) => (i + 1) % images.length);
              else setImgIndex((i) => (i - 1 + images.length) % images.length);
            }}
          >
            {images[imgIndex] ? (
              <button
                className="w-full h-full block relative group"
                onClick={() => openLightbox(allImages, imgIndex)}
                aria-label="Ampliar imagem"
              >
                <div className="absolute inset-0 bg-muted animate-pulse" aria-hidden="true" />
                <img
                  key={imgIndex}
                  src={images[imgIndex]}
                  alt={product.name}
                  className="relative w-full h-full object-cover opacity-0"
                  style={{ transition: "opacity 0.3s" }}
                  onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = "1"; }}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <Maximize2 className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                </div>
              </button>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <MapPin className="w-20 h-20 text-muted-foreground/20" />
              </div>
            )}
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setImgIndex((i) => (i - 1 + images.length) % images.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                >
                  <PrevIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setImgIndex((i) => (i + 1) % images.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                >
                  <NextIcon className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setImgIndex(i)}
                      className={`rounded-full transition-all ${i === imgIndex ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/60 hover:bg-white/80"}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Thumbnails */}
          {images.length > 1 && (
            <div className="flex gap-2 mt-4 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setImgIndex(i)}
                  className={`w-16 h-16 rounded-lg border-2 overflow-hidden shrink-0 transition-colors ${
                    i === imgIndex ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Gallery grid */}
          {allImages.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Images className="w-5 h-5 text-muted-foreground" />
                Galeria de Fotos
                <span className="text-sm font-normal text-muted-foreground">({allImages.length} foto{allImages.length !== 1 ? "s" : ""})</span>
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {allImages.map((img, i) => (
                  <GalleryThumb
                    key={i}
                    src={img}
                    index={i}
                    onClick={() => openLightbox(allImages, i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Trip videos */}
          {(product.tripVideos ?? []).length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Video className="w-5 h-5 text-muted-foreground" />
                Vídeos da Viagem
                <span className="text-sm font-normal text-muted-foreground">({(product.tripVideos ?? []).length} vídeo{(product.tripVideos ?? []).length !== 1 ? "s" : ""})</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(product.tripVideos ?? []).map((url, i) => {
                  const embedUrl = getTripVideoEmbedUrl(url);
                  if (embedUrl) {
                    return (
                      <div key={i} className="w-full aspect-video overflow-hidden rounded-xl border bg-black">
                        <iframe
                          src={embedUrl}
                          title={`Vídeo da viagem ${i + 1}`}
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          className="w-full h-full border-0"
                        />
                      </div>
                    );
                  }

                  return (
                    <video
                      key={i}
                      src={url}
                      controls
                      preload="metadata"
                      className="w-full rounded-xl border bg-black"
                      style={{ maxHeight: "280px" }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: purchase card */}
        <div>
          <div className="lg:sticky lg:top-6 space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{typeLabel}</Badge>
              {product.isFeatured && (
                <Badge style={{ backgroundColor: colors.accent, color: colors.accentForeground }}>
                  ★ Destaque
                </Badge>
              )}
            </div>

            <div>
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">{product.name}</h1>
              {(() => {
                const dest = product.tripId
                  ? [product.destinationCity, product.destinationState].filter(Boolean).join(", ")
                  : product.destination ?? null;
                return dest ? (
                  <p className="text-muted-foreground flex items-center gap-1.5 mt-2">
                    <MapPin className="w-4 h-4 shrink-0" />
                    {dest}
                  </p>
                ) : null;
              })()}
            </div>

            {product.reviews.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <StarRating rating={Math.round(avgRating)} />
                <span className="font-medium">{avgRating.toFixed(1)}</span>
                <span className="text-muted-foreground">({product.reviews.length} avaliação(ões))</span>
              </div>
            )}

            {product.shortDescription && (
              <p className="text-sm text-muted-foreground leading-relaxed">{product.shortDescription}</p>
            )}

            {(product.sellerName || partnerInfo?.seller) && (
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Vendido por</p>
                <div className="flex items-center gap-2 mt-1">
                  {partnerInfo?.seller?.logo && <img src={partnerInfo.seller.logo} alt="" className="w-7 h-7 rounded-full object-cover border" />}
                  <p className="text-sm font-semibold">{partnerInfo?.seller?.name ?? product.sellerName}</p>
                </div>
                {partnerInfo?.seller?.description && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{partnerInfo.seller.description}</p>}
              </div>
            )}

            {partnerInfo?.availability && partnerInfo.availability.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Próximas disponibilidades</p>
                <div className="flex flex-wrap gap-1.5">
                  {partnerInfo.availability.slice(0, 4).map((slot) => (
                    <Badge key={slot.date} variant="outline">
                      {new Date(`${slot.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })}
                      {" · "}{slot.spotsTotal - slot.spotsUsed} vaga(s)
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {hasInfoGrid && (
              <div className="grid grid-cols-2 gap-3">
                {(product.departureDate ?? product.startDate) && (
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
                    <Calendar className="w-5 h-5 shrink-0" style={{ color: colors.primary }} />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Saída</p>
                      <p className="text-xs font-semibold">
                        {new Date(
                          ((product.departureDate ?? product.startDate) as string).slice(0, 10) + "T12:00:00"
                        ).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })}
                        {product.departureTime && ` às ${product.departureTime}`}
                      </p>
                    </div>
                  </div>
                )}
                {(product.originCity || product.originState) && (
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
                    <MapPin className="w-5 h-5 shrink-0" style={{ color: colors.primary }} />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Origem</p>
                      <p className="text-xs font-semibold">{[product.originCity, product.originState].filter(Boolean).join(", ")}</p>
                    </div>
                  </div>
                )}
                {(product.returnDate ?? product.endDate) && (
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
                    <Calendar className="w-5 h-5 shrink-0" style={{ color: colors.primary }} />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Retorno</p>
                      <p className="text-xs font-semibold">
                        {new Date(
                          (product.returnDate ?? product.endDate)!.slice(0, 10) + "T12:00:00"
                        ).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })}
                        {product.returnTime && ` às ${product.returnTime}`}
                      </p>
                    </div>
                  </div>
                )}
                {(() => {
                  // Para viagens (trip products): duração = dias de estadia cadastrados no produto (durationDays + durationNights)
                  // Fallback: cálculo de tempo total (ida + volta) para viagens sem durationDays
                  let dur: { formatted: string } | null = null;
                  if (product.durationDays) {
                    const nights = product.durationNights;
                    dur = {
                      formatted: `${product.durationDays} dia${product.durationDays !== 1 ? "s" : ""}${nights ? ` / ${nights} noite${nights !== 1 ? "s" : ""}` : ""}`,
                    };
                  } else {
                    dur = calculateTripDuration(
                      product.departureDate ?? product.startDate,
                      product.returnDate ?? product.endDate,
                      product.departureTime,
                      product.returnTime,
                    );
                  }
                  return dur ? (
                    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3">
                      <Clock className="w-5 h-5 shrink-0" style={{ color: colors.primary }} />
                      <div>
                        <p className="text-[11px] text-muted-foreground">Duração</p>
                        <p className="text-xs font-semibold">{dur.formatted}</p>
                      </div>
                    </div>
                  ) : null;
                })()}
                {(() => {
                  // Para viagens (trip products): mostra vagas da viagem (availableSeats), não do produto genérico (stockQuantity)
                  const seats = product.tripId && product.availableSeats != null
                    ? product.availableSeats
                    : (product.trackInventory && product.stockQuantity != null ? product.stockQuantity : null);
                  if (seats == null) return null;
                  const soldOut = seats <= 0;
                  const low = !soldOut && seats <= 10;
                  return (
                    <div className={`flex items-center gap-2 p-3 rounded-xl border ${soldOut ? "bg-red-50" : low ? "bg-orange-50" : "bg-green-50"}`}>
                      <span className={`text-lg shrink-0 ${soldOut ? "text-red-600" : low ? "text-orange-600" : "text-green-600"}`}>👥</span>
                      <div>
                        <p className="text-[11px] text-muted-foreground">Vagas</p>
                        <p className={`text-xs font-semibold ${soldOut ? "text-red-600" : low ? "text-orange-600" : ""}`}>
                          {soldOut ? "Esgotado" : `${seats} disponível${seats !== 1 ? "is" : ""}`}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {variants.length > 0 && (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                {variants.map((v) => (
                  <div key={v.name}>
                    <p className="font-medium text-sm mb-2">{v.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {v.options.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => setSelectedVariant({ variantName: v.name, label: opt.label, price: opt.price })}
                          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                            selectedVariant?.label === opt.label
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {opt.label}
                          {opt.price !== basePrice && <span className="ml-1 text-xs">(R$ {opt.price.toFixed(2)})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Price */}
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-baseline gap-2 flex-wrap">
                {product.salePrice && (
                  <span className="text-base text-muted-foreground line-through">
                    {formatCurrency(parseFloat(product.price))}
                  </span>
                )}
                <span className="text-3xl font-bold" style={{ color: colors.primary }}>
                  {formatCurrency(effectivePrice)}
                </span>
                <span className="text-sm text-muted-foreground">/ pessoa</span>
              </div>
              <InstallmentSimulator price={effectivePrice} store={store} />
              <PriceAlert slug={slug} productId={product.id} />
            </div>

            {/* CTA */}
            <div className="flex gap-2">
              <Button
                className="flex-1 h-12 text-base font-bold"
                style={{ backgroundColor: colors.accent, color: colors.accentForeground }}
                onClick={handleReserveNow}
                disabled={isSoldOut}
              >
                <Zap className="w-5 h-5 mr-2" />
                {isSoldOut ? "Esgotado" : "Reservar Agora"}
              </Button>
              <button
                aria-label={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                onClick={() => toggleFavorite(favItemType, favItemId)}
                className={`h-12 w-12 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  isFav
                    ? "bg-red-500 border-red-500 text-white"
                    : "border-border text-muted-foreground hover:border-red-400 hover:text-red-500"
                }`}
              >
                <Heart className={`w-5 h-5 ${isFav ? "fill-current" : ""}`} />
              </button>
            </div>

            {store.contactWhatsapp && (
              <Button
                variant="outline"
                className="w-full h-11 font-semibold border-green-500 text-green-600 hover:bg-green-50"
                onClick={handleWhatsApp}
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Comprar pelo WhatsApp
              </Button>
            )}

            <button
              onClick={() => navigate(`/loja/${slug}/consultar-pedido`)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Search className="w-4 h-4" />
              Consultar pedido existente
            </button>

            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground border-t pt-4">
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: colors.primary }} />
              Reserva segura e confirmação imediata
            </p>
          </div>
        </div>
      </div>

      {/* What's included / excluded */}
      {partnerInfo?.hasPartner && (
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border p-5">
            <h2 className="font-semibold flex items-center gap-2"><MapPin className="w-5 h-5" /> Localização e origem</h2>
            {partnerInfo.origin && <p className="text-sm text-muted-foreground mt-3">Origem: {partnerInfo.origin}</p>}
            {partnerInfo.meetingPoint && <p className="text-sm text-muted-foreground mt-2">Encontro: {partnerInfo.meetingPoint}</p>}
            {partnerInfo.locationUrl && <a href={partnerInfo.locationUrl} target="_blank" rel="noreferrer" className="inline-flex text-sm font-medium text-primary mt-3 hover:underline">Abrir no mapa</a>}
          </div>
          <div className="rounded-2xl border p-5">
            <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Política do parceiro</h2>
            <p className="text-sm text-muted-foreground mt-3">{partnerInfo.cancellationPolicy ?? store.cancellationPolicy ?? "Consulte as condições de cancelamento antes de finalizar a reserva."}</p>
          </div>
          <div className="rounded-2xl border p-5 sm:col-span-2">
            <h2 className="font-semibold">Perguntas frequentes</h2>
            <div className="grid gap-3 mt-3 sm:grid-cols-2">
              {(partnerInfo.faq?.length ? partnerInfo.faq : [
                { question: "Como confirmo minha reserva?", answer: "Após o pagamento, você receberá a confirmação e as instruções do parceiro." },
                { question: "Onde é o ponto de encontro?", answer: partnerInfo.meetingPoint ?? "O parceiro enviará as orientações antes da atividade." },
              ]).map((entry) => (
                <div key={entry.question} className="rounded-lg bg-muted/40 p-3">
                  <p className="text-sm font-medium">{entry.question}</p>
                  <p className="text-sm text-muted-foreground mt-1">{entry.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* What's included / excluded */}
      {(includes.length > 0 || excludes.length > 0) && (
        <div className="mt-12">
          <SectionHeader eyebrow="Detalhes" title="O que está incluso" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {includes.length > 0 && (
              <div className="rounded-xl border p-5 bg-green-50/40">
                <h3 className="font-semibold text-green-700 mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Incluído
                </h3>
                <ul className="space-y-2.5">
                  {includes.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {excludes.length > 0 && (
              <div className="rounded-xl border p-5 bg-red-50/30">
                <h3 className="font-semibold text-red-700 mb-4 flex items-center gap-2">
                  <XCircle className="w-5 h-5" />
                  Não incluído
                </h3>
                <ul className="space-y-2.5">
                  {excludes.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs: description / requirements / highlights */}
      {tabs.length > 0 && (
        <div className="mt-12">
          <div className="border-b flex gap-0 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  currentTab === tab.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="pt-6">
            {currentTab === "descricao" && product.description && (
              <div
                className="prose prose-sm max-w-none text-muted-foreground leading-relaxed"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(product.description) }}
              />
            )}

            {currentTab === "requisitos" && requirements.length > 0 && (
              <ul className="space-y-2">
                {requirements.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            )}

            {currentTab === "destaques" && features.length > 0 && (
              <ul className="space-y-2">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Star className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Reviews */}
      {product.reviews.length > 0 && (
        <div className="mt-12">
          <SectionHeader eyebrow="Depoimentos" title="Avaliações dos Clientes" />
          <div className="space-y-4">
            {product.reviews.map((r) => (
              <div key={r.id} className="p-4 rounded-xl border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{r.customerName}</span>
                    <StarRating rating={r.rating} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </span>
                </div>
                {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                {r.reply && (
                  <div className="mt-3 pl-3 border-l-2 border-primary/30">
                    <p className="text-xs font-medium text-primary mb-1">Resposta da Agência:</p>
                    <p className="text-sm text-muted-foreground">{r.reply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related */}
      {related.length > 0 && (
        <div className="mt-14">
          <SectionHeader eyebrow="Sugestões" title="Você também pode gostar" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {related.map((r) => (
              <PremiumProductCard
                key={r.id}
                product={r}
                slug={slug}
                whatsapp={store.contactWhatsapp}
              />
            ))}
          </div>
        </div>
      )}

      {lightboxOpen && lightboxImages.length > 0 && (
        <Lightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Mobile sticky purchase bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t shadow-lg lg:hidden"
        style={{ backdropFilter: "blur(8px)" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Preço por pessoa</p>
            <div className="flex items-baseline gap-2">
              {product.salePrice && (
                <span className="text-sm text-muted-foreground line-through">
                  {formatCurrency(parseFloat(product.price))}
                </span>
              )}
              <span className="text-2xl font-bold" style={{ color: colors.primary }}>
                {formatCurrency(effectivePrice)}
              </span>
            </div>
          </div>
          <Button
            className="h-11 px-6 font-bold"
            style={{ backgroundColor: colors.accent, color: colors.accentForeground }}
            onClick={handleReserveNow}
            disabled={isSoldOut}
          >
            <Zap className="w-5 h-5 mr-2" />
            {isSoldOut ? "Esgotado" : "Reservar Agora"}
          </Button>
        </div>
      </div>
    </div>
  );
}
