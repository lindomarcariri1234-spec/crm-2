import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Trip } from "@workspace/api-client-react";
import { storeApi } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MapPin, Calendar, Users, Bus, Edit, Trash2, Eye, Copy,
  AlertCircle, ClipboardList, ShoppingBag, Loader2, Clock, Star,
  CheckCircle2, XCircle, UserRound,
} from "lucide-react";
import { Link } from "wouter";
import { STATUS_MAP } from "./constants";
import { formatCurrency, formatDate, generateProductSlug, buildTripProductPayload } from "./utils";
import { TripCountdown, OccupancyBar } from "./TripCountdown";

export function PublishToStoreDialog({ trip, open, onClose }: { trip: Trip; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [existingProductId, setExistingProductId] = useState<string | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!open) return;
    setChecking(true);
    setStoreError(null);
    storeApi.getSettings()
      .then(() => storeApi.getProducts())
      .then((products) => {
        const linked = products.find((p) => p.tripId === trip.id);
        setExistingProductId(linked ? linked.id : null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "";
        if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("not initialized") || msg.toLowerCase().includes("404")) {
          setStoreError("Loja não configurada. Vá em Loja → Configurações para criar sua vitrine antes de publicar.");
        } else {
          setExistingProductId(null);
        }
      })
      .finally(() => setChecking(false));
  }, [open, trip.id]);

  async function publish() {
    setLoading(true);
    try {
      const slug = generateProductSlug(trip.name);
      await storeApi.createProduct({ ...buildTripProductPayload(trip), slug, tripId: trip.id });
      toast({ title: "Publicado na loja!", description: `${trip.name} já está disponível na vitrine.` });
      onClose();
      navigate("/loja/produtos");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao publicar";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function sync() {
    if (!existingProductId) return;
    setLoading(true);
    try {
      await storeApi.updateProduct(existingProductId, buildTripProductPayload(trip));
      toast({ title: "Dados sincronizados com sucesso!", description: `${trip.name} foi atualizado na vitrine com os dados mais recentes.` });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar";
      toast({ title: "Erro ao sincronizar", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function goToProduct() {
    navigate("/loja/produtos");
    onClose();
  }

  const payload = buildTripProductPayload(trip);
  const durationLabel = payload.durationDays
    ? `${payload.durationDays} dia${payload.durationDays > 1 ? "s" : ""}${payload.durationNights ? ` / ${payload.durationNights} noite${payload.durationNights > 1 ? "s" : ""}` : ""}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            {existingProductId ? "Sincronizar com a Loja" : "Publicar na Loja"}
          </DialogTitle>
        </DialogHeader>
        {checking ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : storeError ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{storeError}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button onClick={() => { navigate("/loja/configuracoes"); onClose(); }}>Ir para Configurações</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            {existingProductId && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <ShoppingBag className="w-5 h-5 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">
                  Esta viagem já está publicada. Clique em <strong>Sincronizar Dados</strong> para atualizar o produto com as informações atuais.
                </p>
              </div>
            )}

            {trip.coverImage && (
              <img src={trip.coverImage} alt={trip.name} className="w-full h-36 object-cover rounded-lg" />
            )}

            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{trip.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {trip.destinationCity}, {trip.destinationState}
                  </p>
                </div>
                <span className="text-sm font-bold text-primary whitespace-nowrap">
                  R$ {Number(trip.priceAdult).toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/pessoa</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>
                    {formatDate(trip.departureDate)}
                    {trip.returnDate && ` → ${formatDate(trip.returnDate)}`}
                  </span>
                </div>
                {durationLabel && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{durationLabel}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Users className="w-3 h-3 shrink-0" />
                  <span>{trip.availableSeats} vagas disponíveis</span>
                </div>
                {trip.isFeatured && (
                  <div className="flex items-center gap-1 text-amber-600">
                    <Star className="w-3 h-3 shrink-0" />
                    <span>Destaque na loja</span>
                  </div>
                )}
                {(trip.originCity || trip.originState) && (
                  <div className="flex items-center gap-1 col-span-2">
                    <MapPin className="w-3 h-3 shrink-0 text-blue-500" />
                    <span>Saída de {[trip.originCity, trip.originState].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {trip.departureTime && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Partida: {trip.departureTime}{trip.returnTime ? ` · Volta: ${trip.returnTime}` : ""}</span>
                  </div>
                )}
                {((Number(trip.freeOrganizers) || 0) + (Number(trip.freeGuides) || 0) > 0) && (
                  <div className="flex items-center gap-1 text-emerald-600">
                    <UserRound className="w-3 h-3 shrink-0" />
                    <span>
                      {Number(trip.freeOrganizers) > 0 ? `${trip.freeOrganizers} org.` : ""}
                      {Number(trip.freeOrganizers) > 0 && Number(trip.freeGuides) > 0 ? " · " : ""}
                      {Number(trip.freeGuides) > 0 ? `${trip.freeGuides} guia(s) grátis` : ""}
                    </span>
                  </div>
                )}
              </div>

              {(trip.inclusions?.length > 0 || trip.exclusions?.length > 0) && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                  {trip.inclusions?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-green-700 mb-1">Incluso ({trip.inclusions.length})</p>
                      <ul className="space-y-0.5">
                        {trip.inclusions.slice(0, 4).map((inc, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500 shrink-0 mt-0.5" />
                            <span className="truncate">{inc}</span>
                          </li>
                        ))}
                        {trip.inclusions.length > 4 && (
                          <li className="text-xs text-muted-foreground">+{trip.inclusions.length - 4} itens</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {trip.exclusions?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-red-700 mb-1">Não incluso ({trip.exclusions.length})</p>
                      <ul className="space-y-0.5">
                        {trip.exclusions.slice(0, 4).map((exc, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                            <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-0.5" />
                            <span className="truncate">{exc}</span>
                          </li>
                        ))}
                        {trip.exclusions.length > 4 && (
                          <li className="text-xs text-muted-foreground">+{trip.exclusions.length - 4} itens</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {trip.gallery?.length > 0 && (
                <div className="flex gap-1 pt-1 border-t overflow-x-auto">
                  {trip.gallery.slice(0, 5).map((img, i) => (
                    <img key={i} src={img} alt="" className="w-12 h-12 object-cover rounded shrink-0" />
                  ))}
                  {trip.gallery.length > 5 && (
                    <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0 text-xs text-muted-foreground">
                      +{trip.gallery.length - 5}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!existingProductId && (
              <p className="text-xs text-muted-foreground">
                Todos os dados acima serão publicados automaticamente na sua vitrine pública. Você pode ajustar detalhes adicionais depois em Loja → Produtos.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                {existingProductId ? "Fechar" : "Cancelar"}
              </Button>
              {existingProductId ? (
                <>
                  <Button variant="outline" onClick={goToProduct} disabled={loading}>
                    Ver na Loja
                  </Button>
                  <Button onClick={sync} disabled={loading}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sincronizando...</> : "Sincronizar Dados"}
                  </Button>
                </>
              ) : (
                <Button onClick={publish} disabled={loading}>
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Publicando...</> : "Publicar na Loja"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TripCard({ trip, isVendedor, seatMapEnabled = true, onDelete, onDuplicate, onBoarding }: { trip: Trip; isVendedor?: boolean; seatMapEnabled?: boolean; onDelete: () => void; onDuplicate: () => void; onBoarding: () => void }) {
  const freeCount = (Number(trip.freeOrganizers) || 0) + (Number(trip.freeGuides) || 0);
  const pct = trip.totalCapacity > 0 ? Math.round((trip.reservedSeats + trip.confirmedSeats + freeCount) / trip.totalCapacity * 100) : 0;
  const statusInfo = STATUS_MAP[trip.status] ?? { label: trip.status, color: "bg-gray-100 text-gray-600" };
  const [publishOpen, setPublishOpen] = useState(false);
  return (
    <div className="bg-card border rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative h-36 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
        {trip.coverImage ? <img src={trip.coverImage} alt={trip.name} className="w-full h-full object-cover" /> : <MapPin className="w-12 h-12 text-primary/30" />}
        <div className="absolute top-3 right-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.color}`}>{statusInfo.label}</span></div>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold truncate">{trip.name}</h3>
          {trip.originCity ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span>De: </span>
              <span className="font-medium text-blue-600">{trip.originCity}{trip.originState ? ` (${trip.originState})` : ""}</span>
              <span>→</span>
              <span>{trip.destinationCity}, {trip.destinationState}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{trip.destinationCity}, {trip.destinationState}</p>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Calendar className="w-3 h-3" />
          <span>{formatDate(trip.departureDate)}{trip.departureTime ? ` às ${trip.departureTime}` : ""}</span>
          {trip.returnDate && <><span>—</span><span>{formatDate(trip.returnDate)}{trip.returnTime ? ` às ${trip.returnTime}` : ""}</span></>}
        </div>
        <TripCountdown date={trip.departureDate} />
        <OccupancyBar reserved={trip.reservedSeats} confirmed={trip.confirmedSeats} free={freeCount} total={trip.totalCapacity} />
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-primary">{formatCurrency(trip.priceAdult)}<span className="text-xs text-muted-foreground font-normal">/pessoa</span></span>
          <span className="text-muted-foreground text-xs">{pct}% ocupado</span>
        </div>
        <div className="flex gap-1 pt-1 flex-wrap">
          <Link href={`/trips/${trip.id}/passengers-overview`}>
            <Button variant="outline" size="sm" className="text-xs"><Eye className="w-3 h-3 mr-1" />Visão Geral</Button>
          </Link>
          <Link href={`/trips/${trip.id}/passengers`}>
            <Button variant="outline" size="sm" className="text-xs"><Users className="w-3 h-3 mr-1" />Passageiros</Button>
          </Link>
          <Button variant="outline" size="sm" className="text-xs text-green-700 border-green-200 hover:bg-green-50" onClick={onBoarding} title="Painel de Embarque">
            <ClipboardList className="w-3 h-3 mr-1" />Embarque
          </Button>
          {seatMapEnabled && (
            <Link href={`/trips/${trip.id}/seat-map`}>
              <Button variant="outline" size="sm" className="text-xs"><Bus className="w-3 h-3 mr-1" />Mapa</Button>
            </Link>
          )}
          {!isVendedor && (
            <Link href={`/trips/${trip.id}/edit`}>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Editar"><Edit className="w-4 h-4" /></Button>
            </Link>
          )}
          {!isVendedor && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onDuplicate} title="Duplicar">
              <Copy className="w-4 h-4" />
            </Button>
          )}
          {!isVendedor && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} title="Excluir"><Trash2 className="w-4 h-4" /></Button>}
          {!isVendedor && <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setPublishOpen(true)} title="Publicar na Loja"><ShoppingBag className="w-4 h-4" /></Button>}
        </div>
      </div>
      <PublishToStoreDialog trip={trip} open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}
