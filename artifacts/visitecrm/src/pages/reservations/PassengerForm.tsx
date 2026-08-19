import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AGE_CATEGORY_LABELS } from "./constants";

interface PassengerFormProps {
  defaultValues?: { name?: string; cpf?: string; rg?: string; birthDate?: string; ageCategory?: string; seatNumber?: string };
  onSubmit: (fd: FormData, ageCategory: string) => Promise<void>;
  onCancel: () => void;
  isPending: boolean;
  isEdit?: boolean;
}

export function PassengerForm({ defaultValues, onSubmit, onCancel, isPending, isEdit }: PassengerFormProps) {
  const [ageCategory, setAgeCategory] = useState(defaultValues?.ageCategory ?? "adult");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSubmit(new FormData(e.currentTarget), ageCategory);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label className="text-sm font-medium">Nome completo *</label>
          <Input name="name" required defaultValue={defaultValues?.name ?? ""} placeholder="Nome do passageiro" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">CPF</label>
          <Input name="cpf" defaultValue={defaultValues?.cpf ?? ""} placeholder="000.000.000-00" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">RG</label>
          <Input name="rg" defaultValue={defaultValues?.rg ?? ""} placeholder="0000000" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Data de Nascimento</label>
          <Input name="birthDate" type="date" defaultValue={defaultValues?.birthDate?.slice(0, 10) ?? ""} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Assento</label>
          <Input name="seatNumber" defaultValue={defaultValues?.seatNumber ?? ""} placeholder="Ex: 12" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-sm font-medium">Categoria de Idade *</label>
          <Select value={ageCategory} onValueChange={setAgeCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(AGE_CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando..." : isEdit ? "Salvar Alterações" : "Adicionar Passageiro"}
        </Button>
      </div>
    </form>
  );
}
