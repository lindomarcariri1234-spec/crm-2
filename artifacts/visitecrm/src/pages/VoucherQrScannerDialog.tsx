import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Reservation } from "@workspace/api-client-react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { AlertCircle, Camera, CheckCircle2, Clock, Loader2, MapPin, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

type BarcodeDetection = { rawValue?: string };

type QrBarcodeDetector = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetection[]>;
};

type QrBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): QrBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

type CameraSupport = "available" | "camera-unavailable" | "qr-unsupported";
type CameraStatus =
  | "idle"
  | "requesting"
  | "scanning"
  | "detected"
  | "camera-unavailable"
  | "qr-unsupported"
  | "permission-denied"
  | "camera-not-found"
  | "error";

type VoucherQrScannerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservations: Reservation[];
  onCheckIn: (reservationId: string) => Promise<void>;
  isCheckingIn: boolean;
};

export function getQrScannerCameraSupport(
  mediaDevices: { getUserMedia?: unknown } | null | undefined,
  detector: unknown,
): CameraSupport {
  if (typeof mediaDevices?.getUserMedia !== "function") return "camera-unavailable";
  if (typeof detector !== "function") return "qr-unsupported";
  return "available";
}

export function findReservationByQrCode(
  code: string,
  reservations: Reservation[],
): Reservation | null {
  const normalizedCode = code.trim().toLocaleUpperCase("pt-BR");
  if (!normalizedCode) return null;

  return reservations.find((reservation) =>
    [reservation.voucherCode, reservation.reservationNumber, reservation.id]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLocaleUpperCase("pt-BR") === normalizedCode),
  ) ?? null;
}

function getBarcodeDetectorConstructor(): QrBarcodeDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & {
    BarcodeDetector?: QrBarcodeDetectorConstructor;
  }).BarcodeDetector;
}

function cameraStatusMessage(status: CameraStatus): string | null {
  switch (status) {
    case "requesting":
      return "Solicitando acesso à câmera…";
    case "scanning":
      return "Aponte a câmera para o QR do voucher.";
    case "detected":
      return "Código lido. Confira os dados do passageiro antes de continuar.";
    case "camera-unavailable":
      return "Este dispositivo ou navegador não disponibiliza acesso à câmera. Digite o código do voucher abaixo.";
    case "qr-unsupported":
      return "A leitura de QR pela câmera não é compatível com este navegador. Digite o código do voucher abaixo.";
    case "permission-denied":
      return "A permissão da câmera foi negada. Libere o acesso no navegador ou digite o código do voucher abaixo.";
    case "camera-not-found":
      return "Nenhuma câmera foi encontrada. Digite o código do voucher abaixo.";
    case "error":
      return "Não foi possível iniciar a leitura. Confira a câmera ou digite o código do voucher abaixo.";
    default:
      return null;
  }
}

function checkedInTime(checkedInAt: string | null | undefined): string | null {
  if (!checkedInAt) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(checkedInAt));
}

