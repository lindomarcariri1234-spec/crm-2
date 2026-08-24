import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { publicStoreApi, PublicStore, StoreProduct, CouponValidation, PartnerProductInfo, PublicApiError } from "@/lib/storeApi";
import { clientPortalApi } from "@/lib/clientPortalApi";
import { validateCpf, validatePhone } from "@/lib/utils";
import { useSeatStream } from "@/hooks/useSeatStream";
import {
  clearStorefrontReferralCode,
  getStorefrontReferralCode,
  getStorefrontReferralCookie,
  setStorefrontReferralCode,
} from "@/lib/storefrontAttribution";
import type { LayoutSeatMap, Step } from "./constants";
import { CLICKABLE_SEAT_TYPES, STEP_ORDER } from "./constants";

export type WizardForm = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCpf: string;
  customerBirthdate: string;
  notes: string;
  paymentMethod: string;
  couponCode: string;
  cardNumber: string;
  cardName: string;
  cardExpiry: string;
  cardCvv: string;
  installments: string;
  depositAmount: string;
  partnerSelectedDate: string;
  partnerSelectedTime: string;
  partnerTransferOrigin: string;
  partnerTransferDestination: string;
};

export type CoPassenger = { name: string; cpf: string; phone: string };

export type CompletedOrder = {
  orderNumber: string;
  totalAmount: string;
  createdAt: string;
  reservationExpiresAt?: string | null;
  depositAmount?: string | null;
  amountRemaining?: string | null;
  pixQrCode?: string | null;
  pixQrCodeUrl?: string | null;
  pixCopyPaste?: string | null;
};

export type WizardSelectedVariant = { variantName: string; label: string; price: number };

