import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function AsyncError({ error, retry, title = "Não foi possível carregar os dados." }: {
  error: string;
  retry: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="text-center py-10 space-y-3">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{error}</p>
      <Button type="button" variant="outline" onClick={retry}>Tentar novamente</Button>
    </div>
  );
}

export function AsyncEmpty({ children }: { children: ReactNode }) {
  return <div className="text-center py-10 text-sm text-muted-foreground">{children}</div>;
}

export function useAsyncResource<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRef.current();
      if (generation.current === current) setData(result);
    } catch (err) {
      if (generation.current === current) setError(err instanceof Error ? err.message : "Tente novamente.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload]);
  return { data, setData, loading, error, reload };
}