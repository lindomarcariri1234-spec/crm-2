import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { publicStoreApi, PublicStore, StoreProduct, CouponValidation, PartnerProductInfo, PublicApiError, StoreOrderReservation } from "@/lib/storeApi";
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
import type { FinancialSummary } from "@/lib/linked-data";
import { isUnpaidStripeFailure } from "./stripe-payment-status";

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
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
  reservationExpiresAt?: string | null;
  depositAmount?: string | null;
  paidAmount?: number | string | null;
  amountRemaining?: string | null;
  pixQrCode?: string | null;
  pixQrCodeUrl?: string | null;
  pixCopyPaste?: string | null;
  referralCreditRequested?: number | null;
  referralCreditApplied?: number | null;
  referralCreditBalanceAfter?: number | null;
  referralCreditBalanceRefreshFailed?: boolean;
  reservations?: StoreOrderReservation[];
  financialSummary: FinancialSummary;
};

export type StripeCardPaymentState = {
  clientSecret: string;
  publishableKey: string;
  paymentIntentId: string;
  stripeLivemode: boolean;
};

type PendingStripeWizardCheckout = {
  storeSlug: string;
  productSlug: string;
  orderNumber: string;
  paymentToken: string;
  paymentIntentId: string;
  referralCreditRequested: number | null;
  referralCreditApplied: number | null;
  referralCreditBalanceAfter: number | null;
  returnHandled?: boolean;
  redirectStatus?: string | null;
  createdAt: number;
};

function pendingStripeCheckoutStorageKey(slug: string, productSlug: string): string {
  return `vitrine_reservation_stripe:${slug}:${productSlug}`;
}

function readPendingStripeCheckout(
  slug: string,
  productSlug: string,
): PendingStripeWizardCheckout | null {
  try {
    const raw = sessionStorage.getItem(pendingStripeCheckoutStorageKey(slug, productSlug));
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingStripeWizardCheckout>;
    if (
      pending.storeSlug !== slug ||
      pending.productSlug !== productSlug ||
      typeof pending.orderNumber !== "string" ||
      typeof pending.paymentToken !== "string" ||
      typeof pending.paymentIntentId !== "string" ||
      typeof pending.createdAt !== "number" ||
      Date.now() - pending.createdAt > 45 * 60 * 1000
    ) {
      return null;
    }
    return pending as PendingStripeWizardCheckout;
  } catch {
    return null;
  }
}

function getRecoverableStripeCheckout(
  slug: string,
  productSlug: string,
): PendingStripeWizardCheckout | null {
  if (typeof window === "undefined") return null;
  const pending = readPendingStripeCheckout(slug, productSlug);
  if (!pending) return null;
  const returnedPaymentIntent = new URLSearchParams(window.location.search).get("payment_intent");
  if (returnedPaymentIntent) {
    return returnedPaymentIntent === pending.paymentIntentId ? pending : null;
  }
  return pending.returnHandled ? pending : null;
}

function savePendingStripeCheckout(
  slug: string,
  productSlug: string,
  pending: PendingStripeWizardCheckout,
): void {
  try {
    sessionStorage.setItem(pendingStripeCheckoutStorageKey(slug, productSlug), JSON.stringify(pending));
  } catch {
    // Storage is optional; the in-memory Stripe flow still works without 3DS recovery.
  }
}

function clearPendingStripeCheckout(slug: string, productSlug: string): void {
  try {
    sessionStorage.removeItem(pendingStripeCheckoutStorageKey(slug, productSlug));
  } catch {
    // Ignore unavailable storage.
  }
}

function paymentIntentIdFromClientSecret(clientSecret: string): string | null {
  const separatorIndex = clientSecret.indexOf("_secret_");
  if (separatorIndex <= 0) return null;
  const paymentIntentId = clientSecret.slice(0, separatorIndex);
  return paymentIntentId.startsWith("pi_") ? paymentIntentId : null;
}

