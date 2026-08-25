import { useState, useMemo, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useListTrips, useListClients, useListBoardingLocations, useListUsers,
  useCreateReservation, useUpdateDeal,
  useValidateReservationCoupon, useGetTrip, useGetClientLoyalty,
  useCreateClient, useGetMe,
  validateReferralCode,
  useListReservations,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { XCircle, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { RESERVATION_STATUS, ROLES } from "@workspace/permissions";
import { PAYMENT_METHOD_LABELS as PAYMENT_LABELS } from "@/lib/labels";
import { WizardStep1 } from "./WizardStep1";
import { WizardStep2 } from "./WizardStep2";
import { STATUS_LABELS } from "./constants";
import { computeReservationTotal, applyDiscounts } from "@/lib/reservationPricing";

function WizardStepIndicator({ step }: { step: number }) {
  const steps = ["Seleção", "Pagamento", "Confirmação"];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, idx) => {
        const n = idx + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${done ? "bg-primary border-primary text-primary-foreground" : active ? "border-primary text-primary bg-primary/10" : "border-muted-foreground/30 text-muted-foreground"}`}>
                {done ? "✓" : n}
              </div>
              <span className={`text-xs whitespace-nowrap ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{label}</span>
            </div>
            {idx < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 mt-[-12px] transition-colors ${done ? "bg-primary" : "bg-muted"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function NewReservationWizard({ open, onClose, onSuccess, initialTripId, initialClientId, initialAmount, dealId }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialTripId?: string;
  initialClientId?: string;
  initialAmount?: number;
  dealId?: string;
}) {
  const { data: tripsData } = useListTrips({ limit: 200 });
  const { data: clientsData } = useListClients({ limit: 300 });
  const { data: boardingRaw } = useListBoardingLocations();
  const { data: usersForWizard } = useListUsers();
  const { data: me } = useGetMe();
  const createReservation = useCreateReservation();
  const updateDeal = useUpdateDeal();
  const createClient = useCreateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [selectedTripId, setSelectedTripId] = useState(initialTripId ?? "");
  const [selectedClientId, setSelectedClientId] = useState(initialClientId ?? "");
  const [boardingLocationId, setBoardingLocationId] = useState("");
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [manualSeats, setManualSeats] = useState("");
  const [tripComboOpen, setTripComboOpen] = useState(false);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [totalValue, setTotalValue] = useState<number>(initialAmount ?? 0);
  const [paidValue, setPaidValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [installments, setInstallments] = useState(1);
  const [firstDueDate, setFirstDueDate] = useState("");
  const [hasInsurance, setHasInsurance] = useState(false);
  const [notes, setNotes] = useState("");
  const [commissionAmount, setCommissionAmount] = useState<number>(0);
  const [sellerId, setSellerId] = useState<string>("none");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; amount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [redeemLoyalty, setRedeemLoyalty] = useState(false);
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState<number>(0);
  const [loyaltyAmountApplied, setLoyaltyAmountApplied] = useState<number>(0);
  const [referralCode, setReferralCode] = useState("");
  const [referralApplied, setReferralApplied] = useState<{ id: string; code: string; amount: number } | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [discountsOpen, setDiscountsOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  const [overlapAcknowledged, setOverlapAcknowledged] = useState(false);

  useEffect(() => {
    if (me?.role === ROLES.SALES && sellerId === "none") setSellerId(me.id);
  }, [me?.id, me?.role, sellerId]);

  const [clientSearch, setClientSearch] = useState("");
  const [pendingClient, setPendingClient] = useState<{ id: string; name: string; whatsapp?: string | null } | null>(null);

  const cpfClean = useMemo(() => clientSearch.replace(/\D/g, ""), [clientSearch]);
  const isCpfMode = cpfClean.length === 11;

  const {
    data: nameSearchData,
    isLoading: nameSearchLoading,
  } = useListClients(
    { search: clientSearch.trim() || undefined, limit: 20 },
    { query: { queryKey: ["client-name-search", clientSearch.trim()], enabled: !!clientSearch.trim() && !isCpfMode } }
  );
  const nameSearchResults = nameSearchData?.data ?? [];
  const [showNewClientDialog, setShowNewClientDialog] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientWhatsapp, setNewClientWhatsapp] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientError, setNewClientError] = useState<string | null>(null);

  const { data: cpfData, isLoading: cpfSearchLoading } = useListClients(
    { cpf: cpfClean, limit: 5 },
    { query: { queryKey: ["cpf-client-search", cpfClean], enabled: isCpfMode } }
  );
  const cpfMatches = cpfData?.data ?? [];

  const validateCoupon = useValidateReservationCoupon();
  const { data: selectedTripFull } = useGetTrip(selectedTripId, { query: { queryKey: ["wizard-trip", selectedTripId], enabled: !!selectedTripId } });
  const { data: loyaltyInfo } = useGetClientLoyalty(selectedClientId, { query: { queryKey: ["wizard-loyalty", selectedClientId], enabled: !!selectedClientId, retry: false } });

  const { data: dupCheckData } = useListReservations(
    { tripId: selectedTripId, clientId: selectedClientId, limit: 10 },
    { query: { queryKey: ["dup-check", selectedTripId, selectedClientId], enabled: !!selectedTripId && !!selectedClientId } }
  );
  const duplicateReservations = (dupCheckData?.data ?? []).filter(
    r => r.status !== RESERVATION_STATUS.CANCELLED && r.status !== RESERVATION_STATUS.REFUNDED
  );

  // Cross-trip date-overlap: same client already booked on a DIFFERENT trip with overlapping dates.
  // Fail-closed: while loading or on error, treat as "unknown" and block step advance.
  type ConflictingTrip = { reservationId: string; reservationNumber: string | null; tripId: string; tripName: string; departureDate: string; returnDate: string | null };
  const overlapEnabled = !!selectedTripId && !!selectedClientId;
  const {
    data: overlapData,
    isFetching: overlapFetching,
    isError: overlapError,
  } = useQuery<{ data: ConflictingTrip[] }>({
    queryKey: ["trip-overlap", selectedTripId, selectedClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ clientId: selectedClientId, tripId: selectedTripId });
      const res = await fetch(`${import.meta.env.BASE_URL}api/reservations/trip-overlap?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`overlap-check failed: ${res.status}`);
      return res.json() as Promise<{ data: ConflictingTrip[] }>;
    },
    enabled: overlapEnabled,
    retry: 1,
  });
  // While enabled but not yet resolved, or on error, block advancement (fail-closed)
  const overlapPending = overlapEnabled && (overlapFetching || (!overlapData && !overlapError));
  const overlapTrips: ConflictingTrip[] = overlapData?.data ?? [];

  const allTrips = tripsData?.data ?? [];
  const allClients = clientsData?.data ?? [];
  const selectedTrip = tripsData?.data.find(t => t.id === selectedTripId);
  const selectedClient = (() => {
    if (!selectedClientId) return undefined;
    if (pendingClient?.id === selectedClientId) return pendingClient;
    return clientsData?.data.find(c => c.id === selectedClientId);
  })();
  const selectedBoarding = (boardingRaw ?? []).find(b => b.id === boardingLocationId);

  const effectiveSeats = useMemo(() => {
    if (selectedSeats.length > 0) return selectedSeats;
    if (manualSeats.trim()) return manualSeats.split(",").map(s => s.trim()).filter(Boolean);
    return [];
  }, [selectedSeats, manualSeats]);

  useEffect(() => {
    if (selectedTripFull) setTotalValue(computeReservationTotal(selectedTripFull.priceAdult ?? 0, effectiveSeats));
  }, [selectedTripFull, effectiveSeats.length]);

  useEffect(() => {
    if (open) { setSelectedTripId(initialTripId ?? ""); setSelectedClientId(initialClientId ?? ""); setTotalValue(initialAmount ?? 0); }
  }, [open, initialTripId, initialClientId, initialAmount]);

  useEffect(() => {
    if (isCpfMode && !cpfSearchLoading && cpfMatches.length === 1 && !selectedClientId) {
      handleSelectClient(cpfMatches[0].id);
    }
  }, [isCpfMode, cpfSearchLoading, cpfMatches.length]);

  const {
    appliedCoupon: uiCouponApplied,
    appliedLoyalty: uiLoyaltyApplied,
    appliedReferral: uiReferralApplied,
    discountTotal: totalDiscount,
    finalTotal,
  } = applyDiscounts(
    totalValue,
    couponApplied?.amount ?? 0,
    loyaltyAmountApplied,
    referralApplied?.amount ?? 0,
  );

  const resetWizard = () => {
    setStep(1); setSelectedTripId(""); setSelectedClientId(""); setBoardingLocationId("");
    setSelectedSeats([]); setManualSeats(""); setTripComboOpen(false); setClientComboOpen(false);
    setTotalValue(0); setPaidValue(0); setPaymentMethod("pix"); setInstallments(1); setFirstDueDate("");
    setHasInsurance(false); setNotes(""); setCreateError(null); setCommissionAmount(0); setSellerId("none");
    setCouponCode(""); setCouponApplied(null); setCouponError(null);
    setRedeemLoyalty(false); setLoyaltyPointsToRedeem(0); setLoyaltyAmountApplied(0);
    setReferralCode(""); setReferralApplied(null); setReferralError(null); setDiscountsOpen(false);
    setClientSearch(""); setPendingClient(null);
    setShowNewClientDialog(false); setNewClientName(""); setNewClientWhatsapp(""); setNewClientEmail(""); setNewClientError(null);
    setDupAcknowledged(false);
    setOverlapAcknowledged(false);
  };
  const handleClose = () => { resetWizard(); onClose(); };
  // Reset acknowledgment whenever the user changes trip or client
  const canGoNext1 = !!selectedTripId && !!selectedClientId && effectiveSeats.length > 0 &&
    (duplicateReservations.length === 0 || dupAcknowledged) &&
    !overlapPending && !overlapError &&
    (overlapTrips.length === 0 || overlapAcknowledged);

  // Reset acknowledgments whenever trip or client changes so the user must
  // explicitly re-confirm if they pick a different combination.
  useEffect(() => { setDupAcknowledged(false); setOverlapAcknowledged(false); }, [selectedTripId, selectedClientId]);

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
    setClientComboOpen(false);
    if (isCpfMode) {
      const matched = cpfMatches.find(c => c.id === id);
      if (matched) {
        setPendingClient(matched);
        toast({ title: "Cliente identificado pelo CPF", description: `${matched.name} foi vinculado à reserva.` });
      }
    }
    setClientSearch("");
  };

  const handleOpenNewClientDialog = () => {
    setNewClientName("");
    setNewClientWhatsapp("");
    setNewClientEmail("");
    setNewClientError(null);
    setShowNewClientDialog(true);
  };

  const handleCreateNewClient = async () => {
    setNewClientError(null);
    if (!newClientName.trim() || !newClientWhatsapp.trim()) {
      setNewClientError("Nome e WhatsApp são obrigatórios.");
      return;
    }
    try {
      const result = await createClient.mutateAsync({
        data: {
          name: newClientName.trim(),
          email: newClientEmail.trim() || "",
          whatsapp: newClientWhatsapp.trim(),
          cpf: cpfClean,
        },
      });
      const isNew = result.isNew ?? true;
      setPendingClient({ id: result.id, name: result.name, whatsapp: result.whatsapp ?? null });
      setSelectedClientId(result.id);
      setShowNewClientDialog(false);
      setClientSearch("");
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: isNew ? "Novo cliente cadastrado" : "Cliente vinculado pelo CPF",
        description: isNew
          ? `${result.name} foi cadastrado e vinculado à reserva.`
          : `${result.name} já estava cadastrado e foi vinculado à reserva.`,
      });
    } catch (err: unknown) {
      const apiMsg = (err as { data?: { error?: string } })?.data?.error;
      setNewClientError(apiMsg ?? (err instanceof Error ? err.message : "Erro ao cadastrar cliente."));
    }
  };

  const handleCouponApply = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true); setCouponError(null);
    try {
      const result = await validateCoupon.mutateAsync({ data: { code: couponCode.trim(), subtotal: totalValue } });
      if (result.valid) { setCouponApplied({ code: result.couponCode, amount: result.discountAmount }); setCouponError(null); }
      else { setCouponError(result.message ?? "Cupom inválido"); setCouponApplied(null); }
    } catch { setCouponError("Erro ao validar cupom"); }
    finally { setCouponLoading(false); }
  };

  const handleReferralApply = async () => {
    if (!referralCode.trim()) return;
    setReferralLoading(true); setReferralError(null);
    try {
      const result = await validateReferralCode(referralCode.trim());
      if (result.valid) { setReferralApplied({ id: result.referralId ?? "", code: referralCode.trim(), amount: result.bonusAmount }); setReferralError(null); }
      else { setReferralError(result.message ?? "Código inválido"); setReferralApplied(null); }
    } catch { setReferralError("Erro ao validar código de indicação"); }
    finally { setReferralLoading(false); }
  };

  const handleConfirm = async () => {
    setCreateError(null);
    if (effectiveSeats.length === 0) { setCreateError("Selecione pelo menos um assento antes de confirmar."); return; }
    const effectiveBoardingId = boardingLocationId && boardingLocationId !== "__none__" ? boardingLocationId : null;
    try {
      const created = await createReservation.mutateAsync({
        data: {
          tripId: selectedTripId, clientId: selectedClientId, seats: effectiveSeats,
          totalValue, paidValue: paidValue || undefined, paymentMethod, installments,
          firstDueDate: firstDueDate || undefined,
          notes: notes || undefined, hasInsurance,
          commissionAmount: commissionAmount > 0 ? commissionAmount : null,
          sellerId: sellerId !== "none" ? sellerId : null,
          boardingLocationId: effectiveBoardingId,
          discountCouponCode: couponApplied?.code ?? null,
          discountCouponAmount: uiCouponApplied > 0 ? uiCouponApplied : null,
          discountLoyaltyPoints: loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : null,
          discountLoyaltyAmount: uiLoyaltyApplied > 0 ? uiLoyaltyApplied : null,
          discountReferralCode: referralApplied?.code ?? null,
          discountReferralAmount: uiReferralApplied > 0 ? uiReferralApplied : null,
          discountTotal: totalDiscount > 0 ? totalDiscount : null,
        },
      });
      if (dealId && created?.id) {
        try { await updateDeal.mutateAsync({ id: dealId, data: { reservationId: created.id, status: "won" } }); await queryClient.invalidateQueries({ queryKey: ["/api/deals"] }); }
        catch { toast({ title: "Reserva criada", description: "Não foi possível vincular ao deal. Ligue manualmente se necessário." }); }
      }
      resetWizard(); onSuccess(); onClose();
    } catch (err: unknown) {
      const errData = (err as { data?: { code?: string; error?: string } })?.data;
      if (errData?.code === "DUPLICATE_RESERVATION") {
        setCreateError("Este cliente já possui uma reserva ativa nesta viagem. Cancele a reserva existente antes de criar uma nova.");
      } else {
        setCreateError(errData?.error ?? (err instanceof Error ? err.message : null) ?? "Erro ao criar reserva");
      }
    }
  };

  const balance = Math.max(0, finalTotal - paidValue);
  const wizardSellers = useMemo(() => {
    if (me?.role === ROLES.SALES && me.id) return [{ id: me.id, name: me.name }];
    return (usersForWizard ?? []).filter(user => user.role === ROLES.SALES || user.role === ROLES.AGENCY_ADMIN);
  }, [me?.id, me?.name, me?.role, usersForWizard]);

  const step2Props = {
    totalValue, setTotalValue, paidValue, setPaidValue, paymentMethod, setPaymentMethod,
    installments, setInstallments, firstDueDate, setFirstDueDate, notes, setNotes, commissionAmount, setCommissionAmount,
    sellerId, setSellerId, hasInsurance, setHasInsurance,
    isSales: me?.role === ROLES.SALES,
    couponCode, setCouponCode, couponApplied, setCouponApplied, couponError, setCouponError, couponLoading,
    redeemLoyalty, setRedeemLoyalty, loyaltyPointsToRedeem, setLoyaltyPointsToRedeem, setLoyaltyAmountApplied,
    referralCode, setReferralCode, referralApplied, setReferralApplied, referralError, setReferralError, referralLoading,
    discountsOpen, setDiscountsOpen, loyaltyInfo, usersForWizard: wizardSellers, selectedTripFull, selectedClientId, effectiveSeats,
    uiCouponApplied, uiLoyaltyApplied, uiReferralApplied, totalDiscount,
    handleCouponApply, handleReferralApply,
    onBack: () => setStep(1), onNext: () => setStep(3),
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Reserva</DialogTitle></DialogHeader>
          <WizardStepIndicator step={step} />

          {step === 1 && duplicateReservations.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 mb-4 space-y-3">
              <div className="flex items-start gap-2 text-red-800">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-sm">Este cliente já possui reserva ativa nesta viagem</p>
                  <ul className="space-y-1">
                    {duplicateReservations.map(r => (
                      <li key={r.id} className="text-xs flex items-center gap-1.5">
                        <a
                          href={`/reservations/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-medium underline underline-offset-2 hover:text-red-900"
                        >
                          {r.reservationNumber ?? r.voucherCode ?? r.id.slice(0, 8)}
                        </a>
                        {r.status && <span className="text-red-700">— {STATUS_LABELS[r.status] ?? r.status}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-700 pt-1">
                    Cancele a reserva existente antes de criar uma nova, ou marque a confirmação abaixo apenas se tiver certeza de que esta não é uma duplicata.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id="dup-acknowledged"
                  checked={dupAcknowledged}
                  onCheckedChange={(v) => setDupAcknowledged(v === true)}
                />
                <span className="text-xs font-medium text-red-800 select-none">
                  Estou ciente — esta não é uma duplicata
                </span>
              </label>
            </div>
          )}

          {step === 1 && overlapEnabled && overlapError && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 mb-4 flex items-center gap-2 text-orange-800 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 text-orange-600" />
              <span>Não foi possível verificar conflitos de período. Tente novamente ou salve e verifique manualmente.</span>
              <button className="ml-auto text-xs underline" onClick={() => queryClient.invalidateQueries({ queryKey: ["trip-overlap", selectedTripId, selectedClientId] })}>Tentar novamente</button>
            </div>
          )}

          {step === 1 && overlapTrips.length > 0 && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 mb-4 space-y-3">
              <div className="flex items-start gap-2 text-orange-800">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-orange-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-sm">Este cliente já possui reserva em outra viagem no mesmo período</p>
                  <ul className="space-y-1">
                    {overlapTrips.map(t => (
                      <li key={t.reservationId} className="text-xs flex flex-col gap-0.5">
                        <span className="font-medium">{t.tripName}</span>
                        <span className="text-orange-700">
                          {new Date(t.departureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          {t.returnDate && <> – {new Date(t.returnDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
                          {t.reservationNumber && <> · <span className="font-mono">{t.reservationNumber}</span></>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-orange-700 pt-1">
                    Verifique se as datas não conflitam. O cliente pode ter compromissos em outra viagem no mesmo período.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id="overlap-acknowledged"
                  checked={overlapAcknowledged}
                  onCheckedChange={(v) => setOverlapAcknowledged(v === true)}
                />
                <span className="text-xs font-medium text-orange-800 select-none">
                  Estou ciente — o cliente confirmou disponibilidade para ambas as viagens
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <WizardStep1
              allTrips={allTrips} allClients={allClients} boardingRaw={boardingRaw}
              selectedTripFull={selectedTripFull} selectedTripId={selectedTripId}
              selectedClientId={selectedClientId} boardingLocationId={boardingLocationId}
              selectedSeats={selectedSeats} manualSeats={manualSeats}
              tripComboOpen={tripComboOpen} clientComboOpen={clientComboOpen} canGoNext={canGoNext1}
              clientSearch={clientSearch} isCpfMode={isCpfMode}
              nameSearchResults={nameSearchResults} nameSearchLoading={nameSearchLoading}
              cpfMatches={cpfMatches} cpfSearchLoading={cpfSearchLoading}
              pendingClient={pendingClient}
              setTripComboOpen={setTripComboOpen} setClientComboOpen={setClientComboOpen}
              onSelectTrip={id => { setSelectedTripId(id); setSelectedSeats([]); setManualSeats(""); setTripComboOpen(false); }}
              onSelectClient={handleSelectClient}
              onClientSearchChange={setClientSearch}
              onCreateNewClient={handleOpenNewClientDialog}
              onCloseClientCombo={() => setClientSearch("")}
              onSelectBoarding={setBoardingLocationId}
              onSelectSeats={setSelectedSeats}
              onManualSeatsChange={setManualSeats}
              onClose={handleClose}
              onNext={() => setStep(2)}
            />
          )}

          {step === 2 && <WizardStep2 {...step2Props} />}

          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-xl border p-4 space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Resumo da Reserva</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs mb-0.5">Viagem</p><p className="font-semibold">{selectedTrip?.name ?? "—"}</p>{selectedTrip?.destination && <p className="text-xs text-muted-foreground">{selectedTrip.destination}</p>}</div>
                  <div><p className="text-muted-foreground text-xs mb-0.5">Cliente</p><p className="font-semibold">{selectedClient?.name ?? "—"}</p>{selectedClient?.whatsapp && <p className="text-xs text-muted-foreground">{selectedClient.whatsapp}</p>}</div>
                  {selectedBoarding && <div><p className="text-muted-foreground text-xs mb-0.5">Ponto de Embarque</p><p className="font-semibold">{selectedBoarding.name}</p></div>}
                  <div><p className="text-muted-foreground text-xs mb-0.5">Assentos</p><p className="font-semibold">{effectiveSeats.length > 0 ? effectiveSeats.join(", ") : "A definir"}</p></div>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="text-center"><p className="text-muted-foreground text-xs mb-0.5">Valor Base</p><p className={`font-bold text-base ${totalDiscount > 0 ? "line-through text-muted-foreground" : ""}`}>R$ {totalValue.toFixed(2)}</p></div>
                  <div className="text-center"><p className="text-muted-foreground text-xs mb-0.5">Valor Pago</p><p className="font-bold text-base text-green-600">R$ {paidValue.toFixed(2)}</p></div>
                  <div className="text-center"><p className="text-muted-foreground text-xs mb-0.5">Saldo</p><p className={`font-bold text-base ${balance > 0 ? "text-destructive" : "text-green-600"}`}>R$ {balance.toFixed(2)}</p></div>
                </div>
                {totalDiscount > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1.5 text-sm">
                    <p className="font-semibold text-green-800 text-xs uppercase tracking-wide">Descontos Aplicados</p>
                    {uiCouponApplied > 0 && couponApplied && <div className="flex justify-between text-green-700"><span>Cupom ({couponApplied.code})</span><span>−R$ {uiCouponApplied.toFixed(2)}</span></div>}
                    {uiLoyaltyApplied > 0 && <div className="flex justify-between text-green-700"><span>Fidelidade ({loyaltyPointsToRedeem} pts)</span><span>−R$ {uiLoyaltyApplied.toFixed(2)}</span></div>}
                    {uiReferralApplied > 0 && referralApplied && <div className="flex justify-between text-green-700"><span>Indicação ({referralApplied.code})</span><span>−R$ {uiReferralApplied.toFixed(2)}</span></div>}
                    <div className="flex justify-between font-bold text-green-800 pt-1 border-t border-green-200"><span>Total com Desconto</span><span>R$ {finalTotal.toFixed(2)}</span></div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground text-xs mb-0.5">Forma de Pagamento</p><p className="font-semibold">{PAYMENT_LABELS[paymentMethod] ?? paymentMethod}</p></div>
                  <div><p className="text-muted-foreground text-xs mb-0.5">Parcelas</p><p className="font-semibold">{installments}×</p></div>
                  {hasInsurance && <div><p className="text-muted-foreground text-xs mb-0.5">Seguro</p><p className="font-semibold">Incluso</p></div>}
                  {notes && <div className="col-span-2"><p className="text-muted-foreground text-xs mb-0.5">Observações</p><p className="font-semibold">{notes}</p></div>}
                </div>
              </div>
              {createError && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <XCircle className="w-4 h-4 shrink-0" /><span>{createError}</span>
                </div>
              )}
              <div className="flex justify-between gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep(2)}>← Anterior</Button>
                <Button onClick={handleConfirm} disabled={createReservation.isPending}>
                  {createReservation.isPending ? "Criando..." : "Confirmar Reserva"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNewClientDialog} onOpenChange={(o) => { if (!o) setShowNewClientDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar Novo Cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>CPF</Label>
              <Input
                value={cpfClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">Nome completo *</Label>
              <Input
                id="nc-name"
                placeholder="Nome completo"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-wa">WhatsApp *</Label>
              <Input
                id="nc-wa"
                placeholder="(00) 00000-0000"
                value={newClientWhatsapp}
                onChange={e => setNewClientWhatsapp(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-email" className="text-muted-foreground">E-mail <span className="font-normal">(opcional)</span></Label>
              <Input
                id="nc-email"
                type="email"
                placeholder="email@exemplo.com"
                value={newClientEmail}
                onChange={e => setNewClientEmail(e.target.value)}
              />
            </div>
            {newClientError && (
              <p className="text-sm text-destructive">{newClientError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewClientDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateNewClient}
              disabled={createClient.isPending || !newClientName.trim() || !newClientWhatsapp.trim()}
            >
              {createClient.isPending ? "Salvando..." : "Cadastrar e Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
