import type { CommissionRule } from "@workspace/api-client-react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

type CommissionRulesTabProps = {
  rules: CommissionRule[];
  isLoading: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (rule: CommissionRule) => void;
  onDelete: (ruleId: string) => void;
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

export function CommissionRulesTab({
  rules,
  isLoading,
  canCreate,
  canEdit,
  canDelete,
  onCreate,
  onEdit,
  onDelete,
}: CommissionRulesTabProps) {
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={onCreate}>
            <Plus className="w-4 h-4 mr-2" /> Nova Regra
          </Button>
        </div>
      )}
      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Aplica a</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma regra de comissão cadastrada.</TableCell></TableRow>
            ) : rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium text-sm">{rule.name}</TableCell>
                <TableCell className="text-sm">{rule.type === "percentage" ? "Percentual" : "Fixo"}</TableCell>
                <TableCell className="text-sm font-medium">
                  {rule.type === "percentage" ? `${rule.value}%` : fmt(rule.value)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{rule.appliesTo}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                    {rule.isActive ? "Ativa" : "Inativa"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(rule)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void onDelete(rule.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}