function clearStripeReturnQuery(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment_intent");
  url.searchParams.delete("payment_intent_client_secret");
  url.searchParams.delete("redirect_status");
  url.searchParams.delete("source_type");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function hasFinalCheckoutOutcome(order: CompletedOrder): boolean {
  const orderStatus = order.status?.toLowerCase();
  const paymentStatus = order.paymentStatus?.toLowerCase();
  const isCardPayment =
    order.paymentMethod === "credit_card" || order.paymentMethod === "debit_card";
  const hasConfirmedCardPayment =
    Number(order.paidAmount ?? order.financialSummary?.paidAmount ?? 0) > 0 ||
    paymentStatus === "paid";

  if (isCardPayment) {
    return (
      paymentStatus === "paid" ||
      paymentStatus === "refunded" ||
      isUnpaidStripeFailure(
        paymentStatus,
        order.paidAmount ?? order.financialSummary?.paidAmount,
      ) ||
      ["cancelled", "canceled", "refunded"].includes(orderStatus ?? "") ||
      (paymentStatus === "partially_paid" &&
        hasConfirmedCardPayment &&
        order.financialSummary?.reservationValid === true)
    );
  }

  return (
    order.financialSummary?.reservationValid === true ||
    ["paid", "confirmed", "completed", "cancelled", "canceled", "refunded"].includes(orderStatus ?? "") ||
    ["paid", "cancelled", "canceled", "refunded"].includes(paymentStatus ?? "")
  );
}

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
  const productRequestGenerationRef = useRef(0);

  const [step, setStepState] = useState<Step>("dados");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);
  const [stripePaymentState, setStripePaymentState] = useState<StripeCardPaymentState | null>(null);
  const [stripePaymentSubmitted, setStripePaymentSubmitted] = useState(false);
  const [recoveringStripeReturn, setRecoveringStripeReturn] = useState(
    () => Boolean(getRecoverableStripeCheckout(slug, productSlug)),
  );
  const [stripeReturnRecoveryError, setStripeReturnRecoveryError] = useState<string | null>(null);
  const [refreshingReferralCreditBalance, setRefreshingReferralCreditBalance] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [expiryCountdown, setExpiryCountdown] = useState<string | null>(null);
  const [reservationDeadlinePassed, setReservationDeadlinePassed] = useState(false);
  const [refreshingOrderStatus, setRefreshingOrderStatus] = useState(false);
  const [orderStatusRefreshFailed, setOrderStatusRefreshFailed] = useState(false);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);
  const paymentTokenRef = useRef<string | null>(null);
  const orderStatusRefreshInFlightRef = useRef(false);

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
  const [referralFirstPurchaseOnly, setReferralFirstPurchaseOnly] = useState(false);

  // Referral credit (logged-in referrers spending their earned bonus balance)
  const { isLoaded: clerkIsLoaded, isSignedIn } = useUser();
  const isAuthLoaded = clerkIsLoaded ?? true;
  const [referralCreditBalance, setReferralCreditBalance] = useState(0);
  const [useReferralCredit, setUseReferralCredit] = useState(false);
  const [loadingReferralCreditBalance, setLoadingReferralCreditBalance] = useState(false);
  const [referralCreditBalanceError, setReferralCreditBalanceError] = useState<string | null>(null);

  useEffect(() => {
    const requestGeneration = ++productRequestGenerationRef.current;

    // A new URL must not render, or submit with, the previous product while
    // its replacement is being fetched.
    setProduct(null);
    setNotFound(false);
    setLoadingProduct(true);
    setSelectedVariant(null);
    setCouponResult(null);
    setPartnerInfo(null);
    setSelectedSeats([]);
    setLayoutSeats([]);
    setLayoutSeatMap(null);
    setSelectedBoardingPointId("");
    checkoutIdempotencyKeyRef.current = null;

    publicStoreApi
      .getProduct(slug, productSlug)
      .then((p) => {
        if (requestGeneration === productRequestGenerationRef.current) {
          setProduct(p);
        }
      })
      .catch(() => {
        if (requestGeneration === productRequestGenerationRef.current) {
          setNotFound(true);
        }
      })
      .finally(() => {
        if (requestGeneration === productRequestGenerationRef.current) {
          setLoadingProduct(false);
        }
      });
  }, [slug, productSlug]);

  useEffect(() => {
    if (!isAuthLoaded) {
      setLoadingReferralCreditBalance(true);
      return;
    }
    if (!isSignedIn) {
      setReferralCreditBalance(0);
      setUseReferralCredit(false);
      setLoadingReferralCreditBalance(false);
      setReferralCreditBalanceError(null);
      return;
    }

    let cancelled = false;
    setLoadingReferralCreditBalance(true);
    setReferralCreditBalanceError(null);
    clientPortalApi.getProfile().then((p) => {
      if (cancelled) return;
      const balance = Number(p.referral?.creditBalance ?? 0);
      if (!Number.isFinite(balance)) throw new Error("Saldo de cashback inválido");
      setReferralCreditBalance(balance);
    }).catch(() => {
      if (!cancelled) {
        setReferralCreditBalanceError("Não foi possível consultar seu cashback.");
      }
    }).finally(() => {
      if (!cancelled) setLoadingReferralCreditBalance(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthLoaded, isSignedIn]);

  async function retryReferralCreditBalance(): Promise<void> {
    if (!isSignedIn || loadingReferralCreditBalance) return;
    setLoadingReferralCreditBalance(true);
    setReferralCreditBalanceError(null);
    try {
      const profile = await clientPortalApi.getProfile();
      const balance = Number(profile.referral?.creditBalance ?? 0);
      if (!Number.isFinite(balance)) throw new Error("Saldo de cashback inválido");
      setReferralCreditBalance(balance);
    } catch {
      setReferralCreditBalanceError("Não foi possível consultar seu cashback.");
    } finally {
      setLoadingReferralCreditBalance(false);
    }
  }

  useEffect(() => {
    if (!product?.partnerProductId) { setPartnerInfo(null); return; }
    const requestGeneration = productRequestGenerationRef.current;
    const productId = product.id;
    publicStoreApi
      .getPartnerInfo(slug, productSlug)
      .then((info) => {
        if (requestGeneration === productRequestGenerationRef.current && product?.id === productId) {
          setPartnerInfo(info);
        }
      })
      .catch(() => {
        if (requestGeneration === productRequestGenerationRef.current && product?.id === productId) {
          setPartnerInfo(null);
        }
      });
  }, [product?.partnerProductId, slug, productSlug]);

  useEffect(() => {
    if (!product?.tripId) {
      setLayoutSeatMap(null);
      setLoadingLayoutMap(false);
      return;
    }
    const requestGeneration = productRequestGenerationRef.current;
    const tripId = product.tripId;
    setLoadingLayoutMap(true);
    publicStoreApi
      .getTripSeatMap(slug, tripId)
      .then((data) => {
        if (requestGeneration === productRequestGenerationRef.current && product?.tripId === tripId) {
          setLayoutSeatMap(data);
        }
      })
      .catch(() => {
        if (requestGeneration === productRequestGenerationRef.current && product?.tripId === tripId) {
          setLayoutSeatMap(null);
        }
      })
      .finally(() => {
        if (requestGeneration === productRequestGenerationRef.current && product?.tripId === tripId) {
          setLoadingLayoutMap(false);
        }
      });
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
            setReferralFirstPurchaseOnly(res.firstPurchaseOnly ?? false);
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
        setReferralFirstPurchaseOnly(res.firstPurchaseOnly ?? false);
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
      for (let i = 0; i <= index; i += 1) {
        if (!next[i]) next[i] = { name: "", cpf: "", phone: "" };
      }
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

  function hasCompleteCoPassengers() {
    const requiredCount = Math.max(0, qty - 1);
    return Array.from({ length: requiredCount }, (_, index) => coPassengers[index])
      .every((passenger) => !!passenger?.name.trim());
  }

  function canProceedFromDados() {
    return (
      !!form.customerName.trim() &&
      !!form.customerEmail.trim() &&
      validatePhone(form.customerPhone) &&
      validateCpf(form.customerCpf) &&
      hasCompleteCoPassengers()
    );
  }

  function canProceedFromRevisao() {
    if (isSoldOut) return false;
    if (!hasCompleteCoPassengers()) return false;
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
    if (
      (form.paymentMethod === "credit_card" || form.paymentMethod === "debit_card") &&
      !store.stripeEnabled
    ) {
      return false;
    }
    return !!form.paymentMethod;
  }

  function getCheckoutIdempotencyKey(): string {
    if (checkoutIdempotencyKeyRef.current) return checkoutIdempotencyKeyRef.current;

    const storageKey = `vitrine_checkout_idempotency:${slug}:${productSlug}`;
    const now = Date.now();
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { key?: unknown; createdAt?: unknown };
        if (
          typeof parsed.key === "string" &&
          parsed.key.length > 0 &&
          typeof parsed.createdAt === "number" &&
          now - parsed.createdAt < 45 * 60 * 1000
        ) {
          checkoutIdempotencyKeyRef.current = parsed.key;
          return parsed.key;
        }
      }
    } catch {
      // Storage is optional; the in-memory key still protects normal retries.
    }

    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    checkoutIdempotencyKeyRef.current = generated;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ key: generated, createdAt: now }));
    } catch {
      // Storage is optional.
    }
    return generated;
  }

  function clearCheckoutIdempotencyKey() {
    checkoutIdempotencyKeyRef.current = null;
    try {
      sessionStorage.removeItem(`vitrine_checkout_idempotency:${slug}:${productSlug}`);
    } catch {
      // Storage is optional.
    }
  }

  async function submit() {
    if (!product) return;
    if (!hasCompleteCoPassengers()) {
      setStep("dados");
      setSubmitError("Informe o nome de cada acompanhante antes de continuar.");
      return;
    }
    setSubmitError(null);
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

      // The passenger step does not allow proceeding with an empty companion.
      // Keep the payload positional: index 0 is the second passenger, index 1
      // is the third passenger, and so on. The API validates the same invariant.
      const filledCoPassengers = coPassengers
        .slice(0, qty - 1)
        .map((cp) => ({
          name: cp.name.trim(),
          ...(cp.cpf.trim() ? { cpf: cp.cpf.trim() } : {}),
          ...(cp.phone.trim() ? { phone: cp.phone.trim() } : {}),
        }));

      const order = await publicStoreApi.createOrder(slug, {
        idempotencyKey: getCheckoutIdempotencyKey(),
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
        depositAmount:
          form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal
            ? Number(form.depositAmount)
            : undefined,
      });

      const requestedReferralCredit = referralCreditApplied;
      const appliedReferralCredit =
        order.referralCreditApplied != null && Number.isFinite(Number(order.referralCreditApplied))
        ? Number(order.referralCreditApplied)
        : requestedReferralCredit;
      let refreshedReferralCreditBalance: number | null = null;
      let referralCreditBalanceRefreshFailed = false;
      if (isSignedIn && requestedReferralCredit > 0) {
        try {
          const profile = await clientPortalApi.getProfile();
          const nextBalance = Number(profile.referral?.creditBalance ?? 0);
          if (Number.isFinite(nextBalance)) {
            refreshedReferralCreditBalance = nextBalance;
            setReferralCreditBalance(nextBalance);
          } else {
            referralCreditBalanceRefreshFailed = true;
          }
        } catch {
          // The order succeeded even if the optional balance refresh fails.
          referralCreditBalanceRefreshFailed = true;
        }
      }

      const tok = typeof order.paymentToken === "string" ? order.paymentToken : null;
      paymentTokenRef.current = tok;
      const isStripeCardPayment =
        form.paymentMethod === "credit_card" || form.paymentMethod === "debit_card";
      if (isStripeCardPayment) {
        if (!tok) {
          throw new Error("Não foi possível autenticar o pedido para iniciar o pagamento Stripe.");
        }
        const stripePayment = await publicStoreApi.createPaymentIntent(slug, order.orderNumber, tok);
        const paymentIntentId =
          stripePayment.paymentIntentId ??
          (stripePayment.clientSecret
            ? paymentIntentIdFromClientSecret(stripePayment.clientSecret)
            : null);
        if (!stripePayment.clientSecret || !paymentIntentId) {
          throw new Error("Não foi possível preparar o pagamento com cartão pela Stripe.");
        }
        setStripePaymentState({
          clientSecret: stripePayment.clientSecret,
          publishableKey: stripePayment.publishableKey,
          paymentIntentId,
          stripeLivemode: stripePayment.stripeLivemode,
        });
        setStripePaymentSubmitted(false);
        savePendingStripeCheckout(slug, productSlug, {
          storeSlug: slug,
          productSlug,
          orderNumber: order.orderNumber,
          paymentToken: tok,
          paymentIntentId,
          referralCreditRequested: requestedReferralCredit > 0 ? requestedReferralCredit : null,
          referralCreditApplied: requestedReferralCredit > 0 ? appliedReferralCredit : null,
          referralCreditBalanceAfter: refreshedReferralCreditBalance,
          createdAt: Date.now(),
        });
      } else {
        setStripePaymentState(null);
        setStripePaymentSubmitted(false);
      }
      setCompletedOrder({
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone || null,
        paymentMethod: form.paymentMethod,
        paymentStatus: order.paymentStatus ?? null,
        status: order.status ?? null,
        reservationExpiresAt: order.reservationExpiresAt,
        depositAmount: order.depositAmount ?? null,
        amountRemaining: order.amountRemaining ?? null,
        pixQrCode: order.pixQrCode ?? null,
        pixQrCodeUrl: order.pixQrCodeUrl ?? null,
        pixCopyPaste: order.pixCopyPaste ?? null,
        referralCreditRequested: requestedReferralCredit > 0 ? requestedReferralCredit : null,
        referralCreditApplied: requestedReferralCredit > 0 ? appliedReferralCredit : null,
        referralCreditBalanceAfter: refreshedReferralCreditBalance,
        referralCreditBalanceRefreshFailed,
        reservations: order.reservations,
        financialSummary: order.financialSummary,
      });
      clearCheckoutIdempotencyKey();
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
      const code = err instanceof PublicApiError ? err.code : undefined;
      const messages: Record<string, string> = {
        DUPLICATE_RESERVATION:
          "Este cliente já possui uma reserva ativa para esta viagem. Revise os dados ou entre em contato com a agência.",
        INSUFFICIENT_SEATS:
          "As vagas selecionadas acabaram de ser ocupadas. Volte à etapa de assentos e escolha novamente.",
        SEAT_CONFLICT:
          "Um dos assentos acabou de ser ocupado. Volte à etapa de assentos e escolha novamente.",
        DEPOSIT_BELOW_MINIMUM:
          "A entrada informada está abaixo do mínimo exigido pela agência.",
        DEPOSIT_ABOVE_TOTAL:
          "A entrada informada é maior que o total atualizado do pedido. Revise o resumo.",
        UNAUTHENTICATED_CREDIT:
          "Entre na sua conta para usar o cashback de indicação.",
        CREDIT_EMAIL_MISMATCH:
          "O e-mail da conta precisa ser o mesmo informado no pedido para usar o cashback.",
        REFERRAL_FIRST_PURCHASE_RESERVED:
          "Já existe uma compra pendente com este benefício de indicação. Finalize ou cancele a compra anterior antes de tentar novamente.",
        RESERVATION_NO_AGENCY_USER:
          "A agência ainda não está pronta para receber reservas online. Entre em contato para concluir o atendimento.",
        RESERVATION_SYNC_FAILED:
          "Não foi possível criar a reserva agora. Nenhum pagamento foi confirmado; tente novamente.",
        STRIPE_NOT_CONFIGURED:
          "O pagamento com cartão está indisponível porque a Stripe ainda não foi configurada nesta loja.",
        STRIPE_NOT_ENABLED:
          "O pagamento com cartão está indisponível nesta loja no momento.",
      };
      setSubmitError(
        (code && messages[code]) ||
        (err instanceof Error ? err.message : "Erro ao finalizar reserva. Tente novamente."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshReferralCreditBalance(): Promise<void> {
    if (
      !isSignedIn ||
      refreshingReferralCreditBalance ||
      !completedOrder ||
      completedOrder.referralCreditApplied == null ||
      completedOrder.referralCreditApplied <= 0
    ) {
      return;
    }

    setRefreshingReferralCreditBalance(true);
    try {
      const profile = await clientPortalApi.getProfile();
      const nextBalance = Number(profile.referral?.creditBalance ?? 0);
      if (!Number.isFinite(nextBalance)) {
        throw new Error("Invalid referral credit balance");
      }
      setReferralCreditBalance(nextBalance);
      setCompletedOrder((previous) =>
        previous
          ? {
              ...previous,
              referralCreditBalanceAfter: nextBalance,
              referralCreditBalanceRefreshFailed: false,
            }
          : previous,
      );
    } catch {
      setCompletedOrder((previous) =>
        previous
          ? {
              ...previous,
              referralCreditBalanceAfter: null,
              referralCreditBalanceRefreshFailed: true,
            }
          : previous,
      );
    } finally {
      setRefreshingReferralCreditBalance(false);
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

  const currentOrderNumber = completedOrder?.orderNumber;
  const refreshOrderStatus = useCallback(async (showFailure = false) => {
    const paymentToken = paymentTokenRef.current;
    if (!currentOrderNumber || !paymentToken || orderStatusRefreshInFlightRef.current) return;

    orderStatusRefreshInFlightRef.current = true;
    setRefreshingOrderStatus(true);
    try {
      const latestOrder = await publicStoreApi.getOrder(slug, currentOrderNumber, paymentToken);
      setCompletedOrder((current) => {
        if (!current || current.orderNumber !== currentOrderNumber) return current;
        return {
          ...current,
          totalAmount: latestOrder.totalAmount,
          paymentStatus: latestOrder.paymentStatus,
          status: latestOrder.status,
          reservationExpiresAt: latestOrder.reservationExpiresAt ?? null,
          depositAmount: latestOrder.depositAmount ?? null,
          paidAmount: latestOrder.paidAmount ?? null,
          amountRemaining: latestOrder.amountRemaining ?? null,
          pixQrCode: latestOrder.pixQrCode ?? null,
          pixQrCodeUrl: latestOrder.pixQrCodeUrl ?? null,
          pixCopyPaste: latestOrder.pixCopyPaste ?? null,
          financialSummary: latestOrder.financialSummary ?? current.financialSummary,
        };
      });
      setOrderStatusRefreshFailed(false);
    } catch {
      if (showFailure) setOrderStatusRefreshFailed(true);
    } finally {
      orderStatusRefreshInFlightRef.current = false;
      setRefreshingOrderStatus(false);
    }
  }, [currentOrderNumber, slug]);

  const stripeReturnRecoveryStartedRef = useRef(false);
  useEffect(() => {
    const pending = getRecoverableStripeCheckout(slug, productSlug);
    if (!pending || stripeReturnRecoveryStartedRef.current) return;
    stripeReturnRecoveryStartedRef.current = true;

    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const redirectStatus = params.get("redirect_status") ?? pending.redirectStatus ?? null;
    setRecoveringStripeReturn(true);
    setStripeReturnRecoveryError(null);

    void (async () => {
      try {
        const order = await publicStoreApi.getOrder(slug, pending.orderNumber, pending.paymentToken);
        if (cancelled) return;

        paymentTokenRef.current = pending.paymentToken;
        const reservations = order.reservations ?? [];
        const passengers = reservations.flatMap((reservation) => reservation.passengers ?? []);
        const companionPassengers = passengers
          .filter((passenger) => !passenger.isPrimary)
          .map((passenger) => ({
            name: passenger.name,
            cpf: "",
            phone: passenger.phone ?? "",
          }));
        const savedSeats = reservations.flatMap((reservation) => reservation.seats ?? []).map(String);
        const itemPassengerCount = (order.items ?? []).reduce(
          (sum, item) => sum + Math.max(0, Number(item.quantity) || 0),
          0,
        );
        const failedWithoutReceipt = isUnpaidStripeFailure(
          order.paymentStatus,
          order.paidAmount ?? order.financialSummary?.paidAmount,
        );
        const shouldTreatAsSubmitted =
          !failedWithoutReceipt &&
          (
            ["succeeded", "processing"].includes(redirectStatus ?? "") ||
            ["paid", "processing"].includes((order.paymentStatus ?? "").toLowerCase())
          );

        setFormState((current) => ({
          ...current,
          customerName: order.customerName ?? "",
          customerEmail: order.customerEmail ?? "",
          customerPhone: order.customerPhone ?? "",
          paymentMethod: order.paymentMethod ?? "credit_card",
        }));
        setQty(Math.max(1, itemPassengerCount || passengers.length));
        setCoPassengers(companionPassengers);
        setLayoutSeats(savedSeats);
        setSelectedSeats(
          savedSeats
            .filter((seat) => /^\d+$/.test(seat))
            .map(Number),
        );
        setSelectedBoardingPointId(reservations[0]?.boardingLocationId ?? "");
        setCompletedOrder({
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone ?? null,
          paymentMethod: order.paymentMethod ?? "credit_card",
          paymentStatus: order.paymentStatus ?? null,
          status: order.status ?? null,
          reservationExpiresAt: order.reservationExpiresAt ?? null,
          depositAmount: order.depositAmount ?? null,
          paidAmount: order.paidAmount ?? null,
          amountRemaining: order.amountRemaining ?? null,
          pixQrCode: order.pixQrCode ?? null,
          pixQrCodeUrl: order.pixQrCodeUrl ?? null,
          pixCopyPaste: order.pixCopyPaste ?? null,
          referralCreditRequested: pending.referralCreditRequested,
          referralCreditApplied: pending.referralCreditApplied,
          referralCreditBalanceAfter: pending.referralCreditBalanceAfter,
          reservations,
          financialSummary: order.financialSummary,
        });
        setStripePaymentSubmitted(shouldTreatAsSubmitted);
        setStripePaymentState(null);

        if (!shouldTreatAsSubmitted && !failedWithoutReceipt) {
          const stripePayment = await publicStoreApi.createPaymentIntent(
            slug,
            order.orderNumber,
            pending.paymentToken,
          );
          const paymentIntentId =
            stripePayment.paymentIntentId ??
            (stripePayment.clientSecret
              ? paymentIntentIdFromClientSecret(stripePayment.clientSecret)
              : null);
          if (!stripePayment.clientSecret || paymentIntentId !== pending.paymentIntentId) {
            throw new Error("Não foi possível recuperar o formulário de pagamento Stripe.");
          }
          if (cancelled) return;
          setStripePaymentState({
            clientSecret: stripePayment.clientSecret,
            publishableKey: stripePayment.publishableKey,
            paymentIntentId,
            stripeLivemode: stripePayment.stripeLivemode,
          });
        }

        savePendingStripeCheckout(slug, productSlug, {
          ...pending,
          returnHandled: true,
          redirectStatus,
        });
        if (params.has("payment_intent")) clearStripeReturnQuery();
        setStepState("confirmado");
      } catch {
        if (!cancelled) {
          setStripeReturnRecoveryError(
            "Não foi possível recuperar esta cobrança. Recarregue a página para tentar novamente; não crie outro pedido.",
          );
        }
      } finally {
        if (!cancelled) setRecoveringStripeReturn(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, productSlug]);

  const handleStripePaymentSubmitted = useCallback(() => {
    setStripePaymentSubmitted(true);
    const pending = readPendingStripeCheckout(slug, productSlug);
    if (pending && pending.orderNumber === currentOrderNumber) {
      savePendingStripeCheckout(slug, productSlug, {
        ...pending,
        returnHandled: true,
        redirectStatus: "processing",
      });
    }
    void refreshOrderStatus(true);
  }, [currentOrderNumber, productSlug, refreshOrderStatus, slug]);

  useEffect(() => {
    if (!completedOrder || !hasFinalCheckoutOutcome(completedOrder)) return;
    const pending = readPendingStripeCheckout(slug, productSlug);
    if (pending?.orderNumber === completedOrder.orderNumber) {
      clearPendingStripeCheckout(slug, productSlug);
    }
  }, [
    completedOrder?.orderNumber,
    completedOrder?.status,
    completedOrder?.paymentStatus,
    completedOrder?.financialSummary?.reservationValid,
    productSlug,
    slug,
  ]);

  useEffect(() => {
    if (!completedOrder || !paymentTokenRef.current || hasFinalCheckoutOutcome(completedOrder)) return;
    const timer = window.setInterval(() => {
      void refreshOrderStatus();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [
    completedOrder?.orderNumber,
    completedOrder?.status,
    completedOrder?.paymentStatus,
    completedOrder?.financialSummary?.reservationValid,
    refreshOrderStatus,
  ]);

  useEffect(() => {
    const expiresAt = completedOrder?.reservationExpiresAt;
    if (!expiresAt || (completedOrder && hasFinalCheckoutOutcome(completedOrder))) {
      setExpiryCountdown(null);
      setReservationDeadlinePassed(false);
      return;
    }
    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      setExpiryCountdown(null);
      setReservationDeadlinePassed(false);
      return;
    }
    const tick = () => {
      const diff = expiresAtMs - Date.now();
      if (diff <= 0) {
        setExpiryCountdown(null);
        setReservationDeadlinePassed(true);
        return false;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setExpiryCountdown(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      setReservationDeadlinePassed(false);
      return true;
    };
    if (!tick()) return;
    const timer = window.setInterval(() => {
      if (!tick()) window.clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [
    completedOrder?.reservationExpiresAt,
    completedOrder?.status,
    completedOrder?.paymentStatus,
    completedOrder?.financialSummary?.reservationValid,
  ]);

  return {
    navigate,
    product,
    loadingProduct,
    notFound,
    step,
    setStep,
    submitting,
    refreshingReferralCreditBalance,
    submitError,
    setSubmitError,
    completedOrder,
    showConfetti,
    expiryCountdown,
    reservationDeadlinePassed,
    refreshingOrderStatus,
    orderStatusRefreshFailed,
    refreshOrderStatus,
    stripePaymentState,
    stripePaymentSubmitted,
    handleStripePaymentSubmitted,
    recoveringStripeReturn,
    stripeReturnRecoveryError,
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
    referralFirstPurchaseOnly,
    applyReferral,
    removeReferral,
    basePrice,
    unitPrice,
    subtotal,
    couponDiscount,
    referralDiscount,
    isAuthLoaded,
    isSignedIn,
    referralCreditBalance,
    loadingReferralCreditBalance,
    referralCreditBalanceError,
    retryReferralCreditBalance,
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
    refreshReferralCreditBalance,
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
