import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

export interface ComparisonItem {
  productId: string;
  productSlug: string;
  name: string;
  image?: string;
  priceAtAdd: number;
}

export const MAX_COMPARE = 3;

type ToggleResult = "added" | "removed" | "full";

interface ComparisonContextType {
  items: ComparisonItem[];
  count: number;
  isFull: boolean;
  isComparing: (productId: string) => boolean;
  toggle: (item: ComparisonItem) => ToggleResult;
  remove: (productId: string) => void;
  clear: () => void;
}

const ComparisonContext = createContext<ComparisonContextType | null>(null);

function storageKey(slug: string) {
  return `compare_${slug}`;
}

function loadItems(slug: string): ComparisonItem[] {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ComparisonItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_COMPARE);
  } catch {
    return [];
  }
}

function saveItems(slug: string, items: ComparisonItem[]) {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function ComparisonProvider({
  children,
  slug,
}: {
  children: ReactNode;
  slug?: string;
}) {
  const [items, setItems] = useState<ComparisonItem[]>(() =>
    slug ? loadItems(slug) : []
  );

  useEffect(() => {
    setItems(slug ? loadItems(slug) : []);
  }, [slug]);

  useEffect(() => {
    if (slug) saveItems(slug, items);
  }, [items, slug]);

  const isComparing = useCallback(
    (productId: string) => items.some((i) => i.productId === productId),
    [items]
  );

  const toggle = useCallback((item: ComparisonItem): ToggleResult => {
    let result: ToggleResult = "added";
    setItems((prev) => {
      if (prev.some((i) => i.productId === item.productId)) {
        result = "removed";
        return prev.filter((i) => i.productId !== item.productId);
      }
      if (prev.length >= MAX_COMPARE) {
        result = "full";
        return prev;
      }
      result = "added";
      return [...prev, item];
    });
    return result;
  }, []);

  const remove = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return (
    <ComparisonContext.Provider
      value={{
        items,
        count: items.length,
        isFull: items.length >= MAX_COMPARE,
        isComparing,
        toggle,
        remove,
        clear,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  const ctx = useContext(ComparisonContext);
  if (!ctx) throw new Error("useComparison must be used inside ComparisonProvider");
  return ctx;
}
