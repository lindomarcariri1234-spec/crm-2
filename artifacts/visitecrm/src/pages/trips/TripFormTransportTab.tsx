import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, Plus, X, AlertTriangle } from "lucide-react";
import { VEHICLE_TYPES } from "./constants";
import type { TripFormData, FreePassengerFormItem } from "./types";
import { newFreePassenger } from "./types";

interface TripFormTransportTabProps {
  form: TripFormData;
  setForm: Dispatch<SetStateAction<TripFormData>>;
  conflictingSeats?: string[];
  seatConflictMessage?: string | null;
}

const FREE_PASSENGER_ROLES: { value: FreePassengerFormItem["role"]; label: string }[] = [
  { value: "organizer", label: "Organizador(a)" },
  { value: "guide", label: "Guia" },
];

export function TripFormTransportTab({ form, setForm, conflictingSeats = [], seatConflictMessage }: TripFormTransportTabProps) {
  const set = (k: keyof TripFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: keyof TripFormData) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const updateFP = (id: string, patch: Partial<FreePassengerFormItem>) =>
    setForm(prev => ({ ...prev, freePassengers: prev.freePassengers.map(fp => fp.id === id ? { ...fp, ...patch } : fp) }));

  const removeFP = (id: string) =>
    setForm(prev => ({ ...prev, freePassengers: prev.freePassengers.filter(fp => fp.id !== id) }));

  const addFP = () =>
    setForm(prev => ({ ...prev, freePassengers: [...prev.freePassengers, newFreePassenger()] }));

  return (
    <>
      {(form.originCity || form.originState || form.departureTime || form.returnTime) && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">Origem e Horários</h3>
          <div className="flex flex-wrap gap-4 text-sm text-blue-700 dark:text-blue-300">
            {(form.originCity || form.originState) && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                <span>Saída de <strong>{[form.originCity, form.originState].filter(Boolean).join(", ")}</strong></span>
              </div>
            )}
            {form.departureTime && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>Saída: <strong>{form.departureTime}</strong></span>
              </div>
            )}
            {form.returnTime && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>Retorno: <strong>{form.returnTime}</strong></span>
              </div>
            )}
          </div>
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-2">Esses campos podem ser editados na aba "Básico".</p>
        </div>
      )}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">Veículo</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Tipo de Veículo</Label>
            <Select value={form.vehicleType || "none"} onValueChange={v => setVal("vehicleType")(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não definido</SelectItem>
                {VEHICLE_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Placa do Veículo</Label>
            <Input placeholder="ABC-1234" value={form.vehiclePlate} onChange={set("vehiclePlate")} />
          </div>
        </div>
      </div>
      <div className="bg-card border rounded-lg p-6 space-y-5">
        <h3 className="font-semibold">Tripulação Completa</h3>
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Motorista 1</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do Motorista</Label>
              <Input placeholder="João da Silva" value={form.driverName} onChange={set("driverName")} />
            </div>
            <div className="space-y-2">
              <Label>CPF do Motorista</Label>
              <Input placeholder="000.000.000-00" value={form.driver1Cpf} onChange={set("driver1Cpf")} />
            </div>
            <div className="space-y-2">
              <Label>Nº CNH</Label>
              <Input placeholder="00000000000" value={form.driver1Cnh} onChange={set("driver1Cnh")} />
            </div>
            <div className="space-y-2">
              <Label>Categoria CNH</Label>
              <Select value={form.driver1CnhCategory || "none"} onValueChange={v => setVal("driver1CnhCategory")(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {["D", "E"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Validade CNH</Label>
              <Input type="date" value={form.driver1CnhExpiry} onChange={set("driver1CnhExpiry")} />
            </div>
          </div>
        </div>
        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Motorista 2 (opcional)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Nome do 2º motorista" value={form.driver2Name} onChange={set("driver2Name")} />
            </div>
            <div className="space-y-2">
              <Label>CPF</Label>
              <Input placeholder="000.000.000-00" value={form.driver2Cpf} onChange={set("driver2Cpf")} />
            </div>
            <div className="space-y-2">
              <Label>Nº CNH</Label>
              <Input placeholder="00000000000" value={form.driver2Cnh} onChange={set("driver2Cnh")} />
            </div>
            <div className="space-y-2">
              <Label>Categoria CNH</Label>
              <Select value={form.driver2CnhCategory || "none"} onValueChange={v => setVal("driver2CnhCategory")(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {["D", "E"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Validade CNH</Label>
              <Input type="date" value={form.driver2CnhExpiry} onChange={set("driver2CnhExpiry")} />
            </div>
          </div>
        </div>
        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Guia de Turismo</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome do Guia</Label>
              <Input placeholder="Maria Costa" value={form.tourGuide} onChange={set("tourGuide")} />
            </div>
            <div className="space-y-2">
              <Label>CPF do Guia</Label>
              <Input placeholder="000.000.000-00" value={form.tourGuideCpf} onChange={set("tourGuideCpf")} />
            </div>
            <div className="space-y-2">
              <Label>Nº Registro CADASTUR</Label>
              <Input placeholder="00000/00" value={form.tourGuideRegistration} onChange={set("tourGuideRegistration")} />
            </div>
          </div>
        </div>
        <div className="border-t pt-4">
          <div className="space-y-2">
            <Label>Responsável da Viagem</Label>
            <Input placeholder="Nome do responsável" value={form.tripOrganizer} onChange={set("tripOrganizer")} />
          </div>
        </div>
      </div>

      {/* Passageiros Gratuitos (Gratuidades) */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Passageiros Gratuitos</h3>
            <p className="text-sm text-muted-foreground">Organizadores e guias que viajam com assento reservado sem custo.</p>
          </div>
          <Button size="sm" variant="outline" type="button" onClick={addFP}>
            <Plus className="w-4 h-4 mr-1" />Adicionar
          </Button>
        </div>

        {seatConflictMessage && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{seatConflictMessage}</p>
          </div>
        )}

        {form.freePassengers.length === 0 ? (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
            Nenhum passageiro gratuito cadastrado. Clique em "Adicionar" para incluir organizadores ou guias com assento reservado.
          </p>
        ) : (
          <div className="space-y-4">
            {form.freePassengers.map((fp, idx) => {
              const isConflicting = fp.seatNumber.trim() !== "" && conflictingSeats.includes(fp.seatNumber.trim());
              const normalizedSeatNumber = fp.seatNumber.trim();
              const isDuplicateFreePassengerSeat = normalizedSeatNumber !== "" && form.freePassengers.some(
                other => other.id !== fp.id && other.seatNumber.trim() === normalizedSeatNumber,
              );
              const hasSeatError = isConflicting || isDuplicateFreePassengerSeat;
              return (
                <div key={fp.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Passageiro gratuito {idx + 1}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      type="button"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeFP(fp.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Nome completo</Label>
                      <Input
                        placeholder="Nome do passageiro"
                        value={fp.name}
                        onChange={e => updateFP(fp.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">CPF</Label>
                      <Input
                        placeholder="000.000.000-00"
                        value={fp.cpf}
                        onChange={e => updateFP(fp.id, { cpf: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">WhatsApp</Label>
                      <Input
                        placeholder="(11) 99999-9999"
                        value={fp.whatsapp}
                        onChange={e => updateFP(fp.id, { whatsapp: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Função</Label>
                      <Select
                        value={fp.role}
                        onValueChange={v => updateFP(fp.id, { role: v as FreePassengerFormItem["role"] })}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FREE_PASSENGER_ROLES.map(r => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nº do Assento</Label>
                      <Input
                        placeholder="Ex: 12"
                        value={fp.seatNumber}
                        onChange={e => updateFP(fp.id, { seatNumber: e.target.value })}
                        className={hasSeatError ? "border-destructive ring-1 ring-destructive focus-visible:ring-destructive" : ""}
                      />
                      {isConflicting && (
                        <p className="text-xs text-destructive font-medium">
                          Assento {fp.seatNumber} já está ocupado por uma reserva ativa.
                        </p>
                      )}
                      {!isConflicting && isDuplicateFreePassengerSeat && (
                        <p className="text-xs text-destructive font-medium">
                          Assento {fp.seatNumber} já está atribuído a outro passageiro gratuito.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">Hospedagem</h3>
        <p className="text-sm text-muted-foreground">Integração com cadastro de hospedagens disponível em módulo futuro.</p>
      </div>
    </>
  );
}
