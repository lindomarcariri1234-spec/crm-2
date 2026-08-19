import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { User, Users, Info, AlertTriangle } from "lucide-react";
import type { WizardState } from "./use-wizard-state";
import { validateCpf, validatePhone } from "@/lib/utils";

export function StepPassengerForm({ state }: { state: WizardState }) {
  const { form, set, qty, changeQty, isSoldOut, maxSeats, passengerOptions, product, coPassengers, setCoPassenger } = state;
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <User className="w-5 h-5 text-primary" />
        Seus Dados
      </h2>
      <div className="border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-1">
            <Label htmlFor="name">
              Nome Completo <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={form.customerName}
              onChange={(e) => set("customerName", e.target.value)}
              placeholder="Seu nome completo"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">
              E-mail <span className="text-red-500">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              value={form.customerEmail}
              onChange={(e) => set("customerEmail", e.target.value)}
              placeholder="seu@email.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">
              WhatsApp / Telefone <span className="text-red-500">*</span>
            </Label>
            <Input
              id="phone"
              value={form.customerPhone}
              onChange={(e) => set("customerPhone", e.target.value)}
              placeholder="(11) 99999-9999"
              className={
                form.customerPhone.length > 0 && !validatePhone(form.customerPhone)
                  ? "border-red-400 focus-visible:ring-red-400"
                  : ""
              }
            />
            {form.customerPhone.length > 0 && !validatePhone(form.customerPhone) && (
              <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Telefone inválido. Use o formato (XX) 99999-9999
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cpf">
              CPF <span className="text-red-500">*</span>
            </Label>
            <Input
              id="cpf"
              value={form.customerCpf}
              onChange={(e) =>
                set(
                  "customerCpf",
                  e.target.value
                    .replace(/\D/g, "")
                    .replace(/(\d{3})(\d)/, "$1.$2")
                    .replace(/(\d{3})(\d)/, "$1.$2")
                    .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
                    .slice(0, 14),
                )
              }
              placeholder="000.000.000-00"
              maxLength={14}
              className={
                form.customerCpf.length > 0 && !validateCpf(form.customerCpf)
                  ? "border-red-400 focus-visible:ring-red-400"
                  : ""
              }
            />
            {form.customerCpf.length > 0 && !validateCpf(form.customerCpf) && (
              <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                CPF inválido
              </p>
            )}
          </div>
        </div>

        <div className="border-t pt-4">
          <Label className="flex items-center gap-1.5 mb-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            Quantidade de Passageiros <span className="text-red-500">*</span>
          </Label>
          <select
            value={qty}
            onChange={(e) => changeQty(Number(e.target.value))}
            disabled={isSoldOut}
            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-white"
          >
            {passengerOptions.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "passageiro" : "passageiros"}
              </option>
            ))}
          </select>
          {product?.availableSeats != null && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              {maxSeats} vaga{maxSeats !== 1 ? "s" : ""} disponível{maxSeats !== 1 ? "is" : ""}
            </p>
          )}
          {isSoldOut && (
            <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Produto esgotado
            </p>
          )}
        </div>

        {qty > 1 && (
          <div className="border-t pt-4 space-y-4">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" />
              Dados dos demais passageiros
            </p>
            <p className="text-xs text-muted-foreground -mt-2">
              Informe o nome de cada acompanhante. CPF e telefone são opcionais mas agilizam o embarque.
            </p>
            {Array.from({ length: qty - 1 }, (_, i) => {
              const co = coPassengers[i] ?? { name: "", cpf: "", phone: "" };
              return (
                <div key={i} className="border rounded-xl p-4 space-y-3 bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Passageiro {i + 2}
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor={`co-name-${i}`}>
                      Nome Completo <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id={`co-name-${i}`}
                      value={co.name}
                      onChange={(e) => setCoPassenger(i, "name", e.target.value)}
                      placeholder="Nome do passageiro"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`co-cpf-${i}`} className="text-muted-foreground">
                        CPF <span className="text-xs font-normal">(opcional)</span>
                      </Label>
                      <Input
                        id={`co-cpf-${i}`}
                        value={co.cpf}
                        onChange={(e) =>
                          setCoPassenger(
                            i,
                            "cpf",
                            e.target.value
                              .replace(/\D/g, "")
                              .replace(/(\d{3})(\d)/, "$1.$2")
                              .replace(/(\d{3})(\d)/, "$1.$2")
                              .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
                              .slice(0, 14),
                          )
                        }
                        placeholder="000.000.000-00"
                        maxLength={14}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`co-phone-${i}`} className="text-muted-foreground">
                        Telefone <span className="text-xs font-normal">(opcional)</span>
                      </Label>
                      <Input
                        id={`co-phone-${i}`}
                        value={co.phone}
                        onChange={(e) => setCoPassenger(i, "phone", e.target.value)}
                        placeholder="(11) 99999-9999"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t pt-4 space-y-1">
          <Label htmlFor="notes">Observações</Label>
          <Textarea
            id="notes"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Restrições alimentares, necessidades especiais, etc."
            rows={3}
          />
        </div>
      </div>
    </div>
  );
}
