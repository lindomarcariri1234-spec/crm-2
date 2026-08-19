import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Images, Trash2, Play, Camera, Video, RefreshCw,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE_SIZE = 50;

interface MediaItem {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  tripId: string;
  tripName: string;
  tripSlug: string;
  uploadedByUserId: string | null;
  createdAt: string;
}

type TypeFilter = "all" | "image" | "video";

export function TripMediaGallery() {
  const { toast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMedia = useCallback(async (filter: TypeFilter, offset: number, append: boolean) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filter !== "all") params.set("type", filter);
    const res = await fetch(`${API_BASE}/api/trips/media?${params}`, { credentials: "include" });
    if (!res.ok) throw new Error("Erro ao carregar mídia");
    const json = await res.json() as { data: MediaItem[]; total: number };
    if (append) {
      setItems((prev) => [...prev, ...json.data]);
    } else {
      setItems(json.data);
    }
    setTotal(json.total);
  }, []);

  // Initial / filter-change load
  useEffect(() => {
    setLoading(true);
    fetchMedia(typeFilter, 0, false)
      .catch(() => toast({ title: "Erro ao carregar arquivos de mídia", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [typeFilter, fetchMedia, toast]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchMedia(typeFilter, items.length, true);
    } catch {
      toast({ title: "Erro ao carregar mais arquivos", variant: "destructive" });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDelete = async (item: MediaItem) => {
    setDeletingId(item.id);
    try {
      const res = await fetch(`${API_BASE}/api/trips/${item.tripId}/media/${item.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Falha ao remover");
      setItems((prev) => prev.filter((m) => m.id !== item.id));
      setTotal((t) => t - 1);
      toast({ title: "Arquivo removido" });
    } catch {
      toast({ title: "Erro ao remover arquivo", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const imageCount = items.filter((m) => m.type === "image").length;
  const videoCount = items.filter((m) => m.type === "video").length;
  const hasMore = items.length < total;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/trips">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mídia das Viagens</h1>
          <p className="text-muted-foreground text-sm">
            Fotos e vídeos enviados nas viagens da agência
          </p>
        </div>
      </div>

      {/* Filter tabs + summary */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {(["all", "image", "video"] as TypeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                typeFilter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" && <Images className="w-3.5 h-3.5" />}
              {f === "image" && <Camera className="w-3.5 h-3.5" />}
              {f === "video" && <Video className="w-3.5 h-3.5" />}
              {f === "all" ? "Todos" : f === "image" ? "Fotos" : "Vídeos"}
            </button>
          ))}
        </div>

        {!loading && (
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "Nenhum arquivo" : (
              <>
                <span className="font-medium text-foreground">{total}</span> arquivo{total !== 1 ? "s" : ""}
                {typeFilter === "all" && total > 0 && (
                  <> · {imageCount} foto{imageCount !== 1 ? "s" : ""} · {videoCount} vídeo{videoCount !== 1 ? "s" : ""}</>
                )}
              </>
            )}
          </p>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl p-12 text-center">
          <Images className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium text-muted-foreground">
            {typeFilter === "all"
              ? "Nenhum arquivo de mídia encontrado"
              : typeFilter === "image"
              ? "Nenhuma foto encontrada"
              : "Nenhum vídeo encontrado"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Fotos e vídeos enviados nas abas de mídia das viagens aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              deleting={deletingId === item.id}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Carregando...</>
            ) : (
              <>Carregar mais ({total - items.length} restantes)</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function MediaCard({
  item,
  deleting,
  onDelete,
}: {
  item: MediaItem;
  deleting: boolean;
  onDelete: (item: MediaItem) => void;
}) {
  const isVideo = item.type === "video";
  const date = new Date(item.createdAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
      {isVideo ? (
        <div className="w-full h-full flex items-center justify-center bg-slate-800">
          <Play className="w-8 h-8 text-white/70" />
        </div>
      ) : (
        <img
          src={item.url}
          alt={item.caption ?? ""}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors" />

      {/* Type badge */}
      {isVideo && (
        <Badge className="absolute top-1 left-1 h-5 text-[10px] bg-slate-900/80 text-white border-0 px-1.5">
          Vídeo
        </Badge>
      )}

      {/* Delete button */}
      <button
        className="absolute top-1 right-1 h-6 w-6 rounded-md bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
        onClick={() => onDelete(item)}
        disabled={deleting}
        title="Remover arquivo"
      >
        {deleting ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <Trash2 className="w-3 h-3" />
        )}
      </button>

      {/* Bottom info */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2 translate-y-full group-hover:translate-y-0 transition-transform">
        <Link href={`/trips/${item.tripId}/edit`}>
          <p className="text-white text-[10px] font-medium truncate hover:underline leading-tight">
            {item.tripName}
          </p>
        </Link>
        {item.caption && (
          <p className="text-white/70 text-[9px] truncate mt-0.5 leading-tight">{item.caption}</p>
        )}
        <p className="text-white/50 text-[9px] mt-0.5 leading-tight">{date}</p>
      </div>
    </div>
  );
}
