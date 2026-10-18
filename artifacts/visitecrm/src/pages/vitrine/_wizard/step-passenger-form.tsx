import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { User, Users, Info, AlertTriangle, Plus, Trash2 } from "lucide-react";
import type { WizardState } from "./use-wizard-state";
import { validateCpf, validatePhone } from "@/lib/utils";

export function StepPassengerForm({ state }: { state: WizardState }) {
  const {
    form,
    set,
    qty,
    isSoldOut,
    maxSeats,
    product,
    coPassengers,
    setCoPassenger,
    addChild,
    removeChild,
    lapChildCount,
  } = state;
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

        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Label className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-muted-foreground" />
                Crianças adicionais
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Você já está incluído como passageiro principal.
              </p>
            </div>
            <button
              type="button"
              onClick={addChild}
              disabled={isSoldOut}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Incluir criança
            </button>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3 text-sm">
            <p className="font-medium">
              {qty} poltrona{qty === 1 ? "" : "s"} com passagem
              {lapChildCount > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" "}· {lapChildCount} criança{lapChildCount === 1 ? "" : "s"} no colo, sem cobrança
                </span>
              )}
            </p>
            {product?.availableSeats != null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                {maxSeats} vaga{maxSeats !== 1 ? "s" : ""} disponível{maxSeats !== 1 ? "is" : ""}
              </p>
            )}
          </div>

          {qty > maxSeats && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Há mais passageiros com assento do que vagas disponíveis. Crianças menores de 7 anos podem viajar no colo.
            </p>
          )}
          {isSoldOut && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              Produto esgotado
            </p>
          )}

          {coPassengers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhuma criança adicionada.
            </p>
          ) : (
            <div className="space-y-3">
              {coPassengers.map((co, i) => (
                <div key={i} className="space-y-4 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Criança {i + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeChild(i)}
                      aria-label={`Remover criança ${i + 1}`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`co-name-${i}`}>
                      Nome completo <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id={`co-name-${i}`}
                      value={co.name}
                      onChange={(e) => setCoPassenger(i, "name", e.target.value)}
                      placeholder="Nome da criança"
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

                  <div className="border-t pt-3">
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={co.isChildUnder7}
                        onChange={(e) => setCoPassenger(i, "isChildUnder7", e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span>
                        Criança menor de 7 anos
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          A partir dos 7 anos, a poltrona e a passagem são obrigatórias.
                        </span>
                      </span>
                    </label>
                    {co.isChildUnder7 ? (
                      <fieldset className="mt-3 space-y-2 pl-6">
                        <legend className="text-xs font-medium text-muted-foreground">
                          Como a criança vai viajar?
                        </legend>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={`child-seat-${i}`}
                            checked={co.occupiesSeat}
                            onChange={() => setCoPassenger(i, "occupiesSeat", true)}
                            className="h-4 w-4 accent-primary"
                          />
                          Ocupa poltrona — passagem paga
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={`child-seat-${i}`}
                            checked={!co.occupiesSeat}
                            onChange={() => setCoPassenger(i, "occupiesSeat", false)}
                            className="h-4 w-4 accent-primary"
                          />
                          Vai no colo — gratuito, sem poltrona
                        </label>
                      </fieldset>
                    ) : (
                      <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                        Poltrona obrigatória. A passagem será incluída no total.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
