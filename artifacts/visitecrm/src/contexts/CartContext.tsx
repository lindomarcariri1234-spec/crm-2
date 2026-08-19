import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

export interface CartItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  variantLabel?: string;
  image?: string;
}

export const CART_ITEM_NONE = "__none__";

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
  updateQuantity: (productId: string, variantLabel: string | undefined, quantity: number) => void;
  removeItem: (productId: string, variantLabel?: string) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

const CartContext = createContext<CartContextType | null>(null);

function storageKey(slug: string) {
  return `cart_${slug}`;
}

function loadItems(slug: string): CartItem[] {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

function saveItems(slug: string, items: CartItem[]) {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function CartProvider({ children, slug }: { children: ReactNode; slug?: string }) {
  const [items, setItems] = useState<CartItem[]>(() =>
    slug ? loadItems(slug) : []
  );
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (slug) {
      setItems(loadItems(slug));
    } else {
      setItems([]);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) {
      saveItems(slug, items);
    }
  }, [items, slug]);

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity"> & { quantity?: number }) => {
      setItems((prev) => {
        const key = `${item.productId}::${item.variantLabel ?? CART_ITEM_NONE}`;
        const existing = prev.find(
          (i) =>
            `${i.productId}::${i.variantLabel ?? CART_ITEM_NONE}` === key
        );
        if (existing) {
          return prev.map((i) =>
            `${i.productId}::${i.variantLabel ?? CART_ITEM_NONE}` === key
              ? { ...i, quantity: i.quantity + (item.quantity ?? 1) }
              : i
          );
        }
        return [...prev, { ...item, quantity: item.quantity ?? 1 }];
      });
    },
    []
  );

  const updateQuantity = useCallback(
    (productId: string, variantLabel: string | undefined, quantity: number) => {
      setItems((prev) => {
        const key = `${productId}::${variantLabel ?? CART_ITEM_NONE}`;
        if (quantity <= 0) {
          return prev.filter(
            (i) => `${i.productId}::${i.variantLabel ?? CART_ITEM_NONE}` !== key
          );
        }
        return prev.map((i) =>
          `${i.productId}::${i.variantLabel ?? CART_ITEM_NONE}` === key
            ? { ...i, quantity }
            : i
        );
      });
    },
    []
  );

  const removeItem = useCallback(
    (productId: string, variantLabel?: string) => {
      const key = `${productId}::${variantLabel ?? CART_ITEM_NONE}`;
      setItems((prev) =>
        prev.filter((i) => `${i.productId}::${i.variantLabel ?? CART_ITEM_NONE}` !== key)
      );
    },
    []
  );

  const clearCart = useCallback(() => setItems([]), []);
  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const toggleCart = useCallback(() => setIsOpen((v) => !v), []);

  const total = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        total,
        itemCount,
        isOpen,
        openCart,
        closeCart,
        toggleCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
