import { Check } from "lucide-react";
import { STEPS, type Step } from "./constants";
import type { ReactNode } from "react";

type StepEntry = { key: Step; label: string; icon: ReactNode };

export function StepIndicator({ current, steps = STEPS }: { current: Step; steps?: StepEntry[] }) {
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center justify-center mb-8 print:hidden">
      {steps.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  done
                    ? "bg-green-500 text-white"
                    : active
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : step.icon}
              </div>
              <span
                className={`text-xs mt-1 hidden sm:block ${
                  active ? "font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-12 mx-1 ${done ? "bg-green-500" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
