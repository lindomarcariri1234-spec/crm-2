import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X, Check, Loader2 } from "lucide-react";
import { formatCurrency } from "./utils";
import { FIXED_COST_CATEGORIES, VARIABLE_COST_CATEGORIES } from "./constants";
import type { TripFormData } from "./types";

interface NewFixed { category: string; description: string; customDesc: string; value: string }
interface NewVariable { category: string; description: string; customDesc: string; valuePax: string }

interface TripFormPricesTabProps {
  form: TripFormData;
  setForm: React.Dispatch<React.SetStateAction<TripFormData>>;
  newFixed: NewFixed;
  setNewFixed: React.Dispatch<React.SetStateAction<NewFixed>>;
  newVariable: NewVariable;
  setNewVariable: React.Dispatch<React.SetStateAction<NewVariable>>;
  tripId?: string;
  isSavingCosts: boolean;
  isPending: boolean;
  handleSaveCosts: () => void;
}

const EMPTY_NEW_FIXED: NewFixed = { category: "", description: "", customDesc: "", value: "" };
const EMPTY_NEW_VARIABLE: NewVariable = { category: "", description: "", customDesc: "", valuePax: "" };

export function TripFormPricesTab({ form, setForm, newFixed, setNewFixed, newVariable, setNewVariable, tripId, isSavingCosts, isPending, handleSaveCosts }: TripFormPricesTabProps) {
  const cap = parseInt(form.totalCapacity || "0");
  const grossRevenue = parseFloat(form.priceAdult || "0") * cap;
  const totalFixed = form.fixedCostItems.reduce((s, c) => s + c.value, 0);
  const totalVariablePax = form.variableCostItems.reduce((s, c) => s + c.valuePax, 0);
  const totalVariable = totalVariablePax * cap;
  const totalOperational = totalFixed + totalVariable;
  const costPerPax = cap > 0 ? totalOperational / cap : 0;
  const profit = grossRevenue - totalOperational;
  const marginPct = grossRevenue > 0 ? Math.round(profit / grossRevenue * 100) : 0;

  return (
    <>
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">Preços por Categoria</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Preço Adulto (R$) *</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={form.priceAdult} onChange={e => setForm(p => ({ ...p, priceAdult: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Preço Criança (R$)</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={form.priceChild} onChange={e => setForm(p => ({ ...p, priceChild: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Preço Idoso (R$)</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={form.priceSenior} onChange={e => setForm(p => ({ ...p, priceSenior: e.target.value }))} />
          </div>
        </div>
        <div className="border-t pt-4 space-y-3">
          <h4 className="font-medium text-sm">Faixas de Preço Dinâmico</h4>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Preço de Lançamento (–20%)", value: form.priceAdult ? formatCurrency(parseFloat(form.priceAdult) * 0.8) : "—" },
              { label: "Preço Antecipado (–10%)", value: form.priceAdult ? formatCurrency(parseFloat(form.priceAdult) * 0.9) : "—" },
              { label: "Preço Padrão", value: form.priceAdult ? formatCurrency(parseFloat(form.priceAdult)) : "—" },
              { label: "Preço de Última Hora (+10%)", value: form.priceAdult ? formatCurrency(parseFloat(form.priceAdult) * 1.1) : "—" },
            ].map(tier => (
              <div key={tier.label} className="flex justify-between items-center p-3 bg-muted/30 rounded-lg text-sm">
                <span className="text-muted-foreground">{tier.label}</span>
                <span className="font-medium">{tier.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h3 className="font-semibold">Custos Fixos</h3>
          <p className="text-sm text-muted-foreground">Valores que não dependem do número de passageiros</p>
        </div>
        {form.fixedCostItems.length > 0 && (
          <div className="space-y-2">
            {form.fixedCostItems.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">{item.category}</span>
                  <span className="truncate">{item.description}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span className="font-semibold text-sm">{formatCurrency(item.value)}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => setForm(prev => ({ ...prev, fixedCostItems: prev.fixedCostItems.filter(c => c.id !== item.id) }))}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-1 text-sm font-semibold border-t">
              <span>Total Fixo</span>
              <span>{formatCurrency(totalFixed)}</span>
            </div>
          </div>
        )}
        <div className="border rounded-lg p-4 space-y-3 bg-muted/10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adicionar Custo Fixo</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={newFixed.category}
                onChange={e => setNewFixed(prev => ({ ...prev, category: e.target.value, description: "", customDesc: "" }))}>
                <option value="">Selecione...</option>
                {Object.keys(FIXED_COST_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              {newFixed.category && newFixed.description !== "Outro" ? (
                <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={newFixed.description}
                  onChange={e => setNewFixed(prev => ({ ...prev, description: e.target.value, customDesc: "" }))}>
                  <option value="">Selecione...</option>
                  {(FIXED_COST_CATEGORIES[newFixed.category] ?? []).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : newFixed.description === "Outro" ? (
                <Input placeholder="Descreva o custo..." value={newFixed.customDesc}
                  onChange={e => setNewFixed(prev => ({ ...prev, customDesc: e.target.value }))} />
              ) : (
                <Input disabled placeholder="Selecione uma categoria primeiro" className="bg-muted/30" />
              )}
            </div>
          </div>
          <div className="flex gap-3 items-end">
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Valor (R$)</Label>
              <Input type="number" step="0.01" placeholder="0.00" value={newFixed.value}
                onChange={e => setNewFixed(prev => ({ ...prev, value: e.target.value }))} />
            </div>
            <Button size="sm" variant="outline"
              disabled={!newFixed.category || !newFixed.description || (newFixed.description === "Outro" && !newFixed.customDesc) || !newFixed.value}
              onClick={() => {
                const desc = newFixed.description === "Outro" ? newFixed.customDesc : newFixed.description;
                setForm(prev => ({ ...prev, fixedCostItems: [...prev.fixedCostItems, { id: crypto.randomUUID(), category: newFixed.category, description: desc, value: parseFloat(newFixed.value) || 0 }] }));
                setNewFixed(EMPTY_NEW_FIXED);
              }}>
              <Plus className="w-4 h-4 mr-1" />Adicionar
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h3 className="font-semibold">Custos Variáveis</h3>
          <p className="text-sm text-muted-foreground">Valores multiplicados pelo número de passageiros</p>
        </div>
        {form.variableCostItems.length > 0 && (
          <div className="space-y-2">
            {form.variableCostItems.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">{item.category}</span>
                  <span className="truncate">{item.description}</span>
                  <span className="text-muted-foreground text-xs shrink-0">{formatCurrency(item.valuePax)}/pax</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span className="font-semibold text-sm">{cap > 0 ? formatCurrency(item.valuePax * cap) : "—"}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => setForm(prev => ({ ...prev, variableCostItems: prev.variableCostItems.filter(c => c.id !== item.id) }))}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-1 text-sm font-semibold border-t">
              <span>Total Variável ({cap} pax)</span>
              <span>{formatCurrency(totalVariable)}</span>
            </div>
          </div>
        )}
        <div className="border rounded-lg p-4 space-y-3 bg-muted/10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adicionar Custo Variável</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={newVariable.category}
                onChange={e => setNewVariable(prev => ({ ...prev, category: e.target.value, description: "", customDesc: "" }))}>
                <option value="">Selecione...</option>
                {Object.keys(VARIABLE_COST_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              {newVariable.category && newVariable.description !== "Outro" ? (
                <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={newVariable.description}
                  onChange={e => setNewVariable(prev => ({ ...prev, description: e.target.value, customDesc: "" }))}>
                  <option value="">Selecione...</option>
                  {(VARIABLE_COST_CATEGORIES[newVariable.category] ?? []).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : newVariable.description === "Outro" ? (
                <Input placeholder="Descreva o custo..." value={newVariable.customDesc}
                  onChange={e => setNewVariable(prev => ({ ...prev, customDesc: e.target.value }))} />
              ) : (
                <Input disabled placeholder="Selecione uma categoria primeiro" className="bg-muted/30" />
              )}
            </div>
          </div>
          <div className="flex gap-3 items-end">
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Valor por Passageiro (R$)</Label>
              <Input type="number" step="0.01" placeholder="0.00" value={newVariable.valuePax}
                onChange={e => setNewVariable(prev => ({ ...prev, valuePax: e.target.value }))} />
            </div>
            <Button size="sm" variant="outline"
              disabled={!newVariable.category || !newVariable.description || (newVariable.description === "Outro" && !newVariable.customDesc) || !newVariable.valuePax}
              onClick={() => {
                const desc = newVariable.description === "Outro" ? newVariable.customDesc : newVariable.description;
                setForm(prev => ({ ...prev, variableCostItems: [...prev.variableCostItems, { id: crypto.randomUUID(), category: newVariable.category, description: desc, valuePax: parseFloat(newVariable.valuePax) || 0 }] }));
                setNewVariable(EMPTY_NEW_VARIABLE);
              }}>
              <Plus className="w-4 h-4 mr-1" />Adicionar
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">Resumo Financeiro</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: "Vagas Disponíveis (capacidade total)", value: `${cap} vagas`, muted: false },
            { label: "Total Custos Fixos", value: formatCurrency(totalFixed), muted: false },
            { label: `Total Custos Variáveis (${cap} pax)`, value: formatCurrency(totalVariable), muted: false },
            { label: "Custo Operacional Total", value: formatCurrency(totalOperational), muted: false },
            { label: "Custo por Passageiro", value: formatCurrency(costPerPax), muted: false },
            { label: `Receita Bruta (${cap} passageiros, 100%)`, value: formatCurrency(grossRevenue), muted: false },
            { label: `Receita Bruta (${cap} passageiros, 80%)`, value: formatCurrency(grossRevenue * 0.8), muted: true },
          ].map(row => (
            <div key={row.label} className={`flex justify-between p-3 rounded-lg ${row.muted ? "bg-muted/20" : "bg-muted/40"}`}>
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium">{row.value}</span>
            </div>
          ))}
        </div>
        <div className={`flex justify-between items-center p-4 rounded-lg border-2 text-sm font-semibold ${profit >= 0 ? "border-green-500/40 bg-green-50 dark:bg-green-950/20" : "border-red-500/40 bg-red-50 dark:bg-red-950/20"}`}>
          <span className={profit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
            {profit >= 0 ? "Lucro Estimado" : "Prejuízo Estimado"}
          </span>
          <div className="text-right">
            <span className={`text-lg ${profit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{formatCurrency(Math.abs(profit))}</span>
            <span className="ml-2 text-xs text-muted-foreground">({marginPct}% margem)</span>
          </div>
        </div>
      </div>

      {tripId && (
        <div className="flex justify-end">
          <Button onClick={handleSaveCosts} disabled={isSavingCosts || isPending} className="gap-2">
            {isSavingCosts
              ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando Custos...</>
              : <><Check className="w-4 h-4" />Salvar Custos</>}
          </Button>
        </div>
      )}
    </>
  );
}
