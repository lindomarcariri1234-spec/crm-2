import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";
import { clientPortalApi } from "@/lib/clientPortalApi";
import { useToast } from "@/hooks/use-toast";

interface FavoritesContextType {
  tripIds: Set<string>;
  productIds: Set<string>;
  loading: boolean;
  toggleFavorite: (itemType: "trip" | "product", itemId: string) => Promise<void>;
  isFavorited: (itemType: "trip" | "product", itemId: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { data: me } = useGetMe();
  const isClient = me?.role === ROLES.CLIENT;
  const { toast } = useToast();

  const [tripIds, setTripIds] = useState<Set<string>>(new Set());
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isClient) {
      setTripIds(new Set());
      setProductIds(new Set());
      return;
    }
    setLoading(true);
    clientPortalApi
      .getFavorites()
      .then((data) => {
        setTripIds(new Set(data.trips.map((t) => t.tripId)));
        setProductIds(new Set(data.products.map((p) => p.productId)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isClient]);

  const toggleFavorite = useCallback(
    async (itemType: "trip" | "product", itemId: string) => {
      if (!isClient) {
        toast({
          title: "Faça login para salvar favoritos",
          description: "Entre na sua conta para guardar seus pacotes favoritos.",
        });
        return;
      }

      const set = itemType === "trip" ? tripIds : productIds;
      const setFn = itemType === "trip" ? setTripIds : setProductIds;
      const isFav = set.has(itemId);

      setFn((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(itemId);
        else next.add(itemId);
        return next;
      });

      try {
        if (isFav) {
          await clientPortalApi.removeFavorite(itemType, itemId);
        } else {
          await clientPortalApi.addFavorite(itemType, itemId);
        }
      } catch {
        setFn((prev) => {
          const next = new Set(prev);
          if (isFav) next.add(itemId);
          else next.delete(itemId);
          return next;
        });
        toast({
          title: "Erro ao atualizar favoritos",
          description: "Tente novamente.",
          variant: "destructive",
        });
      }
    },
    [isClient, tripIds, productIds, toast],
  );

  const isFavorited = useCallback(
    (itemType: "trip" | "product", itemId: string) => {
      return itemType === "trip" ? tripIds.has(itemId) : productIds.has(itemId);
    },
    [tripIds, productIds],
  );

  return (
    <FavoritesContext.Provider value={{ tripIds, productIds, loading, toggleFavorite, isFavorited }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used inside FavoritesProvider");
  return ctx;
}
