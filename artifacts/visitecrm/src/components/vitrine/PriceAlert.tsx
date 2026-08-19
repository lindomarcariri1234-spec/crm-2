import { useState } from "react";
import { publicStoreApi } from "@/lib/storeApi";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { BellRing, Loader2, CheckCircle2 } from "lucide-react";

/**
 * Public price-drop alert subscribe widget (double opt-in).
 *
 * Collects an e-mail and asks the backend to send a confirmation link. The
 * backend always returns a generic success (to avoid e-mail enumeration), so
 * this component shows the same friendly confirmation regardless. Fail-safe:
 * a network error still shows a neutral message and never breaks the page.
 */
export function PriceAlert({
  slug,
  productId,
}: {
  slug: string;
  productId: string;
}) {
  const { colors } = useVitrineTheme();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid || status === "loading") return;
    setStatus("loading");
    try {
      const res = await publicStoreApi.subscribePriceAlert(slug, productId, email.trim());
      setMessage(res.message || "Enviamos um e-mail para você confirmar o alerta de preço.");
      setStatus("done");
    } catch {
      setMessage("Não foi possível registrar agora. Tente novamente em instantes.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-black/5 bg-white/60 p-3 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colors.primary }} />
        <span>{message}</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-black/[0.03]"
        style={{ borderColor: colors.primary, color: colors.primary }}
      >
        <BellRing className="h-4 w-4" />
        Avise-me quando baixar o preço
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-black/5 bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <BellRing className="h-3.5 w-3.5" style={{ color: colors.primary }} />
        Alerta de preço
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Receba um e-mail assim que este produto ficar mais barato. Confirme pelo link que enviarmos.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2"
          style={{ ["--tw-ring-color" as string]: colors.primary }}
          required
        />
        <button
          type="submit"
          disabled={!emailValid || status === "loading"}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: colors.primary }}
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Avisar
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-[11px] text-red-600">{message}</p>
      )}
    </form>
  );
}
