import { Button } from "@/components/ui/button";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Ticket,
} from "lucide-react";
import { PublicStore } from "@/lib/storeApi";
import { TRIP_TYPE_LABELS } from "@/lib/labels";
import { useWizardState } from "./_wizard/use-wizard-state";
import { StepIndicator } from "./_wizard/step-indicator";
import { STEPS } from "./_wizard/constants";
import { StepPassengerForm } from "./_wizard/step-passenger-form";
import { StepReview } from "./_wizard/step-review";
import { StepSeatSelector } from "./_wizard/step-seat-selector";
import { StepPayment } from "./_wizard/step-payment";
import { StepConfirmation } from "./_wizard/step-confirmation";

export default function ReservationWizard({
  slug,
  productSlug,
  store,
}: {
  slug: string;
  productSlug: string;
  store: PublicStore;
}) {
  const state = useWizardState({ slug, productSlug, store });
  const visibleSteps = (state.product?.showSeatMap === false || store.seatMapEnabled === false)
    ? STEPS.filter(s => s.key !== "assento")
    : STEPS;
  const {
    product,
    loadingProduct,
    notFound,
    step,
    submitting,
    completedOrder,
    canProceedFromDados,
    canProceedFromRevisao,
    canProceedFromAssento,
    canProceedFromPagamento,
    submit,
    goNext,
    goBack,
    navigate,
  } = state;

  if (loadingProduct) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">Produto não encontrado</h2>
        <Button variant="outline" onClick={() => navigate(`/loja/${slug}/produtos`)}>
          Ver Catálogo
        </Button>
      </div>
    );
  }

  if (step === "confirmado" && completedOrder) {
    return <StepConfirmation state={state} store={store} slug={slug} />;
  }

  const hasSidebar = step === "revisao" || step === "pagamento";

  return (
    <div className={`mx-auto px-4 py-10 pb-24 ${hasSidebar ? "max-w-5xl" : "max-w-2xl"}`}>
      <div className="flex items-center gap-2 mb-6 print:hidden">
        <button
          onClick={goBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {step === "dados" ? "Voltar ao Produto" : "Voltar"}
        </button>
      </div>

      <h1 className="text-2xl font-bold mb-2 print:hidden">Reservar Viagem</h1>
      <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
        <p className="text-muted-foreground text-sm">{product.name}</p>
        {product.tripType && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {TRIP_TYPE_LABELS[product.tripType] ?? product.tripType}
          </span>
        )}
      </div>

      <StepIndicator current={step} steps={visibleSteps} />

      {step === "dados" && <StepPassengerForm state={state} />}
      {step === "revisao" && <StepReview state={state} store={store} />}
      {step === "assento" && <StepSeatSelector state={state} store={store} />}
      {step === "pagamento" && <StepPayment state={state} store={store} />}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === "dados" ? "Cancelar" : "Voltar"}
          </button>

          {step !== "pagamento" ? (
            <Button
              onClick={goNext}
              disabled={
                (step === "dados" && !canProceedFromDados()) ||
                (step === "revisao" && !canProceedFromRevisao()) ||
                (step === "assento" && !canProceedFromAssento())
              }
              style={{ backgroundColor: store.primaryColor }}
              className="text-white font-semibold px-8 flex items-center gap-2"
            >
              Continuar
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={submitting || !canProceedFromPagamento()}
              style={{ backgroundColor: store.accentColor || store.primaryColor }}
              className="text-white font-bold px-8 flex items-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Ticket className="w-4 h-4" />
              )}
              Confirmar Reserva
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
