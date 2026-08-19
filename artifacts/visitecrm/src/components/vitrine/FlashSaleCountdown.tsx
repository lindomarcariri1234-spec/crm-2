import { useState, useEffect } from "react";
import { Flame } from "lucide-react";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

/**
 * Live flash-sale countdown driven by a real `saleEndsAt` timestamp. It NEVER
 * invents a deadline: callers must pass a genuine end date. When the date is
 * missing, invalid, or already in the past the component renders nothing, so it
 * is safe to mount unconditionally for on-sale products.
 *
 * - `badge`  — compact pill for product cards.
 * - `banner` — prominent strip for the home "Ofertas Relâmpago" section.
 */
function getRemaining(endsAtMs: number): {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const diff = endsAtMs - Date.now();
  if (diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return { expired: false, days, hours, minutes, seconds };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function FlashSaleCountdown({
  endsAt,
  variant = "badge",
  className = "",
}: {
  endsAt?: string | null;
  variant?: "badge" | "banner";
  className?: string;
}) {
  const { colors } = useVitrineTheme();
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : NaN;
  const valid = !isNaN(endsAtMs);

  const [remaining, setRemaining] = useState(() =>
    valid ? getRemaining(endsAtMs) : { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
  );

  useEffect(() => {
    if (!valid) return;
    setRemaining(getRemaining(endsAtMs));
    const timer = setInterval(() => {
      const next = getRemaining(endsAtMs);
      setRemaining(next);
      if (next.expired) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAtMs, valid]);

  if (!valid || remaining.expired) return null;

  const { days, hours, minutes, seconds } = remaining;
  const timeStr =
    days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  if (variant === "banner") {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 ${className}`}
        style={{ background: colors.accentSoft, color: colors.accent }}
      >
        <span className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
          <Flame className="h-4 w-4" /> Oferta relâmpago
        </span>
        <span className="text-sm">Termina em</span>
        <span className="font-mono text-lg font-extrabold tabular-nums">{timeStr}</span>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${className}`}
      style={{ background: colors.accentSoft, color: colors.accent }}
    >
      <Flame className="h-3 w-3" />
      <span className="font-mono">{timeStr}</span>
    </span>
  );
}
