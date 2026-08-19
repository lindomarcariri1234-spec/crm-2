import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { publicStoreApi, PublicApiError, PublicStore, CouponValidation, ReferralValidation } from "@/lib/storeApi";
import { clientPortalApi } from "@/lib/clientPortalApi";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  CheckCircle,
  Tag,
  X,
  ChevronLeft,
  ChevronRight,
  User,
  ShoppingBag,
  CreditCard,
  PartyPopper,
  Copy,
  Check,
  Gift,
} from "lucide-react";
import { PAYMENT_METHOD_LABELS as PAYMENT_LABELS } from "@/lib/labels";

type Step = "dados" | "revisao" | "pagamento" | "confirmado";

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "dados", label: "Dados", icon: <User className="w-4 h-4" /> },
  { key: "revisao", label: "Revisão", icon: <ShoppingBag className="w-4 h-4" /> },
  { key: "pagamento", label: "Pagamento", icon: <CreditCard className="w-4 h-4" /> },
  { key: "confirmado", label: "Confirmação", icon: <PartyPopper className="w-4 h-4" /> },
];

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  done
                    ? "bg-green-500 text-white"
                    : active
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : step.icon}
              </div>
              <span
                className={`text-xs mt-1 hidden sm:block ${
                  active ? "font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-10 sm:w-16 mx-1 ${done ? "bg-green-500" : "bg-muted"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PixPayment({ store }: { store: PublicStore }) {
  const [copied, setCopied] = useState(false);
  const pixKey =
    store.contactWhatsapp?.replace(/\D/g, "") ??
    store.contactEmail ??
    "contato@agencia.com.br";

  function copy() {
    navigator.clipboard.writeText(pixKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use o aplicativo do seu banco para realizar o pagamento via PIX.
      </p>
      <div className="bg-muted rounded-xl p-6 text-center space-y-3">
        <div className="w-32 h-32 mx-auto bg-white rounded-lg border-4 border-primary/20 flex items-center justify-center">
          <div className="text-xs text-muted-foreground leading-tight">
            QR Code PIX<br />
            <span className="text-primary font-bold">{store.name}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">ou copie a chave PIX abaixo:</p>
        <div className="flex items-center gap-2 bg-white rounded-lg border px-3 py-2">
          <code className="flex-1 text-sm font-mono truncate">{pixKey}</code>
          <button
            onClick={copy}
            className="text-primary hover:text-primary/80 shrink-0"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Após o pagamento, nossa equipe confirmará seu pedido em até 24h.
      </p>
    </div>
  );
}

function BoletoPayment() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Após confirmar o pedido, você receberá o boleto por e-mail.
      </p>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2 text-sm">
        <p className="font-semibold text-amber-800">Instruções:</p>
        <ul className="list-disc list-inside space-y-1 text-amber-700">
          <li>O boleto tem vencimento em 3 dias úteis</li>
          <li>Pode ser pago em qualquer banco, lotérica ou internet banking</li>
          <li>Após o pagamento, aguarde até 2 dias úteis para a compensação</li>
          <li>Seu pedido será confirmado após a identificação do pagamento</li>
        </ul>
      </div>
    </div>
  );
}

function StripePaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setPaying(true);
    setStripeError(null);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (error) {
        setStripeError(error.message ?? "Pagamento falhou. Verifique os dados e tente novamente.");
      } else {
        onSuccess();
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {stripeError && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{stripeError}</p>
      )}
      <Button
        className="w-full h-11 text-white font-bold"
        onClick={handlePay}
        disabled={paying || !stripe || !elements}
      >
        {paying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Pagar agora
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Seus dados são processados com segurança pelo Stripe.
      </p>
    </div>
  );
}

function CardPayment({
  form,
  set,
  stripeState,
  onStripeSuccess,
}: {
  form: {
    cardNumber: string;
    cardName: string;
    cardExpiry: string;
    cardCvv: string;
    installments: string;
    depositAmount: string;
  };
  set: (field: string, value: string) => void;
  stripeState?: { clientSecret: string; publishableKey: string } | null;
  onStripeSuccess?: () => void;
}) {
  const stripePromise = useMemo(
    () => (stripeState ? loadStripe(stripeState.publishableKey) : null),
    [stripeState?.publishableKey]
  );

  if (stripeState && stripePromise) {
    return (
      <Elements
        stripe={stripePromise}
        options={{ clientSecret: stripeState.clientSecret, locale: "pt-BR" }}
      >
        <StripePaymentForm onSuccess={onStripeSuccess ?? (() => {})} />
      </Elements>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Preencha os dados do seu cartão. Seus dados são protegidos com criptografia.
      </p>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Número do Cartão</Label>
          <Input
            value={form.cardNumber}
            onChange={(e) =>
              set(
                "cardNumber",
                e.target.value
                  .replace(/\D/g, "")
                  .replace(/(\d{4})/g, "$1 ")
                  .trim()
                  .slice(0, 19)
              )
            }
            placeholder="0000 0000 0000 0000"
            className="font-mono"
            maxLength={19}
          />
        </div>
        <div className="space-y-1">
          <Label>Nome no Cartão</Label>
          <Input
            value={form.cardName}
            onChange={(e) => set("cardName", e.target.value.toUpperCase())}
            placeholder="NOME COMO NO CARTÃO"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Validade</Label>
            <Input
              value={form.cardExpiry}
              onChange={(e) =>
                set(
                  "cardExpiry",
                  e.target.value
                    .replace(/\D/g, "")
                    .replace(/(\d{2})(\d)/, "$1/$2")
                    .slice(0, 5)
                )
              }
              placeholder="MM/AA"
              maxLength={5}
            />
          </div>
          <div className="space-y-1">
            <Label>CVV</Label>
            <Input
              value={form.cardCvv}
              onChange={(e) =>
                set("cardCvv", e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="000"
              maxLength={4}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Parcelamento</Label>
          <select
            value={form.installments}
            onChange={(e) => set("installments", e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {[1, 2].map((n) => (
              <option key={n} value={String(n)}>
                {n}x sem juros
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Dados protegidos com SSL. Não armazenamos informações do cartão.
      </p>
    </div>
  );
}

export default function VitrineCheckout({
  slug,
  store,
}: {
  slug: string;
  store: PublicStore;
}) {
  const [, navigate] = useLocation();
  const { isSignedIn } = useUser();
  const { items, total, clearCart } = useCart();
  const [step, setStep] = useState<Step>("dados");
  const [loading, setLoading] = useState(false);
  // One key per checkout attempt: generated lazily on first submit(), reused
  // across retries of that same attempt (e.g. a network hiccup causing the
  // customer to click "Finalizar" again) so the backend can dedupe instead of
  // creating a second order and double-reserving seats. Cleared after a
  // successful order so a genuinely new purchase gets a fresh key.
  const idempotencyKeyRef = useRef<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [confirmedOrderTotal, setConfirmedOrderTotal] = useState<string | null>(null);
  const [confirmedDepositAmount, setConfirmedDepositAmount] = useState<string | null>(null);
  const [reservationExpiresAt, setReservationExpiresAt] = useState<string | null>(null);
  const [expiryCountdown, setExpiryCountdown] = useState<string | null>(null);
  const [reservationExpired, setReservationExpired] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [referralCreditBalance, setReferralCreditBalance] = useState(0);
  const [useReferralCredit, setUseReferralCredit] = useState(false);

  const [form, setFormState] = useState(() => {
    const savedCode = localStorage.getItem("referral_code") ?? "";
    return {
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerCpf: "",
      notes: "",
      paymentMethod: (store.paymentMethods ?? [])[0] ?? "pix",
      couponCode: "",
      referralCode: savedCode,
      cardNumber: "",
      cardName: "",
      cardExpiry: "",
      cardCvv: "",
      installments: "1",
      depositAmount: "",
    };
  });

  const [couponResult, setCouponResult] = useState<CouponValidation | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [referralResult, setReferralResult] = useState<ReferralValidation | null>(null);
  const [validatingReferral, setValidatingReferral] = useState(false);
  const [stripeState, setStripeState] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [paymentToken, setPaymentToken] = useState<string | null>(null);
  const [stripePaymentConfirmed, setStripePaymentConfirmed] = useState<"processing" | "confirmed" | "timeout" | null>(null);

  // Fetch referral credit balance for logged-in users
  useEffect(() => {
    if (!isSignedIn) return;
    clientPortalApi.getProfile().then((p) => {
      const balance = Number(p.referral?.creditBalance ?? 0);
      setReferralCreditBalance(balance);
    }).catch(() => {});
  }, [isSignedIn]);

  // Auto-validate referral code from localStorage on mount
  useEffect(() => {
    const savedCode = localStorage.getItem("referral_code");
    if (savedCode && !referralResult) {
      publicStoreApi.validateReferral(slug, savedCode).then((res) => {
        if (res.valid) setReferralResult(res);
      }).catch(() => {
        // Silently fail — user can still enter it manually
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: runs once on mount to restore a saved
  // referral code from localStorage. Omitting referralResult prevents an infinite loop (validate → set →
  // revalidate); omitting slug/publicStoreApi avoids spurious re-runs on stable references.
  }, []);

  // Track checkout page visit for referral analytics funnel (once per session per code)
  useEffect(() => {
    const savedCode = localStorage.getItem("referral_code");
    if (!savedCode) return;
    const sessionKey = `referral_checkout_tracked_${savedCode}`;
    if (sessionStorage.getItem(sessionKey)) return;
    const existingCookieId = localStorage.getItem("referral_server_cookie_id") ?? undefined;
    publicStoreApi.trackReferral(slug, {
      code: savedCode,
      serverCookieId: existingCookieId,
      landingPage: window.location.href,
    }).then((res) => {
      if (res.cookieId) localStorage.setItem("referral_server_cookie_id", res.cookieId);
      sessionStorage.setItem(sessionKey, "1");
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fires once per session to record the
  // checkout funnel entry. slug and publicStoreApi are stable within the component lifetime; re-running on
  // every render would duplicate analytics events and defeat the sessionStorage dedup guard.
  }, []);

  function set(field: string, value: string) {
    setFormState((p) => ({ ...p, [field]: value }));
  }

  const referralDiscountPct = referralResult?.discountPercent ?? 5;
  const referralDiscountType = referralResult?.discountType ?? "percentage";
  const referralDiscountValue = referralResult?.discountValue ?? referralDiscountPct;
  const couponDiscount = couponResult?.valid ? Number(couponResult.discountAmount ?? 0) : 0;
  const referralDiscount = referralResult?.valid && !couponResult?.valid
    ? (referralDiscountType === "fixed"
        ? Math.min(referralDiscountValue, total)
        : total * (referralDiscountPct / 100))
    : 0;
  const afterDiscount = Math.max(0, total - couponDiscount - referralDiscount);
  const referralCreditApplied = useReferralCredit
    ? Math.min(referralCreditBalance, afterDiscount)
    : 0;
  const discount = couponDiscount + referralDiscount + referralCreditApplied;
  const finalTotal = Math.max(0, total - discount);

  async function validateCoupon() {
    if (!form.couponCode) return;
    setValidatingCoupon(true);
    try {
      const res = await publicStoreApi.validateCoupon(slug, form.couponCode, total);
      setCouponResult(res);
    } catch (err: unknown) {
      const code = err instanceof PublicApiError ? err.code : undefined;
      let errorMsg = "Cupom inválido";
      if (code === "COUPON_EXPIRED") {
        errorMsg = "Este cupom está expirado";
      } else if (code === "COUPON_EXHAUSTED" || code === "COUPON_USAGE_LIMIT_EXCEEDED") {
        errorMsg = "Este cupom atingiu o limite de uso";
      }
      setCouponResult({ valid: false, error: errorMsg });
    } finally {
      setValidatingCoupon(false);
    }
  }

  function removeCoupon() {
    setCouponResult(null);
    setFormState((p) => ({ ...p, couponCode: "" }));
  }

  async function validateReferral() {
    if (!form.referralCode) return;
    setValidatingReferral(true);
    try {
      const res = await publicStoreApi.validateReferral(slug, form.referralCode);
      setReferralResult(res);
    } catch {
      setReferralResult({ valid: false, error: "Código de indicação inválido" });
    } finally {
      setValidatingReferral(false);
    }
  }

  function removeReferral() {
    setReferralResult(null);
    setFormState((p) => ({ ...p, referralCode: "" }));
  }

  function canGoNextFromDados() {
    return !!form.customerName && !!form.customerEmail;
  }

  const isStripeCardPayment =
    (form.paymentMethod === "credit_card" || form.paymentMethod === "debit_card") &&
    store.stripeEnabled &&
    !!store.stripePublicKey;

  async function submit() {
    setLoading(true);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    try {
      const order = await publicStoreApi.createOrder(slug, {
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        customerPhone: form.customerPhone || undefined,
        customerCpf: form.customerCpf || undefined,
        items: items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          variantLabel: i.variantLabel,
        })),
        couponCode: couponResult?.valid ? form.couponCode : undefined,
        referralCode: referralResult?.valid && !couponResult?.valid ? form.referralCode : undefined,
        referralCookieId: referralResult?.valid && !couponResult?.valid
          ? (localStorage.getItem("referral_server_cookie_id") ?? undefined)
          : undefined,
        referralCreditUsed: referralCreditApplied > 0 ? referralCreditApplied : undefined,
        paymentMethod: form.paymentMethod,
        notes: form.notes || undefined,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });
      // Order succeeded — the next submit() (a genuinely new purchase) should
      // mint a fresh key rather than colliding with this completed order.
      idempotencyKeyRef.current = null;
      setOrderNumber(order.orderNumber);
      setConfirmedOrderTotal(order.totalAmount);
      setConfirmedDepositAmount(order.depositAmount ?? null);
      const tok = order.paymentToken as string ?? null;
      setPaymentToken(tok);
      if (tok) {
        try {
          localStorage.setItem("pending_order_lookup", JSON.stringify({
            orderNumber: order.orderNumber,
            token: tok,
            storeSlug: slug,
          }));
        } catch { /* ignore quota errors */ }
      }
      if (order.reservationExpiresAt) {
        setReservationExpiresAt(order.reservationExpiresAt);
        localStorage.setItem("pending_order", JSON.stringify({
          orderNumber: order.orderNumber,
          reservationExpiresAt: order.reservationExpiresAt,
          storeSlug: slug,
        }));
      }
      clearCart();

      if (isStripeCardPayment) {
        const pi = await publicStoreApi.createPaymentIntent(slug, order.orderNumber, order.paymentToken as string);
        setStripeState({ clientSecret: pi.clientSecret, publishableKey: pi.publishableKey });
      } else {
        setStep("confirmado");
      }
    } catch (err: unknown) {
      if (err instanceof PublicApiError) {
        const { code } = err;
        if (code === "COUPON_EXPIRED") {
          setCouponResult({ valid: false, error: "Este cupom está expirado" });
          setStep("revisao");
          return;
        }
        if (code === "COUPON_EXHAUSTED" || code === "COUPON_USAGE_LIMIT_EXCEEDED") {
          setCouponResult({ valid: false, error: "Este cupom atingiu o limite de uso" });
          setStep("revisao");
          return;
        }
        if (code === "DUPLICATE_RESERVATION") {
          setSubmitError(
            "Este cliente já possui uma reserva ativa para esta viagem. Por favor, entre em contato com a agência.",
          );
          return;
        }
      }
      alert(err instanceof Error ? err.message : "Erro ao finalizar pedido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!reservationExpiresAt) return;
    let timer: ReturnType<typeof setInterval>;
    const tick = () => {
      const diff = new Date(reservationExpiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setExpiryCountdown("00:00");
        setReservationExpired(true);
        localStorage.removeItem("pending_order");
        clearInterval(timer);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setExpiryCountdown(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [reservationExpiresAt]);

  // Poll order payment status after Stripe payment confirmation
  useEffect(() => {
    if (step !== "confirmado" || stripePaymentConfirmed !== "processing") return;
    if (!orderNumber || !paymentToken) return;

    const POLL_INTERVAL = 2500;
    const TIMEOUT_MS = 30000;
    let stopped = false;
    const startedAt = Date.now();

    async function poll() {
      if (stopped) return;
      try {
        const order = await publicStoreApi.getOrder(slug, orderNumber!, paymentToken!);
        if (order.paymentStatus === "paid") {
          setStripePaymentConfirmed("confirmed");
          return;
        }
      } catch {
        // ignore fetch errors, keep trying
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setStripePaymentConfirmed("timeout");
        return;
      }
      setTimeout(poll, POLL_INTERVAL);
    }

    poll();
    return () => { stopped = true; };
  }, [step, stripePaymentConfirmed, orderNumber, paymentToken, slug]);

  if (items.length === 0 && step !== "confirmado") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-xl font-medium mb-4">Seu carrinho está vazio</p>
        <Button onClick={() => navigate(`/loja/${slug}/produtos`)}>Ver Pacotes</Button>
      </div>
    );
  }

  if (step === "confirmado") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <StepIndicator current="confirmado" />
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Pedido Confirmado!</h1>
        <p className="text-muted-foreground mb-2">
          Obrigado pela sua compra, {form.customerName}!
        </p>
        <p className="text-muted-foreground mb-2">
          Seu número de pedido é:{" "}
          <strong className="font-mono text-foreground">{orderNumber}</strong>
        </p>
        {confirmedDepositAmount && Number(confirmedDepositAmount) > 0 && Number(confirmedDepositAmount) < Number(confirmedOrderTotal ?? 0) && (
          <div className="inline-flex flex-col items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl px-5 py-3 mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">Reserva Confirmada! Voucher Confirmado.</span>
            </div>
            <div className="text-xs text-green-700 space-y-0.5">
              <p>Depósito pago: <strong>R$ {Number(confirmedDepositAmount).toFixed(2)}</strong></p>
              <p>Restante a pagar: <strong>R$ {(Number(confirmedOrderTotal ?? 0) - Number(confirmedDepositAmount)).toFixed(2)}</strong></p>
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground mb-4">
          Você receberá uma confirmação no e-mail <strong>{form.customerEmail}</strong>.
          Nossa equipe entrará em contato em breve.
        </p>

        {stripePaymentConfirmed === "processing" && (
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-5 py-3 mb-6">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="text-sm font-medium">Processando pagamento...</span>
          </div>
        )}
        {stripePaymentConfirmed === "confirmed" && (
          <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl px-5 py-3 mb-6">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">Pagamento confirmado!</span>
          </div>
        )}
        {stripePaymentConfirmed === "timeout" && (
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-3 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span className="text-sm">Seu pagamento está sendo processado. Você receberá uma confirmação por e-mail em breve.</span>
          </div>
        )}
        {expiryCountdown !== null && !reservationExpired && (
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-3 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span className="text-sm">
              Conclua o pagamento em{" "}
              <strong className="font-mono text-base">{expiryCountdown}</strong>
              {" "}ou a reserva será cancelada automaticamente.
            </span>
          </div>
        )}
        {reservationExpired && (
          <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-5 py-3 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span className="text-sm">
              Sua reserva expirou. Entre em contato com a nossa equipe para confirmar sua reserva.
            </span>
          </div>
        )}
        <div className="flex gap-3 justify-center flex-wrap">
          <Button
            variant="outline"
            onClick={() => navigate(`/loja/${slug}/pedido/${encodeURIComponent(orderNumber ?? "")}`)}
          >
            Acompanhar Pedido
          </Button>
          <Button
            onClick={() => navigate(`/loja/${slug}`)}
            style={{ backgroundColor: store.primaryColor }}
            className="text-white"
          >
            Voltar à Loja
          </Button>
        </div>
      </div>
    );
  }

  const OrderSummary = () => (
    <Card className="sticky top-20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Resumo do Pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={`${item.productId}::${item.variantLabel}`}
              className="flex justify-between text-sm"
            >
              <span className="line-clamp-2 flex-1 mr-2">
                {item.productName}
                {item.variantLabel && (
                  <span className="text-muted-foreground ml-1">({item.variantLabel})</span>
                )}
                <span className="text-muted-foreground ml-1">x{item.quantity}</span>
              </span>
              <span className="shrink-0 font-medium">
                R$ {(item.unitPrice * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>R$ {total.toFixed(2)}</span>
          </div>
          {couponDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Cupom ({couponResult?.code})</span>
              <span>- R$ {couponDiscount.toFixed(2)}</span>
            </div>
          )}
          {referralDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Indicação ({referralResult?.code}) −{referralDiscountType === "fixed" ? `R$ ${referralDiscountValue.toFixed(2)}` : `${referralDiscountPct}%`}</span>
              <span>- R$ {referralDiscount.toFixed(2)}</span>
            </div>
          )}
          {referralCreditApplied > 0 && (
            <div className="flex justify-between text-sm text-purple-600">
              <span>Crédito de indicação</span>
              <span>- R$ {referralCreditApplied.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg border-t pt-2 mt-1">
            <span>Total</span>
            <span style={{ color: store.primaryColor }}>R$ {finalTotal.toFixed(2)}</span>
          </div>
        </div>

        {referralCreditBalance > 0 && (
          <div className="border rounded-xl p-3 bg-purple-50 border-purple-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-purple-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-purple-800">
                    Créditos: R$ {referralCreditBalance.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-purple-600">Bônus de indicação acumulados</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUseReferralCredit(!useReferralCredit)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  useReferralCredit ? "bg-purple-600" : "bg-gray-200"
                }`}
                role="switch"
                aria-checked={useReferralCredit}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition-transform ${
                    useReferralCredit ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {useReferralCredit && referralCreditApplied > 0 && (
              <p className="text-xs text-purple-700 font-medium">
                − R$ {referralCreditApplied.toFixed(2)} aplicados no total
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const effectivePaymentMethods = (store.paymentMethods ?? []).length > 0
    ? (store.paymentMethods ?? [])
    : ["pix"];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <button
        onClick={() => {
          if (step === "dados") navigate(`/loja/${slug}/produtos`);
          else if (step === "revisao") setStep("dados");
          else if (step === "pagamento") setStep("revisao");
        }}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        {step === "dados" ? "Continuar Comprando" : "Voltar"}
      </button>

      <h1 className="text-2xl font-bold mb-6">Finalizar Pedido</h1>
      <StepIndicator current={step} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {step === "dados" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="w-4 h-4" /> Seus Dados
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <Label>
                      Nome Completo <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={form.customerName}
                      onChange={(e) => set("customerName", e.target.value)}
                      placeholder="Seu nome completo"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>
                      E-mail <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      type="email"
                      value={form.customerEmail}
                      onChange={(e) => set("customerEmail", e.target.value)}
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Telefone / WhatsApp</Label>
                    <Input
                      value={form.customerPhone}
                      onChange={(e) => set("customerPhone", e.target.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>CPF</Label>
                    <Input
                      value={form.customerCpf}
                      onChange={(e) => set("customerCpf", e.target.value)}
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label>Observações</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Alguma informação importante?"
                    />
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full h-11 text-white font-bold"
                style={{ backgroundColor: store.primaryColor }}
                disabled={!canGoNextFromDados()}
                onClick={() => setStep("revisao")}
              >
                Continuar
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          )}

          {step === "revisao" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4" /> Revisão dos Itens
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div
                        key={`${item.productId}::${item.variantLabel}`}
                        className="flex gap-3 py-2 border-b last:border-0"
                      >
                        {item.image && (
                          <img
                            src={item.image}
                            alt={item.productName}
                            className="w-14 h-14 object-cover rounded-lg shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-clamp-2">{item.productName}</p>
                          {item.variantLabel && (
                            <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
                          )}
                          <p className="text-xs text-muted-foreground">Qtd: {item.quantity}</p>
                        </div>
                        <p className="font-semibold text-sm shrink-0">
                          R$ {(item.unitPrice * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {store.couponsEnabled !== false && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Tag className="w-4 h-4" /> Cupom de Desconto
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {couponResult?.valid ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                      <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                      <div className="flex-1">
                        <p className="font-mono font-bold text-green-700">{couponResult.code}</p>
                        <p className="text-xs text-green-600">
                          Desconto de R$ {(couponResult.discountAmount ?? 0).toFixed(2)} aplicado!
                        </p>
                      </div>
                      <button onClick={removeCoupon} className="text-green-600 hover:text-green-800">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={form.couponCode}
                          onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                          placeholder="SEUCUPOM"
                          className="font-mono uppercase"
                        />
                        <Button
                          variant="outline"
                          onClick={validateCoupon}
                          disabled={!form.couponCode || validatingCoupon}
                        >
                          {validatingCoupon ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Aplicar"
                          )}
                        </Button>
                      </div>
                      {couponResult && !couponResult.valid && (
                        <p className="text-xs text-red-500">{couponResult.error}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              )}

              {store.referralsEnabled !== false && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="w-4 h-4" /> Código de Indicação
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {referralResult?.valid ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                      <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                      <div className="flex-1">
                        <p className="font-mono font-bold text-green-700">{referralResult.code}</p>
                        <p className="text-xs text-green-600">
                          {couponResult?.valid
                            ? "Desconto de indicação não aplicável junto com cupom"
                            : "Desconto de 5% por indicação aplicado!"}
                        </p>
                      </div>
                      <button onClick={removeReferral} className="text-green-600 hover:text-green-800">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={form.referralCode}
                          onChange={(e) => set("referralCode", e.target.value.toUpperCase())}
                          placeholder="Código de quem te indicou"
                          className="font-mono uppercase"
                        />
                        <Button
                          variant="outline"
                          onClick={validateReferral}
                          disabled={!form.referralCode || validatingReferral}
                        >
                          {validatingReferral ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Aplicar"
                          )}
                        </Button>
                      </div>
                      {referralResult && !referralResult.valid && (
                        <p className="text-xs text-red-500">{referralResult.error}</p>
                      )}
                      <p className="text-xs text-muted-foreground">Se alguém te indicou, insira o código deles para ganhar 5% de desconto.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              )}

              <Button
                className="w-full h-11 text-white font-bold"
                style={{ backgroundColor: store.primaryColor }}
                onClick={() => setStep("pagamento")}
              >
                Ir para Pagamento
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          )}

          {step === "pagamento" && (
            <>
              <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Forma de Pagamento
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      {effectivePaymentMethods.map((m) => (
                        <button
                          key={m}
                          onClick={() => set("paymentMethod", m)}
                          className={`p-3 rounded-lg border text-sm font-medium text-left transition-colors ${
                            form.paymentMethod === m
                              ? "border-primary bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          }`}
                        >
                          {PAYMENT_LABELS[m] ?? m}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 pt-4 border-t">
                      {form.paymentMethod === "pix" && <PixPayment store={store} />}
                      {form.paymentMethod === "boleto" && <BoletoPayment />}
                      {(form.paymentMethod === "credit_card" ||
                        form.paymentMethod === "debit_card") && (
                        <CardPayment
                          form={{
                            cardNumber: form.cardNumber,
                            cardName: form.cardName,
                            cardExpiry: form.cardExpiry,
                            cardCvv: form.cardCvv,
                            installments: form.installments,
                            depositAmount: form.depositAmount,
                          }}
                          set={set}
                          stripeState={stripeState}
                          onStripeSuccess={() => {
                            setStripePaymentConfirmed("processing");
                            setStep("confirmado");
                          }}
                        />
                      )}
                      {form.paymentMethod === "transfer" && (
                        <div className="text-sm text-muted-foreground space-y-2">
                          <p>Realize uma transferência bancária para:</p>
                          <div className="bg-muted rounded-lg p-3 space-y-1 text-sm font-mono">
                            <p>Banco: 001 – Banco do Brasil</p>
                            <p>Agência: 0001-1</p>
                            <p>Conta: 12345-6</p>
                            <p>Titular: {store.name}</p>
                          </div>
                          <p className="text-xs">
                            Envie o comprovante para{" "}
                            <strong>{store.contactEmail ?? store.contactWhatsapp}</strong>
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

              {submitError && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <div className="flex-1">
                    <p className="font-semibold mb-0.5">Reserva não concluída</p>
                    <p>{submitError}</p>
                  </div>
                  <button aria-label="Fechar" onClick={() => setSubmitError(null)} className="shrink-0 text-amber-500 hover:text-amber-700">✕</button>
                </div>
              )}

              {!stripeState && (
                <>
                  <Button
                    className="w-full h-11 text-white font-bold"
                    style={{ backgroundColor: store.primaryColor }}
                    onClick={submit}
                    disabled={loading}
                  >
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {isStripeCardPayment ? "Continuar para Pagamento" : "Confirmar Pedido"}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Ao confirmar, você concorda com os termos da loja.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <div>
          <OrderSummary />
        </div>
      </div>
    </div>
  );
}
