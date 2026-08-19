import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useGetTrip, useCreateTrip, useUpdateTrip, useListLayouts, useListBoardingLocations, useGetCurrentSubscription, useGetMe } from "@workspace/api-client-react";
import { PlanLimitWall, usePlanLimitError } from "@/components/plan-limit-wall";
import { CoverImageUpload } from "@/components/cover-image-upload";
import { GalleryUpload } from "@/components/gallery-upload";
import { VideoGalleryUpload } from "@/components/video-gallery-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, X, Check, Clock, MapPin, Loader2, Link2, GripVertical, Lock, Camera, AlertTriangle } from "lucide-react";
import { TiptapEditor } from "./TiptapEditor";
import { LayoutMiniPreview, TripCostsTab } from "./TripCostsSection";
import { formatCurrency } from "./utils";
import { TRIP_TYPES, TRIP_TYPE_LABELS, VEHICLE_TYPES, FIXED_COST_CATEGORIES, VARIABLE_COST_CATEGORIES } from "./constants";
import { TRIP_STATUS, hasPermission, RESOURCES, ACTIONS, type TripStatus } from "@workspace/permissions";
import { type TripFormData, EMPTY_FORM, toTripFormData, newBP, newDay } from "./types";
import { TripFormPricesTab } from "./TripFormPricesTab";
import { TripFormTransportTab } from "./TripFormTransportTab";