export function VoucherQrScannerDialog({
  open,
  onOpenChange,
  reservations,
  onCheckIn,
  isCheckingIn,
}: VoucherQrScannerDialogProps) {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [manualCode, setManualCode] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [matchedReservationId, setMatchedReservationId] = useState<string | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [checkInCompleted, setCheckInCompleted] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const cameraSessionRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  const matchedReservation = reservations.find(
    (reservation) => reservation.id === matchedReservationId,
  );
  const isAlreadyCheckedIn = Boolean(matchedReservation?.checkedInAt || checkInCompleted);
  const isConfirmedReservation = matchedReservation?.status === RESERVATION_STATUS.CONFIRMED;
  const time = checkedInTime(matchedReservation?.checkedInAt);

  function stopCamera() {
    cameraSessionRef.current += 1;
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // A track may already have ended after permission was revoked.
      }
    });
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    if (open) return;
    stopCamera();
    setCameraStatus("idle");
    setManualCode("");
    setLookupMessage("");
    setMatchedReservationId(null);
    setIdentityConfirmed(false);
    setCheckInCompleted(false);
    setCheckInError("");
  }, [open]);

  useEffect(() => () => stopCamera(), []);

  function handleCodeLookup(code: string) {
    const trimmedCode = code.trim();
    setManualCode(trimmedCode);
    setIdentityConfirmed(false);
    setCheckInCompleted(false);
    setCheckInError("");

    if (!trimmedCode) {
      setMatchedReservationId(null);
      setLookupMessage("Informe o código do voucher ou da reserva.");
      return;
    }

    const reservation = findReservationByQrCode(trimmedCode, reservations);
    if (!reservation) {
      setMatchedReservationId(null);
      setLookupMessage("Não encontramos uma reserva com esse código. Confira e tente novamente.");
      return;
    }

    setMatchedReservationId(reservation.id);
    setLookupMessage("");
  }

  async function scanVideo(
    detector: QrBarcodeDetector,
    sessionId: number,
  ): Promise<void> {
    if (sessionId !== cameraSessionRef.current || !openRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const detections = await detector.detect(video);
        const code = detections.find((detection) => detection.rawValue?.trim())?.rawValue?.trim();
        if (code) {
          stopCamera();
          setCameraStatus("detected");
          handleCodeLookup(code);
          return;
        }
      }
    } catch {
      stopCamera();
      setCameraStatus("error");
      return;
    }

    if (sessionId === cameraSessionRef.current && openRef.current) {
      scanTimerRef.current = window.setTimeout(() => {
        void scanVideo(detector, sessionId);
      }, 300);
    }
  }

  async function startCamera() {
    const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const Detector = getBarcodeDetectorConstructor();
    const support = getQrScannerCameraSupport(mediaDevices, Detector);

    if (support !== "available") {
      setCameraStatus(support);
      return;
    }
    if (!Detector) {
      setCameraStatus("qr-unsupported");
      return;
    }

    setCameraStatus("requesting");
    const sessionId = ++cameraSessionRef.current;

    try {
      if (Detector?.getSupportedFormats) {
        const formats = await Detector.getSupportedFormats();
        if (!formats.includes("qr_code")) {
          setCameraStatus("qr-unsupported");
          return;
        }
      }

      const detector = new Detector({ formats: ["qr_code"] });
      const stream = await mediaDevices!.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });

      if (sessionId !== cameraSessionRef.current || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        setCameraStatus("error");
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      if (sessionId !== cameraSessionRef.current || !openRef.current) return;

      setCameraStatus("scanning");
      void scanVideo(detector, sessionId);
    } catch (error) {
      stopCamera();
      const errorName = error instanceof DOMException ? error.name : "";
      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        setCameraStatus("permission-denied");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setCameraStatus("camera-not-found");
      } else {
        setCameraStatus("error");
      }
    }
  }

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cameraWasActive = cameraStatus === "requesting" || cameraStatus === "scanning";
    stopCamera();
    if (cameraWasActive) setCameraStatus("idle");
    handleCodeLookup(manualCode);
  }

  async function handleCheckIn() {
    if (!matchedReservation || !identityConfirmed || !isConfirmedReservation || isAlreadyCheckedIn) {
      return;
    }

    setCheckInError("");
    try {
      await onCheckIn(matchedReservation.id);
      setCheckInCompleted(true);
      setIdentityConfirmed(false);
    } catch {
      setCheckInError("Não foi possível registrar o check-in. Tente novamente.");
    }
  }

  function resetForNextVoucher() {
    stopCamera();
    setCameraStatus("idle");
    setManualCode("");
    setLookupMessage("");
    setMatchedReservationId(null);
    setIdentityConfirmed(false);
    setCheckInCompleted(false);
    setCheckInError("");
  }

  function handleManualCodeChange(value: string) {
    if (["requesting", "scanning", "detected"].includes(cameraStatus)) {
      stopCamera();
      setCameraStatus("idle");
    }
    setManualCode(value);
    setMatchedReservationId(null);
    setLookupMessage("");
    setIdentityConfirmed(false);
    setCheckInCompleted(false);
    setCheckInError("");
  }

  const statusMessage = cameraStatusMessage(cameraStatus);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scanner QR do voucher</DialogTitle>
          <DialogDescription>
            Leia o QR ou digite o código. Confira o passageiro antes de registrar o check-in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Imagem da câmera para leitura do QR"
              className={`aspect-video w-full object-cover ${cameraStatus === "scanning" ? "block" : "hidden"}`}
            />
            {cameraStatus !== "scanning" && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 p-5 text-center">
                <Camera className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  A leitura pela câmera depende do suporte do navegador. A entrada manual fica disponível abaixo.
                </p>
              </div>
            )}
          </div>

          {statusMessage && (
            <div
              role={cameraStatus === "permission-denied" || cameraStatus === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                ["camera-unavailable", "qr-unsupported", "permission-denied", "camera-not-found", "error"].includes(cameraStatus)
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-muted bg-muted/40 text-muted-foreground"
              }`}
            >
              {cameraStatus === "requesting" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              ) : cameraStatus === "scanning" ? (
                <Camera className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={cameraStatus === "scanning" ? "secondary" : "outline"}
              onClick={() => void startCamera()}
              disabled={cameraStatus === "requesting" || cameraStatus === "scanning" || isCheckingIn}
            >
              <Camera className="mr-2 h-4 w-4" />
              {cameraStatus === "requesting" ? "Abrindo câmera…" : cameraStatus === "scanning" ? "Câmera ativa" : "Ativar câmera"}
            </Button>
            {cameraStatus === "scanning" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  stopCamera();
                  setCameraStatus("idle");
                }}
              >
                Parar câmera
              </Button>
            )}
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label htmlFor="voucher-qr-manual-code" className="text-sm font-medium">
              Código do voucher ou número da reserva
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="voucher-qr-manual-code"
                autoComplete="off"
                placeholder="Ex.: VCHR-2026-0001"
                value={manualCode}
                onChange={(event) => handleManualCodeChange(event.target.value)}
              />
              <Button type="submit" className="shrink-0">
                Localizar voucher
              </Button>
            </div>
          </form>

          {lookupMessage && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {lookupMessage}
            </p>
          )}

          {matchedReservation && (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passageiro localizado</p>
                    <p className="mt-1 font-semibold">{matchedReservation.client?.name || "—"}</p>
                    {matchedReservation.client?.whatsapp && (
                      <p className="text-sm text-muted-foreground">{matchedReservation.client.whatsapp}</p>
                    )}
                  </div>
                  {isAlreadyCheckedIn ? (
                    <Badge className="border-green-200 bg-green-100 text-green-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {checkInCompleted ? "Check-in registrado agora" : "Check-in feito"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Clock className="mr-1 h-3 w-3" />
                      Aguardando check-in
                    </Badge>
                  )}
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{matchedReservation.trip?.name || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {matchedReservation.trip?.departureDate
                          ? formatDate(matchedReservation.trip.departureDate)
                          : "Data a confirmar"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Assentos</p>
                      <p className="text-xs text-muted-foreground">{matchedReservation.seats?.join(", ") || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    Reserva: <span className="font-mono font-semibold text-foreground">{matchedReservation.reservationNumber || matchedReservation.voucherCode}</span>
                  </p>
                  {matchedReservation.reservationNumber && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Voucher: <span className="font-mono font-semibold text-foreground">{matchedReservation.voucherCode}</span>
                    </p>
                  )}
                  {time && <p className="mt-1 text-xs text-muted-foreground">Check-in realizado às {time}</p>}
                </div>

                {!isAlreadyCheckedIn && !isConfirmedReservation && (
                  <p role="alert" className="text-sm text-amber-800">
                    Esta reserva não está confirmada. O check-in não pode ser registrado.
                  </p>
                )}

                {!isAlreadyCheckedIn && isConfirmedReservation && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!identityConfirmed ? (
                      <Button type="button" onClick={() => setIdentityConfirmed(true)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Confirmar passageiro
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIdentityConfirmed(false)}
                          disabled={isCheckingIn}
                        >
                          Voltar
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleCheckIn()}
                          disabled={isCheckingIn}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {isCheckingIn ? "Registrando…" : "Registrar check-in"}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {checkInError && <p role="alert" className="text-sm text-destructive">{checkInError}</p>}

                {isAlreadyCheckedIn && (
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" onClick={resetForNextVoucher}>
                      Ler outro voucher
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}