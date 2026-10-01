import type { ElementType } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  color,
}: {
  icon: ElementType;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`mt-1 p-2 rounded-md bg-muted ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        {trend && (
          <div className={trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}>
            {trend === "up" ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}