export function useWizardState({
  slug,
  productSlug,
  store,
}: {
  slug: string;
  productSlug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [step, setStepState] = useState<Step>("dados");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [expiryCountdown, setExpiryCountdown] = useState<string | null>(null);

  const [form, setFormState] = useState<WizardForm>({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerCpf: "",
    customerBirthdate: "",
    notes: "",
    paymentMethod: (store.paymentMethods ?? [])[0] ?? "pix",
    couponCode: "",
    cardNumber: "",
    cardName: "",
    cardExpiry: "",
    cardCvv: "",
    installments: "1",
    depositAmount: "",
    partnerSelectedDate: "",
    partnerSelectedTime: "",
    partnerTransferOrigin: "",
    partnerTransferDestination: "",
  });
  const [qty, setQty] = useState(1);
  const [coPassengers, setCoPassengers] = useState<CoPassenger[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<WizardSelectedVariant | null>(null);
  const [couponResult, setCouponResult] = useState<CouponValidation | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [partnerInfo, setPartnerInfo] = useState<PartnerProductInfo | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [layoutSeats, setLayoutSeats] = useState<string[]>([]);
  const [layoutSeatMap, setLayoutSeatMap] = useState<LayoutSeatMap | null>(null);
  const [loadingLayoutMap, setLoadingLayoutMap] = useState(false);

  const { occupiedSeats: streamOccupied, eventCount: sseEventCount } = useSeatStream({
    tripId: product?.tripId,
    slug,
    isPublic: true,
    enabled: step === "assento" && !!product?.tripId,
  });

  const liveLayoutSeatMap = useMemo(() => {
    if (!layoutSeatMap) return null;
    if (sseEventCount === 0) return layoutSeatMap;
    // SSE is authoritative: recompute all seat statuses from base layout + current SSE snapshot.
    // Seats absent from streamOccupied are reset to "available" (for bookable seat types).
    return {
      ...layoutSeatMap,
      seats: layoutSeatMap.seats.map((seat) => {
        if (streamOccupied[seat.number]) {
          return { ...seat, status: streamOccupied[seat.number] };
        }
        if (CLICKABLE_SEAT_TYPES.includes(seat.type)) {
          return { ...seat, status: "available" };
        }
        return seat;
      }),
    };
  }, [layoutSeatMap, streamOccupied, sseEventCount]);

  useEffect(() => {
    if (sseEventCount === 0) return;
    setLayoutSeats((prev) => prev.filter((s) => !streamOccupied[s]));
    setSelectedSeats((prev) => prev.filter((n) => !streamOccupied[String(n)]));
  }, [streamOccupied, sseEventCount]);

  const [selectedBoardingPointId, setSelectedBoardingPointId] = useState<string>("");

  useEffect(() => {
    if (!product?.boardingPoints) return;
    const bps = (product.boardingPoints as Array<{ id: string; name: string }>).filter((bp) => bp.name);
    if (bps.length === 1) {
      setSelectedBoardingPointId(bps[0].id);
    }
  }, [product?.boardingPoints]);

  const [referralCode, setReferralCode] = useState(() => getStorefrontReferralCode(slug) ?? "");
  const [referralApplied, setReferralApplied] = useState(false);
  const [referralDiscountPct, setReferralDiscountPct] = useState(5);
  const [referralDiscountType, setReferralDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [referralDiscountValue, setReferralDiscountValue] = useState(5);

  // Referral credit (logged-in referrers spending their earned bonus balance)
  const { isSignedIn } = useUser();
  const [referralCreditBalance, setReferralCreditBalance] = useState(0);
  const [useReferralCredit, setUseReferralCredit] = useState(false);

  useEffect(() => {
    setLoadingProduct(true);
    publicStoreApi
      .getProduct(slug, productSlug)
      .then((p) => setProduct(p))
      .catch(() => setNotFound(true))
      .finally(() => setLoadingProduct(false));
  }, [slug, productSlug]);

  useEffect(() => {
    if (!isSignedIn) return;
    clientPortalApi.getProfile().then((p) => {
      const balance = Number(p.referral?.creditBalance ?? 0);
      setReferralCreditBalance(balance);
    }).catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    if (!product?.partnerProductId) { setPartnerInfo(null); return; }
    publicStoreApi
      .getPartnerInfo(slug, productSlug)
      .then((info) => setPartnerInfo(info))
      .catch(() => setPartnerInfo(null));
  }, [product?.partnerProductId, slug, productSlug]);

  useEffect(() => {
    if (!product?.tripId) {
      setLayoutSeatMap(null);
      return;
    }
    setLoadingLayoutMap(true);
    publicStoreApi
      .getTripSeatMap(slug, product.tripId)
      .then((data) => setLayoutSeatMap(data))
      .catch(() => setLayoutSeatMap(null))
      .finally(() => setLoadingLayoutMap(false));
  }, [slug, product?.tripId]);

  useEffect(() => {
    const savedCode = getStorefrontReferralCode(slug);
    if (savedCode) {
      publicStoreApi
        .validateReferral(slug, savedCode)
        .then((res) => {
          if (res.valid) {
            setReferralCode(savedCode);
            setReferralApplied(true);
            const rType = (res.discountType ?? "percentage") as "percentage" | "fixed";
            const rVal = res.discountValue ?? res.discountPercent ?? 5;
            setReferralDiscountType(rType);
            setReferralDiscountValue(rVal);
            setReferralDiscountPct(rType === "percentage" ? rVal : 0);
          }
        })
        .catch(() => {
          /* Silently ignore */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(field: keyof WizardForm, value: string) {
    setFormState((p) => ({ ...p, [field]: value }));
  }

  function setStep(nextStep: Step) {
    if (nextStep !== "pagamento") {
      setSubmitError(null);
    }
    setStepState(nextStep);
  }

  const basePrice = product ? parseFloat(product.salePrice ?? product.price) : 0;
  const unitPrice = selectedVariant ? selectedVariant.price : basePrice;
  const subtotal = unitPrice * qty;
  const couponDiscount = couponResult?.valid ? Number(couponResult.discountAmount ?? 0) : 0;
  const referralDiscount = referralApplied
    ? (referralDiscountType === "fixed"
        ? Math.min(referralDiscountValue, subtotal)
        : subtotal * (referralDiscountPct / 100))
    : 0;
  const afterCouponAndReferral = Math.max(0, subtotal - couponDiscount - referralDiscount);
  const referralCreditApplied = useReferralCredit
    ? Math.min(referralCreditBalance, afterCouponAndReferral)
    : 0;
  const finalTotal = Math.max(0, afterCouponAndReferral - referralCreditApplied);

  const showSeatGrid =
    product?.totalCapacity != null && product.totalCapacity > 0 && product.totalCapacity <= 60;

  const effectiveSeats: string[] = layoutSeatMap ? layoutSeats : selectedSeats.map(String);

  const maxSeats = (() => {
    if (product?.availableSeats != null) return product.availableSeats;
    if (showSeatGrid && product?.totalCapacity) return product.totalCapacity;
    return 99;
  })();

  const isSoldOut = maxSeats === 0;

  const occupiedSeats: number[] = (() => {
    if (Object.keys(streamOccupied).length > 0) {
      return Object.keys(streamOccupied)
        .map(Number)
        .filter((n) => !isNaN(n));
    }
    if (!product?.totalCapacity) return [];
    const taken = product.totalCapacity - (product.availableSeats ?? product.totalCapacity);
    return Array.from({ length: Math.max(0, taken) }, (_, i) => i + 1);
  })();

  const passengerOptions = Array.from(
    { length: Math.max(1, Math.min(maxSeats, 10)) },
    (_, i) => i + 1,
  );

  async function validateCoupon() {
    if (!form.couponCode || !product) return;
    setValidatingCoupon(true);
    try {
      const res = await publicStoreApi.validateCoupon(slug, form.couponCode, subtotal);
      setCouponResult(res);
    } catch {
      setCouponResult({ valid: false, error: "Cupom inválido" });
    } finally {
      setValidatingCoupon(false);
    }
  }

  function removeCoupon() {
    setCouponResult(null);
    set("couponCode", "");
  }

  async function applyReferral() {
    if (!referralCode.trim()) return;
    try {
      const res = await publicStoreApi.validateReferral(slug, referralCode.trim().toUpperCase());
      if (res.valid) {
        setReferralApplied(true);
        const rType = (res.discountType ?? "percentage") as "percentage" | "fixed";
        const rVal = res.discountValue ?? res.discountPercent ?? 5;
        setReferralDiscountType(rType);
        setReferralDiscountValue(rVal);
        setReferralDiscountPct(rType === "percentage" ? rVal : 0);
        setStorefrontReferralCode(slug, referralCode);
      } else {
        alert(res.error ?? "Código inválido");
      }
    } catch {
      alert("Erro ao validar código de indicação");
    }
  }

  function removeReferral() {
    setReferralApplied(false);
    setReferralCode("");
    clearStorefrontReferralCode(slug);
  }

  function toggleSeat(n: number) {
    setSelectedSeats((prev) => {
      if (prev.includes(n)) return prev.filter((s) => s !== n);
      if (prev.length < qty) return [...prev, n].sort((a, b) => a - b);
      return prev;
    });
  }

  function toggleLayoutSeat(n: string) {
    setLayoutSeats((prev) =>
      prev.includes(n) ? prev.filter((s) => s !== n) : prev.length < qty ? [...prev, n] : prev,
    );
  }

  function setCoPassenger(index: number, field: keyof CoPassenger, value: string) {
    setCoPassengers((prev) => {
      const next = [...prev];
      if (!next[index]) next[index] = { name: "", cpf: "", phone: "" };
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function changeQty(newQty: number) {
    setQty(newQty);
    setSelectedSeats([]);
    setLayoutSeats([]);
    // Trim co-passengers array to (newQty - 1) entries (slot 0 = buyer)
    setCoPassengers((prev) => prev.slice(0, Math.max(0, newQty - 1)));
  }

  function incrementQty() {
    setQty((q) => {
      const next = Math.min(maxSeats, q + 1);
      setCoPassengers((prev) => prev.slice(0, Math.max(0, next - 1)));
      return next;
    });
    setSelectedSeats([]);
    setLayoutSeats([]);
  }

  function decrementQty() {
    setQty((q) => {
      const next = Math.max(1, q - 1);
      setCoPassengers((prev) => prev.slice(0, Math.max(0, next - 1)));
      return next;
    });
    setSelectedSeats([]);
    setLayoutSeats([]);
  }

  function canProceedFromDados() {
    return (
      !!form.customerName.trim() &&
      !!form.customerEmail.trim() &&
      validatePhone(form.customerPhone) &&
      validateCpf(form.customerCpf)
    );
  }

  function canProceedFromRevisao() {
    if (isSoldOut) return false;
    if (product?.hasVariants && !selectedVariant) return false;
    if (showSeatGrid && product?.totalCapacity && qty > product.totalCapacity) return false;
    if (qty < 1) return false;
    if (partnerInfo?.hasPartner) {
      if (partnerInfo.type === "passeio" || partnerInfo.type === "experiencia") {
        if (!form.partnerSelectedDate) return false;
      }
      if (partnerInfo.type === "transfer") {
        if (!form.partnerTransferOrigin.trim() || !form.partnerTransferDestination.trim()) return false;
      }
    }
    return true;
  }

  function canProceedFromAssento() {
    if (product?.showSeatMap === false || store.seatMapEnabled === false) return true;
    if (layoutSeatMap) return layoutSeats.length === qty;
    if (showSeatGrid) return selectedSeats.length === qty;
    return true;
  }

  function canProceedFromPagamento() {
    return !!form.paymentMethod;
  }

  async function submit() {
    if (!product) return;
    setSubmitting(true);
    try {
      const seatNotes =
        effectiveSeats.length > 0
          ? `Assentos selecionados: ${effectiveSeats.join(", ")}.`
          : showSeatGrid
            ? ""
            : `${qty} vaga(s) reservada(s).`;
      const birthdateNote = form.customerBirthdate
        ? `Data de nascimento: ${form.customerBirthdate}.`
        : "";
      const referralNote = referralApplied
        ? `Código de indicação: ${referralCode}. Desconto de indicação: R$ ${referralDiscount.toFixed(2)}.`
        : "";
      const partnerNote = partnerInfo?.hasPartner
        ? [
            (partnerInfo.type === "passeio" || partnerInfo.type === "experiencia") && form.partnerSelectedDate
              ? `Data do passeio: ${form.partnerSelectedDate}${form.partnerSelectedTime ? " às " + form.partnerSelectedTime : ""}.`
              : "",
            partnerInfo.type === "transfer" && form.partnerTransferOrigin
              ? `Transfer: ${form.partnerTransferOrigin} → ${form.partnerTransferDestination}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "";
      const extraNotes = [seatNotes, birthdateNote, referralNote, partnerNote, form.notes]
        .filter(Boolean)
        .join(" ");

      // Build co-passenger list: only send entries that have a name, strip empty slots
      const filledCoPassengers = coPassengers
        .slice(0, qty - 1)
        .map((cp) => ({
          name: cp.name.trim() || `Passageiro ${coPassengers.indexOf(cp) + 2}`,
          ...(cp.cpf.trim() ? { cpf: cp.cpf.trim() } : {}),
          ...(cp.phone.trim() ? { phone: cp.phone.trim() } : {}),
        }));

      const order = await publicStoreApi.createOrder(slug, {
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone || undefined,
        customerCpf: form.customerCpf || undefined,
        customerBirthdate: form.customerBirthdate || undefined,
        items: [
          {
            productId: product.id,
            productName: product.name,
            quantity: qty,
            unitPrice,
            variantLabel: selectedVariant?.label,
            ...(partnerInfo?.hasPartner && form.partnerSelectedDate
              ? { metadata: { partnerDate: form.partnerSelectedDate, partnerTime: form.partnerSelectedTime || undefined } }
              : {}),
          },
        ],
        couponCode: couponResult?.valid ? form.couponCode : undefined,
        referralCode: referralApplied ? referralCode.trim().toUpperCase() : undefined,
        referralCookieId: referralApplied
          ? getStorefrontReferralCookie(slug)
          : undefined,
        referralCreditUsed: referralCreditApplied > 0 ? referralCreditApplied : undefined,
        paymentMethod: form.paymentMethod,
        notes: extraNotes || undefined,
        seats: effectiveSeats.length > 0 ? effectiveSeats : undefined,
        boardingLocationId: selectedBoardingPointId || undefined,
        coPassengers: filledCoPassengers.length > 0 ? filledCoPassengers : undefined,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : undefined,
      });
      setCompletedOrder({
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        reservationExpiresAt: order.reservationExpiresAt,
        depositAmount: order.depositAmount ?? null,
        amountRemaining: order.amountRemaining ?? null,
        pixQrCode: order.pixQrCode ?? null,
        pixQrCodeUrl: order.pixQrCodeUrl ?? null,
        pixCopyPaste: order.pixCopyPaste ?? null,
      });
      const tok = order.paymentToken as string | null ?? null;
      if (tok) {
        try {
          localStorage.setItem("pending_order_lookup", JSON.stringify({
            orderNumber: order.orderNumber,
            token: tok,
            storeSlug: slug,
          }));
        } catch { /* ignore quota errors */ }
      }
      clearStorefrontReferralCode(slug);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
      setStep("confirmado");
    } catch (err: unknown) {
      if (err instanceof PublicApiError && err.code === "DUPLICATE_RESERVATION") {
        setSubmitError(
          "Este cliente já possui uma reserva ativa para esta viagem. Por favor, entre em contato com a agência.",
        );
      } else {
        alert(err instanceof Error ? err.message : "Erro ao finalizar reserva. Tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      const next = STEP_ORDER[idx + 1];
      if (next === "assento" && (product?.showSeatMap === false || store.seatMapEnabled === false)) {
        if (idx + 2 < STEP_ORDER.length) setStep(STEP_ORDER[idx + 2]);
      } else {
        setStep(next);
      }
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      const prev = STEP_ORDER[idx - 1];
      if (prev === "assento" && (product?.showSeatMap === false || store.seatMapEnabled === false)) {
        if (idx - 2 >= 0) setStep(STEP_ORDER[idx - 2]);
        else navigate(`/loja/${slug}/produtos/${productSlug}`);
      } else {
        setStep(prev);
      }
    } else {
      navigate(`/loja/${slug}/produtos/${productSlug}`);
    }
  }

  useEffect(() => {
    const expiresAt = completedOrder?.reservationExpiresAt;
    if (!expiresAt) return;
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setExpiryCountdown("00:00");
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setExpiryCountdown(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [completedOrder?.reservationExpiresAt]);

  return {
    navigate,
    product,
    loadingProduct,
    notFound,
    step,
    setStep,
    submitting,
    submitError,
    setSubmitError,
    completedOrder,
    showConfetti,
    expiryCountdown,
    form,
    set,
    qty,
    changeQty,
    incrementQty,
    decrementQty,
    selectedVariant,
    setSelectedVariant,
    couponResult,
    validatingCoupon,
    validateCoupon,
    removeCoupon,
    selectedSeats,
    layoutSeats,
    setLayoutSeats,
    layoutSeatMap,
    loadingLayoutMap,
    liveLayoutSeatMap,
    referralCode,
    setReferralCode,
    referralApplied,
    referralDiscountPct,
    referralDiscountType,
    referralDiscountValue,
    applyReferral,
    removeReferral,
    basePrice,
    unitPrice,
    subtotal,
    couponDiscount,
    referralDiscount,
    referralCreditBalance,
    referralCreditApplied,
    useReferralCredit,
    setUseReferralCredit,
    finalTotal,
    showSeatGrid,
    effectiveSeats,
    maxSeats,
    isSoldOut,
    occupiedSeats,
    passengerOptions,
    canProceedFromDados,
    canProceedFromRevisao,
    canProceedFromAssento,
    canProceedFromPagamento,
    submit,
    goNext,
    goBack,
    toggleSeat,
    toggleLayoutSeat,
    partnerInfo,
    selectedBoardingPointId,
    setSelectedBoardingPointId,
    coPassengers,
    setCoPassenger,
  };
}

export type WizardState = ReturnType<typeof useWizardState>;
