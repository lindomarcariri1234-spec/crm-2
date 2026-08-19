import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ClipboardList, AlertTriangle, Users, Armchair, Calendar, MapPin, Clock, Bus } from "lucide-react";
import { PublicStore } from "@/lib/storeApi";
import { ProductCard } from "./product-card";
import { StepCouponReferral } from "./coupon-referral";
import { StepPaymentSummary } from "./payment-summary";
import { fmtDate } from "./constants";
import type { WizardState } from "./use-wizard-state";

export function StepReview({ state, store }: { state: WizardState; store: PublicStore }) {
  const {
    product,
    basePrice,
    selectedVariant,
    setSelectedVariant,
    isSoldOut,
    qty,
    maxSeats,
    incrementQty,
    decrementQty,
    form,
    set,
    partnerInfo,
    selectedBoardingPointId,
    setSelectedBoardingPointId,
  } = state;
  if (!product) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          Revisão do Pedido
        </h2>

        <ProductCard product={product} store={store} />

        {product.hasVariants && (product.variants ?? []).length > 0 && (
          <div className="border rounded-xl p-4 space-y-3">
            {(product.variants ?? []).map((v) => (
              <div key={v.name}>
                <Label className="text-sm font-medium mb-2 block">
                  {v.name} <span className="text-red-500">*</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {v.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() =>
                        setSelectedVariant({
                          variantName: v.name,
                          label: opt.label,
                          price: opt.price,
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                        selectedVariant?.label === opt.label
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                      {opt.price !== basePrice && (
                        <span className="ml-1 text-xs opacity-70">(R$ {opt.price.toFixed(2)})</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!selectedVariant && (
              <p className="text-xs text-amber-600">Selecione uma opção para continuar</p>
            )}
          </div>
        )}

        {isSoldOut && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Este produto está esgotado e não pode ser reservado no momento.
          </div>
        )}

        <div
          className={`flex items-center justify-between p-4 border rounded-xl ${
            isSoldOut ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Quantidade de passageiros</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={decrementQty}
              className="w-8 h-8 rounded-full border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors"
              disabled={qty <= 1}
            >
              −
            </button>
            <span className="w-8 text-center font-bold text-lg">{qty}</span>
            <button
              onClick={incrementQty}
              className="w-8 h-8 rounded-full border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors"
              disabled={qty >= maxSeats}
            >
              +
            </button>
          </div>
        </div>

        {product.showSeatMap === false && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <Armchair className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {qty > 1
                ? "Seus assentos serão atribuídos automaticamente após a confirmação da reserva."
                : "Seu assento será atribuído automaticamente após a confirmação da reserva."}
            </p>
          </div>
        )}

        {partnerInfo?.hasPartner && (
          <div className="border rounded-xl p-4 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {partnerInfo.type === "passeio" || partnerInfo.type === "experiencia" ? (
                <><Calendar className="w-4 h-4 text-primary" /> Data do Passeio</>
              ) : partnerInfo.type === "transfer" ? (
                <><MapPin className="w-4 h-4 text-primary" /> Detalhes do Transfer</>
              ) : (
                <><Clock className="w-4 h-4 text-primary" /> Informações do Serviço</>
              )}
            </h3>

            {(partnerInfo.type === "passeio" || partnerInfo.type === "experiencia") && (
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Data <span className="text-red-500">*</span>
                </Label>
                {(partnerInfo.availability ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {(partnerInfo.availability ?? []).map((a) => (
                      <button
                        key={a.date}
                        type="button"
                        onClick={() => set("partnerSelectedDate", a.date)}
                        className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                          form.partnerSelectedDate === a.date
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        <span className="ml-1 text-xs opacity-70">
                          ({a.spotsTotal - a.spotsUsed} vagas)
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Input
                    type="date"
                    value={form.partnerSelectedDate}
                    onChange={(e) => set("partnerSelectedDate", e.target.value)}
                    className="mt-1"
                  />
                )}
                {!form.partnerSelectedDate && (
                  <p className="text-xs text-amber-600 mt-1">Selecione uma data para continuar</p>
                )}
              </div>
            )}

            {(partnerInfo.type === "passeio" || partnerInfo.type === "experiencia") && (
              <div>
                <Label className="text-sm font-medium mb-1 block">Horário preferido</Label>
                <Input
                  type="time"
                  value={form.partnerSelectedTime}
                  onChange={(e) => set("partnerSelectedTime", e.target.value)}
                  className="w-36"
                />
                <p className="text-xs text-muted-foreground mt-1">Opcional — confirme com o parceiro</p>
              </div>
            )}

            {partnerInfo.type === "transfer" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">
                    Origem <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="De onde?"
                    value={form.partnerTransferOrigin}
                    onChange={(e) => set("partnerTransferOrigin", e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    Destino <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="Para onde?"
                    value={form.partnerTransferDestination}
                    onChange={(e) => set("partnerTransferDestination", e.target.value)}
                    className="mt-1"
                  />
                </div>
                {(!form.partnerTransferOrigin.trim() || !form.partnerTransferDestination.trim()) && (
                  <p className="text-xs text-amber-600 col-span-2">
                    Informe a origem e o destino para continuar
                  </p>
                )}
              </div>
            )}

            {partnerInfo.meetingPoint && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                Ponto de encontro: {partnerInfo.meetingPoint}
              </div>
            )}
            {partnerInfo.durationMinutes && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                Duração: {partnerInfo.durationMinutes} minutos
              </div>
            )}
            {partnerInfo.cancellationPolicy && (
              <p className="text-xs text-muted-foreground border-t pt-3">
                {partnerInfo.cancellationPolicy}
              </p>
            )}
          </div>
        )}

        {(() => {
          const bps = (product.boardingPoints ?? []).filter((bp) => bp.name);
          if (bps.length === 0) return null;
          return (
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Bus className="w-4 h-4 text-primary" /> Ponto de Embarque
              </h3>
              {bps.length === 1 ? (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-900">{bps[0].name}</p>
                    {bps[0].time && (
                      <p className="text-blue-700 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" /> {bps[0].time}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {bps.map((bp) => (
                    <button
                      key={bp.id}
                      type="button"
                      onClick={() => setSelectedBoardingPointId(selectedBoardingPointId === bp.id ? "" : bp.id)}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors text-left ${
                        selectedBoardingPointId === bp.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {bp.name}
                        {bp.time && <span className="block text-xs opacity-70">{bp.time}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        <div className="border rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold">Resumo do Passageiro</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Nome</p>
              <p className="font-medium">{form.customerName}</p>
            </div>
            {form.customerCpf && (
              <div>
                <p className="text-muted-foreground text-xs">CPF</p>
                <p className="font-medium">{form.customerCpf}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs">E-mail</p>
              <p className="font-medium">{form.customerEmail}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Telefone</p>
              <p className="font-medium">{form.customerPhone}</p>
            </div>
            {form.customerBirthdate && (
              <div>
                <p className="text-muted-foreground text-xs">Data de Nascimento</p>
                <p className="font-medium">{fmtDate(form.customerBirthdate)}</p>
              </div>
            )}
          </div>
        </div>

        <StepCouponReferral
          state={state}
          couponsEnabled={store.couponsEnabled !== false}
          referralsEnabled={store.referralsEnabled !== false}
        />
      </div>

      <div className="lg:col-span-1">
        <StepPaymentSummary state={state} store={store} variant="review" />
      </div>
    </div>
  );
}
