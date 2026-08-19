import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUpdatePassengerBoarding, useUpdatePassenger } from "@workspace/api-client-react";
import type { BoardingPassenger } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageSquare, Phone, UserPen } from "lucide-react";
import { DOCUMENT_TYPES } from "./constants";

const PLACEHOLDER_NAME = "A preencher";

export function PassengerObsModal({ passenger, tripId, open, onClose, onSaved }: {
  passenger: BoardingPassenger | null;
  tripId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const updateBoarding = useUpdatePassengerBoarding();
  const updatePassenger = useUpdatePassenger();
  const [form, setForm] = useState({ passengerPhone: "", documentType: "", specialNeeds: "", observations: "" });
  const [infoForm, setInfoForm] = useState({ name: "", cpf: "", rg: "", birthDate: "" });
  const [saving, setSaving] = useState(false);

  const isPlaceholder = passenger?.name === PLACEHOLDER_NAME;

  useEffect(() => {
    if (passenger) {
      setForm({
        passengerPhone: passenger.passengerPhone ?? "",
        documentType: passenger.documentType ?? "",
        specialNeeds: passenger.specialNeeds ?? "",
        observations: passenger.observations ?? "",
      });
      setInfoForm({
        name: passenger.name === PLACEHOLDER_NAME ? "" : (passenger.name ?? ""),
        cpf: passenger.cpf ?? "",
        rg: "",
        birthDate: passenger.birthDate ? passenger.birthDate.split("T")[0] : "",
      });
    }
  }, [passenger]);

  const handleSave = async () => {
    if (!passenger) return;
    setSaving(true);
    try {
      const boardingPromise = updateBoarding.mutateAsync({
        tripId,
        passengerId: passenger.id,
        data: {
          passengerPhone: form.passengerPhone || null,
          documentType: form.documentType || null,
          specialNeeds: form.specialNeeds || null,
          observations: form.observations || null,
        },
      });

      if (isPlaceholder && infoForm.name.trim()) {
        await updatePassenger.mutateAsync({
          reservationId: passenger.reservationId,
          id: passenger.id,
          data: {
            name: infoForm.name.trim() || null,
            cpf: infoForm.cpf.trim() || null,
            rg: infoForm.rg.trim() || null,
            birthDate: infoForm.birthDate || null,
          },
        });
      }

      await boardingPromise;
      onSaved();
      onClose();
    } catch {
      toast({ title: "Erro ao salvar dados do passageiro", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPlaceholder
              ? <><UserPen className="w-4 h-4 text-amber-600" />Preencher Dados do Passageiro</>
              : <><MessageSquare className="w-4 h-4 text-primary" />Informações do Passageiro</>
            }
          </DialogTitle>
        </DialogHeader>
        {passenger && (
          <div className="space-y-4 py-1">
            {isPlaceholder ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 font-medium">
                Passageiro ainda não identificado — preencha os dados abaixo.
              </div>
            ) : (
              <div className="bg-muted/50 rounded p-2 text-sm font-medium">{passenger.name}</div>
            )}

            {isPlaceholder && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold text-foreground">Dados de identificação</p>
                <div className="space-y-1">
                  <Label htmlFor="info-name" className="text-xs">Nome completo *</Label>
                  <Input id="info-name" placeholder="Nome do passageiro" value={infoForm.name}
                    onChange={e => setInfoForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="info-cpf" className="text-xs">CPF</Label>
                    <Input id="info-cpf" placeholder="000.000.000-00" value={infoForm.cpf}
                      onChange={e => setInfoForm(f => ({ ...f, cpf: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="info-rg" className="text-xs">RG</Label>
                    <Input id="info-rg" placeholder="0000000" value={infoForm.rg}
                      onChange={e => setInfoForm(f => ({ ...f, rg: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="info-birth" className="text-xs">Data de nascimento</Label>
                  <Input id="info-birth" type="date" value={infoForm.birthDate}
                    onChange={e => setInfoForm(f => ({ ...f, birthDate: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="obs-phone" className="text-xs">Telefone do passageiro</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input id="obs-phone" placeholder="(00) 00000-0000" value={form.passengerPhone} className="pl-8"
                  onChange={e => setForm(f => ({ ...f, passengerPhone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs-doctype" className="text-xs">Tipo de documento</Label>
              <Select value={form.documentType || "__none__"} onValueChange={v => setForm(f => ({ ...f, documentType: v === "__none__" ? "" : v }))}>
                <SelectTrigger id="obs-doctype"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Não informado —</SelectItem>
                  {DOCUMENT_TYPES.map(dt => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs-special" className="text-xs">Necessidades especiais</Label>
              <Input id="obs-special" placeholder="Ex: cadeirante, gestante, alergia..." value={form.specialNeeds}
                onChange={e => setForm(f => ({ ...f, specialNeeds: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs-notes" className="text-xs">Observações gerais</Label>
              <Textarea id="obs-notes" placeholder="Anotações, restrições alimentares, medicamentos..." rows={3} value={form.observations}
                onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || (isPlaceholder && !infoForm.name.trim())}>
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Salvando...</> : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
