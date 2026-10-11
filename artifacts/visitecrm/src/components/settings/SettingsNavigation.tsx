import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SettingsNavigationItem = {
  value: string;
  label: string;
  icon: LucideIcon;
};

export type SettingsNavigationGroup = {
  label: string;
  items: readonly SettingsNavigationItem[];
};

type SettingsNavigationProps = {
  groups: readonly SettingsNavigationGroup[];
  pageLabel: string;
  testIdPrefix: string;
  value: string;
  onValueChange: (value: string) => void;
  orientation?: "vertical" | "horizontal";
};

export function SettingsNavigation({
  groups,
  pageLabel,
  testIdPrefix,
  value,
  onValueChange,
  orientation = "vertical",
}: SettingsNavigationProps) {
  if (orientation === "horizontal") {
    return (
      <div className="w-full overflow-x-auto rounded-2xl border border-[#DCE3E8] bg-white/85 shadow-sm dark:border-border dark:bg-card">
        <TabsList
          aria-label={`${pageLabel}: navegação`}
          className="flex h-auto w-max min-w-full items-center justify-start gap-1 rounded-2xl bg-transparent p-2 text-muted-foreground"
        >
          {groups.flatMap((group) => group.items.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger
                key={item.value}
                value={item.value}
                data-testid={`${testIdPrefix}-tab-${item.value}`}
                className="shrink-0 justify-start gap-2 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap data-[state=active]:bg-[#EAF1F4] data-[state=active]:text-[#1E5B8C] data-[state=active]:shadow-none dark:data-[state=active]:bg-secondary dark:data-[state=active]:text-secondary-foreground"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </TabsTrigger>
            );
          }))}
        </TabsList>
      </div>
    );
  }

  return (
    <>
      <div className="lg:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger
            aria-label={`${pageLabel}: selecionar seção`}
            data-testid={`${testIdPrefix}-select`}
            className="h-12 rounded-xl border-[#DCE3E8] bg-white dark:bg-card"
          >
            <SelectValue placeholder="Escolha uma seção" />
          </SelectTrigger>
          <SelectContent className="max-h-[70vh]">
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    data-testid={`${testIdPrefix}-option-${item.value}`}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label={`${pageLabel}: navegação`}
        className="hidden rounded-2xl border border-[#DCE3E8] bg-white/85 p-2 shadow-sm dark:border-border dark:bg-card lg:block"
      >
        <p className="px-3 py-2 text-xs font-semibold text-foreground">{pageLabel}</p>
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </p>
              <TabsList
                aria-label={group.label}
                className="flex h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-xl bg-transparent p-0 text-muted-foreground"
              >
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger
                      key={item.value}
                      value={item.value}
                      data-testid={`${testIdPrefix}-tab-${item.value}`}
                      className="w-full justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm whitespace-normal data-[state=active]:bg-[#EAF1F4] data-[state=active]:text-[#1E5B8C] data-[state=active]:shadow-none dark:data-[state=active]:bg-secondary dark:data-[state=active]:text-secondary-foreground"
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </section>
          ))}
        </div>
      </nav>
    </>
  );
}
