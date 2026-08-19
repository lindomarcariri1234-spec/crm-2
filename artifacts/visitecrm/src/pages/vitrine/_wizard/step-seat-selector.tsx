import { Armchair, Info, Loader2, Users } from "lucide-react";
import { PublicStore } from "@/lib/storeApi";
import { PublicLayoutSeatPicker, SeatGrid } from "./seat-pickers";
import type { WizardState } from "./use-wizard-state";

export function StepSeatSelector({ state, store }: { state: WizardState; store: PublicStore }) {
  const {
    product,
    qty,
    showSeatGrid,
    loadingLayoutMap,
    liveLayoutSeatMap,
    layoutSeats,
    toggleLayoutSeat,
    selectedSeats,
    toggleSeat,
    occupiedSeats,
    unitPrice,
    effectiveSeats,
  } = state;

  if (!product) return null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Armchair className="w-5 h-5 text-primary" />
          Seleção de Assentos{" "}
          <span className="text-sm font-normal text-muted-foreground">* (obrigatório)</span>
        </h2>
      </div>

      {showSeatGrid && product.totalCapacity ? (
        <>
          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Selecione <strong>{qty}</strong> assento{qty !== 1 ? "s" : ""} para sua viagem. Os
              assentos em VERMELHO já estão ocupados.
            </span>
          </div>

          {loadingLayoutMap ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando mapa de assentos…
            </div>
          ) : liveLayoutSeatMap ? (
            <PublicLayoutSeatPicker
              seats={liveLayoutSeatMap.seats}
              totalSeats={liveLayoutSeatMap.totalSeats}
              layout={liveLayoutSeatMap.layout}
              floors={liveLayoutSeatMap.floors}
              qty={qty}
              selected={layoutSeats}
              onToggle={toggleLayoutSeat}
              accentColor={store?.accentColor || store?.primaryColor}
              pricePerPerson={unitPrice}
              numberingType={liveLayoutSeatMap.numberingType}
            />
          ) : (
            <SeatGrid
              totalCapacity={product.totalCapacity}
              occupiedSeats={occupiedSeats}
              qty={qty}
              selected={selectedSeats}
              onToggle={toggleSeat}
              accentColor={store?.accentColor || store?.primaryColor}
            />
          )}

          <div className="border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Assentos Selecionados</p>
                <div className="flex flex-wrap gap-1.5">
                  {effectiveSeats.length > 0 ? (
                    effectiveSeats.map((s) => (
                      <span
                        key={s}
                        className="px-2.5 py-1 rounded-full text-white text-xs font-semibold"
                        style={{ backgroundColor: store.accentColor || store.primaryColor }}
                      >
                        Assento {s}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum assento selecionado</p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="text-xs text-muted-foreground">Progresso</p>
                <p
                  className="text-2xl font-bold"
                  style={{ color: store.accentColor || store.primaryColor }}
                >
                  {effectiveSeats.length} / {qty}
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="p-6 border-2 border-dashed border-primary/30 rounded-xl text-center bg-primary/5">
            <Armchair className="w-12 h-12 text-primary/50 mx-auto mb-3" />
            <p className="text-lg font-semibold mb-1">
              {qty} vaga{qty !== 1 ? "s" : ""} reservada{qty !== 1 ? "s" : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              Os assentos serão designados pelo motorista no embarque.
            </p>
            {product.availableSeats != null && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-white border rounded-full px-3 py-1">
                <Users className="w-3 h-3" />
                {product.availableSeats} vagas disponíveis
              </div>
            )}
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <p className="font-semibold mb-1">Ponto de embarque</p>
            {product.destination ? (
              <p>Destino: {product.destination}</p>
            ) : (
              <p>O ponto de embarque será informado por e-mail após a confirmação.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
