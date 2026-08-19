import { ReactNode } from "react";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

/**
 * Reusable storefront section header. Renders an optional brand-colored eyebrow,
 * a title, an optional subtitle, and an optional action slot (e.g. a "ver todos"
 * link). Brand colors come from the scoped Vitrine theme.
 */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
  action,
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
  action?: ReactNode;
  className?: string;
}) {
  const { colors } = useVitrineTheme();
  const isCenter = align === "center";

  return (
    <div
      className={`mb-6 flex flex-col gap-3 sm:flex-row sm:items-end ${
        isCenter ? "sm:flex-col sm:items-center" : "sm:justify-between"
      } ${className}`}
    >
      <div className={isCenter ? "text-center" : ""}>
        {eyebrow && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] ${
              isCenter ? "justify-center" : ""
            }`}
            style={{ color: colors.accent }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: colors.accent }}
            />
            {eyebrow}
          </span>
        )}
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        {subtitle && (
          <p
            className={`mt-1.5 max-w-xl text-sm text-muted-foreground ${
              isCenter ? "mx-auto" : ""
            }`}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
