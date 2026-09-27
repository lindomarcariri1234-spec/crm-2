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
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";

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
  const { colors } = useVitrineTheme();
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
      <div className="flex min-h-[28rem] items-center justify-center rounded-[2rem] bg-slate-50/80">
        <Loader2 className="w-9 h-9 animate-spin" style={{ color: colors.primary }} />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: colors.primarySoft, color: colors.primary }}>
          <Ticket className="h-6 w-6" />
        </div>
        <h2 className="mb-2 text-2xl font-bold tracking-tight">Produto não encontrado</h2>
        <p className="mx-auto mb-6 max-w-sm text-sm text-muted-foreground">Não encontramos essa experiência. Volte ao catálogo para escolher outra viagem.</p>
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
    <div className={`mx-auto px-4 py-7 pb-28 sm:py-10 sm:pb-28 ${hasSidebar ? "max-w-6xl" : "max-w-3xl"}`}>
      <div className="mb-7 flex items-center gap-2 print:hidden">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
          {step === "dados" ? "Voltar ao Produto" : "Voltar"}
        </button>
      </div>

      <div className="mb-7 print:hidden">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: colors.primary }}>Sua próxima experiência</p>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Reservar Viagem</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{product.name}</p>
        {product.tripType && (
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: colors.primarySoft, color: colors.primary }}>
            {TRIP_TYPE_LABELS[product.tripType] ?? product.tripType}
          </span>
        )}
        </div>
      </div>

      <StepIndicator current={step} steps={visibleSteps} />

      {step === "dados" && <StepPassengerForm state={state} />}
      {step === "revisao" && <StepReview state={state} store={store} />}
      {step === "assento" && <StepSeatSelector state={state} store={store} />}
      {step === "pagamento" && <StepPayment state={state} store={store} />}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 bg-white/95 shadow-[0_-12px_35px_rgba(15,23,42,0.10)] backdrop-blur print:hidden">
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
               style={{ backgroundColor: colors.primary, color: colors.primaryForeground }}
               className="flex items-center gap-2 rounded-xl px-8 font-semibold"
            >
              Continuar
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={submitting || !canProceedFromPagamento()}
               style={{ backgroundColor: colors.accent, color: colors.accentForeground }}
               className="flex items-center gap-2 rounded-xl px-8 font-bold"
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