const TRIP_FORM_API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function TripForm({ tripId }: { tripId?: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const canViewFinancial = me ? hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW) : false;
  const [tab, setTab] = useState("basico");
  const [form, setForm] = useState<TripFormData>(EMPTY_FORM);
  const [memoryPhotos, setMemoryPhotos] = useState<Array<{ id: string; url: string; type: string; caption: string | null; createdAt: string }>>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [showAddPhotoDialog, setShowAddPhotoDialog] = useState(false);
  const [newPhotoUrl, setNewPhotoUrl] = useState<string | undefined>(undefined);
  const [newPhotoCaption, setNewPhotoCaption] = useState("");
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [tripLimitError, setTripLimitError] = useState<{ resource: string; current?: number; limit?: number } | null>(null);
  const [conflictingSeats, setConflictingSeats] = useState<string[]>([]);
  const [seatConflictMessage, setSeatConflictMessage] = useState<string | null>(null);
  const dragItem = useRef<{ list: "inclusions" | "exclusions" | "itinerary"; idx: number } | null>(null);
  const dragOverItem = useRef<number | null>(null);

  function handleDragStart(list: "inclusions" | "exclusions" | "itinerary", idx: number) {
    dragItem.current = { list, idx };
  }

  function handleDragEnter(idx: number) {
    dragOverItem.current = idx;
  }

  function handleDrop(list: "inclusions" | "exclusions" | "itinerary") {
    try {
      if (dragItem.current === null || dragOverItem.current === null) return;
      if (dragItem.current.list !== list) return;
      const from = dragItem.current.idx;
      const to = dragOverItem.current;
      if (from === to) return;
      if (list === "itinerary") {
        setForm(prev => {
          const items = [...prev.itinerary];
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved);
          return { ...prev, itinerary: items.map((d, i) => ({ ...d, day: i + 1 })) };
        });
      } else {
        setForm(prev => {
          const items = [...prev[list]];
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved);
          return { ...prev, [list]: items };
        });
      }
    } finally {
      dragItem.current = null;
      dragOverItem.current = null;
    }
  }

  function handleDragEnd() {
    dragItem.current = null;
    dragOverItem.current = null;
  }

  const { data: subData } = useGetCurrentSubscription();
  const hasSeatMapPlan = ((subData?.plan?.supportedFeatures ?? []) as string[]).includes("seatMap");

  const { data: existingTrip } = useGetTrip(tripId ?? "", { query: { enabled: !!tripId, queryKey: ["/api/trips", tripId] } });
  const { data: layouts = [] } = useListLayouts({ query: { queryKey: ["layouts"] } });
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const isPending = createTrip.isPending || updateTrip.isPending;
  const [isSavingCosts, setIsSavingCosts] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const isUploading = uploadingCount > 0;
  const handleUploadingChange = (uploading: boolean) =>
    setUploadingCount((prev) => (uploading ? prev + 1 : Math.max(0, prev - 1)));

  const EMPTY_NEW_FIXED = { category: "", description: "", customDesc: "", value: "" };
  const EMPTY_NEW_VARIABLE = { category: "", description: "", customDesc: "", valuePax: "" };
  const [newFixed, setNewFixed] = useState(EMPTY_NEW_FIXED);
  const [newVariable, setNewVariable] = useState(EMPTY_NEW_VARIABLE);

  const selectedLayout = layouts.find(l => l.id === form.layoutId) ?? null;
  const { data: boardingLocationsCatalog = [] } = useListBoardingLocations({ query: { queryKey: ["boarding-locations"] } });

  const layoutSeatLabels = useMemo(() => {
    if (!selectedLayout) return undefined;
    const SEAT_TYPES = new Set(["seat", "vip", "accessible"]);
    const seatCells = selectedLayout.cells
      .filter(c => SEAT_TYPES.has(c.type))
      .sort((a, b) => {
        if (a.floor !== b.floor) return a.floor - b.floor;
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
      });
    if (selectedLayout.numberingType === "by_row") {
      const labels: string[] = [];
      const rowGroups = new Map<string, typeof seatCells>();
      for (const cell of seatCells) {
        const key = `${cell.floor}-${cell.row}`;
        if (!rowGroups.has(key)) rowGroups.set(key, []);
        rowGroups.get(key)!.push(cell);
      }
      const isMultiFloor = selectedLayout.floors > 1;
      for (const [key, group] of rowGroups) {
        const [floor, row] = key.split("-").map(Number);
        group.sort((a, b) => a.col - b.col);
        group.forEach((cell, i) => {
          const floorPfx = isMultiFloor ? `A${floor}-` : "";
          labels.push(cell.label ?? `${floorPfx}${row}${String.fromCharCode(65 + i)}`);
        });
      }
      return labels;
    }
    return seatCells.map((cell, i) => cell.label ?? String(i + 1));
  }, [selectedLayout]);

  useEffect(() => {
    if (!existingTrip || !tripId) return;
    setForm(toTripFormData(existingTrip));
  }, [existingTrip?.id, tripId]);

  useEffect(() => {
    if (!selectedLayout) return;
    setForm(prev => ({ ...prev, totalCapacity: String(selectedLayout.seatCount) }));
  }, [form.layoutId, selectedLayout?.seatCount]);

  useEffect(() => {
    if (!tripId) return;
    setLoadingMedia(true);
    fetch(`${TRIP_FORM_API_BASE}/api/trips/${tripId}/media`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setMemoryPhotos(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingMedia(false));
  }, [tripId]);

  const set = (k: keyof TripFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  const setVal = (k: keyof TripFormData) => (v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const cap = parseInt(form.totalCapacity || "0");
  const grossRevenue = parseFloat(form.priceAdult || "0") * cap;
  const totalFixed = form.fixedCostItems.reduce((s, c) => s + c.value, 0);
  const totalVariablePax = form.variableCostItems.reduce((s, c) => s + c.valuePax, 0);
  const totalVariable = totalVariablePax * cap;
  const totalOperational = totalFixed + totalVariable;
  const costPerPax = cap > 0 ? totalOperational / cap : 0;
  const profit = grossRevenue - totalOperational;
  const marginPct = grossRevenue > 0 ? Math.round(profit / grossRevenue * 100) : 0;

  const handleSave = async (publish = false) => {
    if (!form.name || !form.destination || !form.destinationCity || !form.destinationState || !form.departureDate || !form.priceAdult) {
      toast({ title: "Preencha os campos obrigatórios: nome, destino, cidade, estado, data de saída e preço adulto", variant: "destructive" });
      return;
    }
    // Clear any previous seat conflict state before saving
    setConflictingSeats([]);
    setSeatConflictMessage(null);
    const statusToSave: TripStatus = publish ? TRIP_STATUS.ACTIVE : form.status;
    const itineraryToSave = form.itinerary.filter(d => d.title || d.description);
    const boardingPointsToSave = form.boardingPoints.filter(bp => bp.name);
    const freePassengersPayload = form.freePassengers.map(fp => ({
      id: fp.id,
      name: fp.name,
      cpf: fp.cpf,
      whatsapp: fp.whatsapp,
      role: fp.role,
      seatNumber: fp.seatNumber.trim() || null,
      checkedInAt: fp.checkedInAt ?? null,
    }));
    try {
      if (tripId) {
        await updateTrip.mutateAsync({
          id: tripId,
          data: {
            name: form.name, description: form.description || undefined,
            destination: form.destination, destinationCity: form.destinationCity, destinationState: form.destinationState,
            originCity: form.originCity || undefined, originState: form.originState || undefined,
            type: form.type, category: form.category,
            departureDate: form.departureDate, returnDate: form.returnDate || undefined,
            departureTime: form.departureTime || undefined, returnTime: form.returnTime || undefined,
            totalCapacity: parseInt(form.totalCapacity),
            priceAdult: parseFloat(form.priceAdult),
            priceChild: form.priceChild ? parseFloat(form.priceChild) : undefined,
            priceSenior: form.priceSenior ? parseFloat(form.priceSenior) : undefined,
            inclusions: form.inclusions.filter(Boolean), exclusions: form.exclusions.filter(Boolean),
            coverImage: form.coverImage || undefined,
            seatLayout: form.layoutId ? undefined : form.seatLayout,
            layoutId: form.layoutId || null,
            vehicleType: form.vehicleType || undefined, vehiclePlate: form.vehiclePlate || undefined, driverName: form.driverName || undefined, tourGuide: form.tourGuide || undefined, tripOrganizer: form.tripOrganizer || undefined,
            driver1Cpf: form.driver1Cpf || null, driver1Cnh: form.driver1Cnh || null, driver1CnhCategory: form.driver1CnhCategory || null, driver1CnhExpiry: form.driver1CnhExpiry || null,
            driver2Name: form.driver2Name || null, driver2Cpf: form.driver2Cpf || null, driver2Cnh: form.driver2Cnh || null, driver2CnhCategory: form.driver2CnhCategory || null, driver2CnhExpiry: form.driver2CnhExpiry || null,
            tourGuideCpf: form.tourGuideCpf || null, tourGuideRegistration: form.tourGuideRegistration || null,
            ...(hasSeatMapPlan ? { showSeatMap: form.showSeatMap } : {}),
            status: statusToSave,
            itinerary: itineraryToSave.length ? itineraryToSave : undefined,
            boardingPoints: boardingPointsToSave.length ? boardingPointsToSave : undefined,
            fixedCosts: form.fixedCostItems,
            variableCosts: form.variableCostItems,
            gallery: form.gallery.length ? form.gallery : undefined,
            videos: form.videos.length ? form.videos : undefined,
            freePassengers: freePassengersPayload,
          },
        });
      } else {
        await createTrip.mutateAsync({
          data: {
            name: form.name, description: form.description || undefined,
            destination: form.destination, destinationCity: form.destinationCity, destinationState: form.destinationState,
            originCity: form.originCity || undefined, originState: form.originState || undefined,
            type: form.type, category: form.category,
            departureDate: form.departureDate, returnDate: form.returnDate || undefined,
            departureTime: form.departureTime || undefined, returnTime: form.returnTime || undefined,
            totalCapacity: parseInt(form.totalCapacity),
            priceAdult: parseFloat(form.priceAdult),
            priceChild: form.priceChild ? parseFloat(form.priceChild) : undefined,
            priceSenior: form.priceSenior ? parseFloat(form.priceSenior) : undefined,
            inclusions: form.inclusions.filter(Boolean), exclusions: form.exclusions.filter(Boolean),
            coverImage: form.coverImage || undefined,
            seatLayout: form.layoutId ? undefined : form.seatLayout,
            layoutId: form.layoutId || null,
            vehicleType: form.vehicleType || undefined, vehiclePlate: form.vehiclePlate || undefined, driverName: form.driverName || undefined, tourGuide: form.tourGuide || undefined, tripOrganizer: form.tripOrganizer || undefined,
            driver1Cpf: form.driver1Cpf || null, driver1Cnh: form.driver1Cnh || null, driver1CnhCategory: form.driver1CnhCategory || null, driver1CnhExpiry: form.driver1CnhExpiry || null,
            driver2Name: form.driver2Name || null, driver2Cpf: form.driver2Cpf || null, driver2Cnh: form.driver2Cnh || null, driver2CnhCategory: form.driver2CnhCategory || null, driver2CnhExpiry: form.driver2CnhExpiry || null,
            tourGuideCpf: form.tourGuideCpf || null, tourGuideRegistration: form.tourGuideRegistration || null,
            ...(hasSeatMapPlan ? { showSeatMap: form.showSeatMap } : {}),
            status: statusToSave,
            itinerary: itineraryToSave.length ? itineraryToSave : undefined,
            boardingPoints: boardingPointsToSave.length ? boardingPointsToSave : undefined,
            fixedCosts: form.fixedCostItems,
            variableCosts: form.variableCostItems,
            gallery: form.gallery.length ? form.gallery : undefined,
            videos: form.videos.length ? form.videos : undefined,
          },
        });
      }
      navigate("/trips");
    } catch (err: unknown) {
      const responseData = (err as { data?: Record<string, unknown> })?.data
        ?? (err as { response?: { data?: Record<string, unknown> } })?.response?.data
        ?? {};
      const limitInfo = usePlanLimitError(responseData);
      if (limitInfo.isLimitError) {
        setTripLimitError({ resource: limitInfo.resource ?? "trips", current: limitInfo.current, limit: limitInfo.limit });
        return;
      }
      // Handle seat conflict from freePassengers
      if (responseData["code"] === "SEAT_CONFLICT") {
        const seats = (responseData["conflictingSeats"] as string[] | undefined) ?? [];
        setConflictingSeats(seats);
        const seatList = seats.join(", ");
        const conflictMsg = seats.length > 0
          ? `Os assentos ${seatList} já estão ocupados por reservas ativas. Escolha outros assentos.`
          : "Um ou mais assentos estão ocupados por reservas ativas. Escolha outros assentos.";
        setSeatConflictMessage(conflictMsg);
        setTab("transporte");
        toast({ title: conflictMsg, variant: "destructive" });
        return;
      }
      const msg = (responseData["error"] as string)
        || (err as { message?: string })?.message
        || "Erro ao salvar viagem";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleSaveCosts = async () => {
    if (!tripId) return;
    setIsSavingCosts(true);
    try {
      await updateTrip.mutateAsync({
        id: tripId,
        data: {
          fixedCosts: form.fixedCostItems,
          variableCosts: form.variableCostItems,
        },
      });
      toast({ title: "Custos salvos com sucesso" });
    } catch {
      toast({ title: "Erro ao salvar custos", variant: "destructive" });
    } finally {
      setIsSavingCosts(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await fetch(`${TRIP_FORM_API_BASE}/api/trips/${tripId}/media/${photoId}`, { method: "DELETE", credentials: "include" });
      setMemoryPhotos(prev => prev.filter(p => p.id !== photoId));
      toast({ title: "Foto removida" });
    } catch {
      toast({ title: "Erro ao remover foto", variant: "destructive" });
    }
  };

  const handleSavePhoto = async () => {
    if (!newPhotoUrl || !tripId) return;
    setSavingPhoto(true);
    try {
      const res = await fetch(`${TRIP_FORM_API_BASE}/api/trips/${tripId}/media`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newPhotoUrl, type: "image", caption: newPhotoCaption.trim() || undefined }),
      });
      const newPhoto = await res.json();
      setMemoryPhotos(prev => [...prev, newPhoto]);
      setShowAddPhotoDialog(false);
      setNewPhotoUrl(undefined);
      setNewPhotoCaption("");
      toast({ title: "Foto adicionada ao álbum!" });
    } catch {
      toast({ title: "Erro ao salvar foto", variant: "destructive" });
    } finally {
      setSavingPhoto(false);
    }
  };

  const TABS = [
    { id: "basico", label: "Informações Básicas" },
    { id: "precos", label: "Preços" },
    { id: "pontos", label: "Pontos de Embarque" },
    { id: "roteiro", label: "Roteiro" },
    { id: "inclusoes", label: "Inclusões / Exclusões" },
    { id: "transporte", label: "Transporte e Hospedagem" },
    { id: "midia", label: "Mídia" },
    ...(tripId && canViewFinancial ? [{ id: "custos", label: "Custos" }] : []),
  ];

  const canSave = !!form.name && !!form.destination && !!form.destinationCity && !!form.destinationState && !!form.departureDate && !!form.priceAdult;

  if (tripLimitError) {
    return (
      <div className="space-y-4 max-w-4xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/trips")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-2xl font-bold tracking-tight">Nova Viagem</h1>
        </div>
        <PlanLimitWall
          resource={tripLimitError.resource as "clients" | "users" | "trips"}
          current={tripLimitError.current}
          limit={tripLimitError.limit}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/trips")}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tripId ? "Editar Viagem" : "Nova Viagem"}</h1>
          <p className="text-muted-foreground text-sm">{tripId ? "Atualize as informações da viagem" : "Preencha as informações para criar uma nova viagem"}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {TABS.map(t => <TabsTrigger key={t.id} value={t.id} className="text-xs">{t.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="basico" className="space-y-4 mt-6">
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <div className="space-y-2">
              <Label>Nome da Viagem *</Label>
              <Input placeholder="Ex: Maravilhas do Nordeste" value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <TiptapEditor value={form.description} onChange={v => setForm(prev => ({ ...prev, description: v }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cidade de Origem</Label>
                <Input placeholder="São Paulo" value={form.originCity} onChange={set("originCity")} />
              </div>
              <div className="space-y-2">
                <Label>Estado (UF) de Origem</Label>
                <Input placeholder="SP" maxLength={2} value={form.originState} onChange={set("originState")} />
              </div>
              <div className="space-y-2">
                <Label>Destino / Título *</Label>
                <Input placeholder="Nordeste Brasileiro" value={form.destination} onChange={set("destination")} />
              </div>
              <div className="space-y-2">
                <Label>Cidade de Destino *</Label>
                <Input placeholder="Natal" value={form.destinationCity} onChange={set("destinationCity")} />
              </div>
              <div className="space-y-2">
                <Label>Estado (UF) de Destino *</Label>
                <Input placeholder="RN" maxLength={2} value={form.destinationState} onChange={set("destinationState")} />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={setVal("type")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {form.type && !TRIP_TYPES.includes(form.type) && <SelectItem value={form.type}>{TRIP_TYPE_LABELS[form.type] ?? form.type}</SelectItem>}
                    {TRIP_TYPES.map(t => <SelectItem key={t} value={t}>{TRIP_TYPE_LABELS[t] ?? t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data de Saída *</Label>
                <Input type="date" value={form.departureDate} onChange={set("departureDate")} />
              </div>
              <div className="space-y-2">
                <Label>Horário de Saída</Label>
                <Input type="time" value={form.departureTime} onChange={set("departureTime")} />
              </div>
              <div className="space-y-2">
                <Label>Data de Retorno</Label>
                <Input type="date" value={form.returnDate} onChange={set("returnDate")} />
              </div>
              <div className="space-y-2">
                <Label>Horário de Retorno</Label>
                <Input type="time" value={form.returnTime} onChange={set("returnTime")} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Layout de Assentos</Label>
                <Select
                  value={form.layoutId || `__std_${form.seatLayout}`}
                  onValueChange={v => {
                    if (v.startsWith("__std_")) {
                      setForm(prev => ({ ...prev, layoutId: "", seatLayout: v.replace("__std_", "") }));
                    } else {
                      setForm(prev => ({ ...prev, layoutId: v }));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione um layout..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__std_2x2">Padrão 2x2 (automático)</SelectItem>
                    <SelectItem value="__std_2x1">Premium 2x1 (automático)</SelectItem>
                    {layouts.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-t mt-1 pt-2">
                          Layouts personalizados
                        </div>
                        {layouts.map(l => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name} — {l.seatCount} assentos
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {selectedLayout && (
                  <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0">
                        <LayoutMiniPreview cells={selectedLayout.cells} rows={selectedLayout.rows} cols={selectedLayout.cols} />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <p className="font-medium text-indigo-800 truncate">✓ {selectedLayout.name}</p>
                        <p className="text-indigo-600 text-xs">
                          {selectedLayout.rows} fil. × {selectedLayout.cols} col. · {selectedLayout.seatCount} assentos
                        </p>
                        <p className="text-indigo-500 text-xs">
                          {selectedLayout.floors > 1 ? `${selectedLayout.floors} andares · ` : ""}
                          Numeração: {selectedLayout.numberingType === "by_row" ? "por fileira" : "sequencial"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Capacidade Total (assentos) *</Label>
                <Input
                  type="number" min="1" max="500"
                  value={form.totalCapacity}
                  onChange={set("totalCapacity")}
                  disabled={!!selectedLayout}
                  title={selectedLayout ? "Calculado automaticamente a partir do layout" : undefined}
                />
                {selectedLayout && (
                  <p className="text-xs text-muted-foreground">Calculado automaticamente ({selectedLayout.seatCount} assentos)</p>
                )}
              </div>
              {hasSeatMapPlan ? (
                <div className="col-span-2">
                  <div className="flex items-center gap-4 p-4 border rounded-lg bg-card">
                    <Switch
                      id="showSeatMap"
                      checked={form.showSeatMap}
                      onCheckedChange={v => setForm(prev => ({ ...prev, showSeatMap: v }))}
                    />
                    <div>
                      <Label htmlFor="showSeatMap" className="cursor-pointer font-medium">Exibir mapa de assentos na vitrine</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {form.showSeatMap
                          ? "Passageiros escolherão seus assentos durante a reserva."
                          : "Assentos serão atribuídos automaticamente em ordem de chegada."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="col-span-2">
                  <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/40">
                    <Lock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-muted-foreground">Exibir mapa de assentos na vitrine</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Disponível no plano Pro.{" "}
                        <button
                          type="button"
                          className="text-primary underline hover:text-primary/80"
                          onClick={() => navigate("/configuracoes?tab=plan")}
                        >
                          Fazer upgrade
                        </button>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="precos" className="space-y-4 mt-6">
          <TripFormPricesTab
            form={form} setForm={setForm}
            newFixed={newFixed} setNewFixed={setNewFixed}
            newVariable={newVariable} setNewVariable={setNewVariable}
            tripId={tripId}
            isSavingCosts={isSavingCosts} isPending={isPending}
            handleSaveCosts={handleSaveCosts}
          />
        </TabsContent>

        <TabsContent value="pontos" className="space-y-4 mt-6">
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Pontos de Embarque</h3>
                <p className="text-sm text-muted-foreground">Selecione do catálogo e defina o horário de cada ponto para esta viagem.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setForm(prev => ({ ...prev, boardingPoints: [...prev.boardingPoints, newBP()] }))}>
                <Plus className="w-4 h-4 mr-1" />Adicionar Ponto
              </Button>
            </div>
            {boardingLocationsCatalog.length === 0 && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
                Nenhum local cadastrado no catálogo. <a href="/cadastros/locais-embarque" className="underline text-primary">Cadastre locais de embarque</a> para selecioná-los aqui.
              </p>
            )}
            <div className="space-y-3">
              {form.boardingPoints.map((bp, idx) => {
                const updateBP = (patch: Partial<typeof bp>) =>
                  setForm(prev => ({ ...prev, boardingPoints: prev.boardingPoints.map(b => b.id === bp.id ? { ...b, ...patch } : b) }));
                const selectedLoc = boardingLocationsCatalog.find(l => l.id === bp.boardingLocationId);
                return (
                  <div key={bp.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Ponto {idx + 1}</span>
                      {form.boardingPoints.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setForm(prev => ({ ...prev, boardingPoints: prev.boardingPoints.filter(b => b.id !== bp.id) }))}>
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Local de Embarque</Label>
                        {boardingLocationsCatalog.length > 0 ? (
                          <div className="space-y-2">
                            <Select
                              value={bp.boardingLocationId ?? ""}
                              onValueChange={val => {
                                if (val === "__adhoc__") {
                                  updateBP({ boardingLocationId: undefined, name: "", address: "" });
                                  return;
                                }
                                const loc = boardingLocationsCatalog.find(l => l.id === val);
                                if (!loc) return;
                                updateBP({
                                  boardingLocationId: loc.id,
                                  name: loc.name,
                                  address: [loc.address, loc.reference].filter(Boolean).join(" — "),
                                  time: bp.time || loc.departureTime || "",
                                });
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Selecionar do catálogo..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__adhoc__">— Ponto ad-hoc (preencher manualmente) —</SelectItem>
                                {boardingLocationsCatalog.map(loc => (
                                  <SelectItem key={loc.id} value={loc.id}>
                                    {loc.name} — {loc.city}/{loc.state.toUpperCase()}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedLoc && (
                              <div className="flex items-center gap-2 px-2 py-1 bg-teal-50 border border-teal-200 rounded-md text-xs text-teal-700">
                                <Link2 className="w-3 h-3 shrink-0" />
                                <span className="flex-1 truncate font-medium">{selectedLoc.name} — {selectedLoc.city}/{selectedLoc.state.toUpperCase()}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 px-1.5 text-xs text-teal-700 hover:text-destructive hover:bg-transparent"
                                  onClick={() => updateBP({ boardingLocationId: undefined })}
                                >
                                  Limpar
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Input placeholder="Terminal Rodoviário" value={bp.name} onChange={e => updateBP({ name: e.target.value })} />
                        )}
                      </div>
                      {(boardingLocationsCatalog.length === 0 || !bp.boardingLocationId) && (
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs">Nome do Ponto</Label>
                          <Input placeholder="Terminal Rodoviário" value={bp.name} onChange={e => updateBP({ name: e.target.value })} />
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">Horário nesta viagem</Label>
                        <Input type="time" value={bp.time ?? ""} onChange={e => updateBP({ time: e.target.value })} />
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Endereço / Referência</Label>
                        <Input placeholder="Av. Principal, 100 — Em frente ao posto Shell" value={bp.address ?? ""} onChange={e => updateBP({ address: e.target.value })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="roteiro" className="space-y-4 mt-6">
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Roteiro por Dia</h3>
              <Button size="sm" variant="outline" onClick={() => setForm(prev => ({ ...prev, itinerary: [...prev.itinerary, newDay(prev.itinerary.length + 1)] }))}>
                <Plus className="w-4 h-4 mr-1" />Adicionar Dia
              </Button>
            </div>
            <div className="space-y-3">
              {form.itinerary.map((day, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-4 space-y-3"
                  draggable
                  onDragStart={() => handleDragStart("itinerary", idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop("itinerary")}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
                      <span className="text-sm font-semibold">Dia {day.day}</span>
                    </div>
                    {form.itinerary.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setForm(prev => ({ ...prev, itinerary: prev.itinerary.filter((_, i) => i !== idx).map((d, i) => ({ ...d, day: i + 1 })) }))}>
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input placeholder="Título do dia (ex: Chegada em Natal)" value={day.title} onChange={e => setForm(prev => ({ ...prev, itinerary: prev.itinerary.map((d, i) => i === idx ? { ...d, title: e.target.value } : d) }))} />
                    <Textarea placeholder="Descreva as atividades do dia..." rows={3} value={day.description} onChange={e => setForm(prev => ({ ...prev, itinerary: prev.itinerary.map((d, i) => i === idx ? { ...d, description: e.target.value } : d) }))} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="inclusoes" className="space-y-4 mt-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <h3 className="font-semibold">O que está incluso</h3>
              </div>
              <div className="space-y-2">
                {form.inclusions.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2"
                    draggable
                    onDragStart={() => handleDragStart("inclusions", i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop("inclusions")}
                    onDragEnd={handleDragEnd}
                  >
                    <GripVertical className="w-4 h-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
                    <Input
                      value={item}
                      onChange={e => {
                        const next = [...form.inclusions];
                        next[i] = e.target.value;
                        setForm(prev => ({ ...prev, inclusions: next }));
                      }}
                      placeholder="Descrever item..."
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setForm(prev => ({ ...prev, inclusions: prev.inclusions.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => setForm(prev => ({ ...prev, inclusions: [...prev.inclusions, ""] }))}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  Adicionar item
                </Button>
              </div>
            </div>
            <div className="bg-card border rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-2">
                <X className="w-4 h-4 text-red-600" />
                <h3 className="font-semibold">O que não está incluso</h3>
              </div>
              <div className="space-y-2">
                {form.exclusions.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2"
                    draggable
                    onDragStart={() => handleDragStart("exclusions", i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop("exclusions")}
                    onDragEnd={handleDragEnd}
                  >
                    <GripVertical className="w-4 h-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing" />
                    <Input
                      value={item}
                      onChange={e => {
                        const next = [...form.exclusions];
                        next[i] = e.target.value;
                        setForm(prev => ({ ...prev, exclusions: next }));
                      }}
                      placeholder="Descrever item..."
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setForm(prev => ({ ...prev, exclusions: prev.exclusions.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => setForm(prev => ({ ...prev, exclusions: [...prev.exclusions, ""] }))}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  Adicionar item
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="transporte" className="space-y-4 mt-6">
          <TripFormTransportTab
            form={form}
            setForm={setForm}
            conflictingSeats={conflictingSeats}
            seatConflictMessage={seatConflictMessage}
          />
        </TabsContent>

        <TabsContent value="midia" className="space-y-4 mt-6">
          <div className="bg-card border rounded-lg p-6 space-y-6">
            <div className="space-y-3">
              <h3 className="font-semibold">Imagem de Capa</h3>
              <p className="text-xs text-muted-foreground">Envie 1 imagem para a capa da viagem (PNG, JPG, WEBP · máx. 4 MB)</p>
              <CoverImageUpload
                value={form.coverImage}
                onChange={(url) => setForm(prev => ({ ...prev, coverImage: url }))}
                onUploadingChange={handleUploadingChange}
                disabled={isPending}
                objectFit="cover"
              />
            </div>
            <div className="border-t pt-5 space-y-3">
              <h3 className="font-semibold">Galeria de Imagens</h3>
              <p className="text-xs text-muted-foreground">Envie até 3 imagens para a galeria da viagem (PNG, JPG, WEBP · máx. 4 MB cada)</p>
              <GalleryUpload
                value={form.gallery}
                onChange={(urls) => setForm(prev => ({ ...prev, gallery: urls }))}
                onUploadingChange={handleUploadingChange}
                disabled={isPending}
              />
            </div>
            <div className="border-t pt-5 space-y-3">
              <h3 className="font-semibold">Vídeos da Viagem</h3>
              <p className="text-xs text-muted-foreground">Envie até 3 vídeos da viagem (MP4, WebM, MOV · máx. 128 MB cada)</p>
              <VideoGalleryUpload
                value={form.videos}
                onChange={(urls) => setForm(prev => ({ ...prev, videos: urls }))}
                onUploadingChange={handleUploadingChange}
                disabled={isPending}
              />
            </div>
            {tripId && (
              <div className="border-t pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Fotos de Memórias do Portal</h3>
                    <p className="text-xs text-muted-foreground">Fotos que aparecem no álbum de memórias dos clientes desta viagem</p>
                  </div>
                  <Button size="sm" variant="outline" type="button" onClick={() => setShowAddPhotoDialog(true)}>
                    <Camera className="w-4 h-4 mr-1" />Adicionar Foto
                  </Button>
                </div>
                {loadingMedia ? (
                  <div className="grid grid-cols-4 gap-2">
                    {[1,2,3,4].map(i => <Skeleton key={i} className="aspect-square rounded-md" />)}
                  </div>
                ) : memoryPhotos.length === 0 ? (
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <Camera className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">Nenhuma foto. Clique em "Adicionar Foto" para incluir imagens no álbum de memórias.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {memoryPhotos.map(photo => (
                      <div key={photo.id} className="relative group aspect-square">
                        <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover rounded-md border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDeletePhoto(photo.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                        {photo.caption && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] p-1 truncate rounded-b-md opacity-0 group-hover:opacity-100 transition-opacity">
                            {photo.caption}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <Dialog open={showAddPhotoDialog} onOpenChange={setShowAddPhotoDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Foto de Memória</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <CoverImageUpload
                  value={newPhotoUrl ?? ""}
                  onChange={(url) => setNewPhotoUrl(url)}
                  onUploadingChange={(u) => setAddingPhoto(u)}
                  disabled={addingPhoto || savingPhoto}
                  objectFit="cover"
                  tripId={tripId}
                  caption={newPhotoCaption}
                  onMediaCreated={(media) => {
                    // File upload with tripId: record already persisted by the server
                    // (caption included). Add to list and close the dialog immediately.
                    setMemoryPhotos(prev => [...prev, media]);
                    setShowAddPhotoDialog(false);
                    setNewPhotoUrl(undefined);
                    setNewPhotoCaption("");
                    toast({ title: "Foto adicionada ao álbum!" });
                  }}
                />
                <div className="space-y-1">
                  <Label className="text-xs">Legenda (opcional)</Label>
                  <Input
                    placeholder="Ex: Vista do pôr do sol na praia"
                    value={newPhotoCaption}
                    onChange={(e) => setNewPhotoCaption(e.target.value)}
                    maxLength={200}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => { setShowAddPhotoDialog(false); setNewPhotoUrl(undefined); setNewPhotoCaption(""); }}>Cancelar</Button>
                <Button type="button" disabled={!newPhotoUrl || addingPhoto || savingPhoto} onClick={handleSavePhoto}>
                  {savingPhoto ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {tripId && canViewFinancial && (
          <TabsContent value="custos" className="space-y-4 mt-6">
            <TripCostsTab tripId={tripId} />
          </TabsContent>
        )}
      </Tabs>

      <div className="flex items-center justify-between bg-card border rounded-lg p-4">
        <Button variant="ghost" onClick={() => navigate("/trips")}>Cancelar</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={isPending || isUploading || !canSave}>
            {isPending ? "Salvando..." : "Salvar como Rascunho"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={isPending || isUploading || !canSave}>
            {isPending ? "Publicando..." : isUploading ? "Aguardando upload..." : "Publicar Viagem"}
          </Button>
        </div>
      </div>
    </div>
  );
}
