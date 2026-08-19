import { useState, useEffect } from "react";
import { localToday } from "@workspace/shared";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreCoupon, StoreProduct, CouponInput } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Tag, Plus, Pencil, Trash2, Loader2, Package, Search } from "lucide-react";

function CouponForm({
  coupon,
  onSave,
  onClose,
}: {
  coupon?: StoreCoupon;
  onSave: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const today = localToday();
  const [form, setForm] = useState<CouponInput>({
    code: coupon?.code ?? "",
    type: (coupon?.type as "percentage" | "fixed" | "free_shipping") ?? "percentage",
    value: coupon?.value ?? "0",
    description: coupon?.description ?? "",
    minPurchaseAmount: coupon?.minPurchaseAmount ?? undefined,
    maxDiscountAmount: coupon?.maxDiscountAmount ?? undefined,
    usageLimit: coupon?.usageLimit ?? undefined,
    applicableProducts: coupon?.applicableProducts ?? [],
    isActive: coupon?.isActive ?? true,
    startsAt: coupon?.startsAt
      ? new Date(coupon.startsAt).toISOString().split("T")[0]
      : today,
    expiresAt: coupon?.expiresAt
      ? new Date(coupon.expiresAt).toISOString().split("T")[0]
      : "",
  });

  useEffect(() => {
    storeApi.getProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  function set(field: string, value: unknown) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  function toggleProduct(id: string) {
    const current = form.applicableProducts ?? [];
    set(
      "applicableProducts",
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
    );
  }

  async function handleSave() {
    if (!form.code) {
      toast({ title: "Código é obrigatório", variant: "destructive" });
      return;
    }
    if (!form.startsAt) {
      toast({ title: "Data de início é obrigatória", variant: "destructive" });
      return;
    }
    if (!form.expiresAt) {
      toast({ title: "Data de validade é obrigatória", variant: "destructive" });
      return;
    }
    if (form.expiresAt <= form.startsAt) {
      toast({ title: "Validade deve ser posterior à data de início", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      if (coupon) {
        await storeApi.updateCoupon(coupon.id, form);
      } else {
        await storeApi.createCoupon(form);
      }
      toast({ title: coupon ? "Cupom atualizado!" : "Cupom criado!" });
      onSave();
    } catch (err: unknown) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const applicableIds = form.applicableProducts ?? [];
  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Código *</Label>
          <Input
            value={form.code}
            onChange={(e) => set("code", e.target.value.toUpperCase())}
            placeholder="DESCONTO10"
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select
            value={form.type}
            onValueChange={(v) => set("type", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Porcentagem (%)</SelectItem>
              <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
              <SelectItem value="free_shipping">Frete Grátis</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{form.type === "percentage" ? "Desconto (%)" : form.type === "free_shipping" ? "Desconto no Frete" : "Desconto (R$)"}</Label>
          <Input
            type="number"
            min="0"
            max={form.type === "percentage" ? 100 : undefined}
            step="0.01"
            value={form.value}
            onChange={(e) => set("value", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Pedido Mínimo (R$)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.minPurchaseAmount ?? ""}
            onChange={(e) =>
              set("minPurchaseAmount", e.target.value || undefined)
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Máx. de Usos</Label>
          <Input
            type="number"
            min="1"
            value={form.usageLimit ?? ""}
            onChange={(e) =>
              set("usageLimit", e.target.value ? parseInt(e.target.value) : undefined)
            }
            placeholder="Ilimitado"
          />
        </div>
        <div className="space-y-2">
          <Label>Válido a partir de</Label>
          <Input
            type="date"
            value={form.startsAt ?? ""}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Validade (expira em)</Label>
          <Input
            type="date"
            value={form.expiresAt ?? ""}
            onChange={(e) => set("expiresAt", e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 col-span-2">
          <Switch
            checked={form.isActive ?? true}
            onCheckedChange={(v) => set("isActive", v)}
          />
          <Label>Ativo</Label>
        </div>
      </div>

      {/* Applicable Products */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Produtos Aplicáveis</Label>
          {applicableIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {applicableIds.length} selecionado(s)
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Deixe em branco para aplicar a todos os produtos.
        </p>
        {products.length > 0 && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Buscar produto..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
              {filteredProducts.map((p) => {
                const selected = applicableIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${
                      selected ? "bg-primary/5" : ""
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        selected ? "bg-primary border-primary" : "border-input"
                      }`}
                    >
                      {selected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M1 6l4 4 6-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate block">{p.name}</span>
                      {p.destination && (
                        <span className="text-xs text-muted-foreground">{p.destination}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      R$ {parseFloat(p.price).toFixed(2)}
                    </span>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  <Package className="w-6 h-6 mx-auto mb-1 opacity-30" />
                  Nenhum produto encontrado
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

export default function LojaCupons() {
  const { toast } = useToast();
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StoreCoupon | undefined>();
  const [showDialog, setShowDialog] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setCoupons(await storeApi.getCoupons());
    } catch (err: unknown) {
      toast({
        title: "Erro ao carregar cupons",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await storeApi.deleteCoupon(id);
      setCoupons((c) => c.filter((x) => x.id !== id));
      toast({ title: "Cupom excluído" });
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  function couponStatus(coupon: StoreCoupon) {
    if (!coupon.isActive) return { label: "Inativo", variant: "secondary" as const };
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date())
      return { label: "Expirado", variant: "destructive" as const };
    if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit)
      return { label: "Esgotado", variant: "destructive" as const };
    return { label: "Ativo", variant: "default" as const };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cupons de Desconto</h1>
          <p className="text-muted-foreground text-sm mt-1">{coupons.length} cupom(ns)</p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setShowDialog(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Cupom
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : coupons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum cupom criado ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead>Mín. Pedido</TableHead>
                <TableHead>Usos</TableHead>
                <TableHead>Produtos</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((coupon) => {
                const status = couponStatus(coupon);
                return (
                  <TableRow key={coupon.id}>
                    <TableCell className="font-mono font-bold text-sm">
                      {coupon.code}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {coupon.type === "percentage"
                        ? `${parseFloat(coupon.value).toFixed(0)}%`
                        : `R$ ${parseFloat(coupon.value).toFixed(2)}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {coupon.minPurchaseAmount
                        ? `R$ ${parseFloat(coupon.minPurchaseAmount).toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {coupon.usageCount}
                      {coupon.usageLimit != null ? ` / ${coupon.usageLimit}` : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {coupon.applicableProducts.length === 0
                        ? "Todos"
                        : `${coupon.applicableProducts.length} produto(s)`}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {coupon.expiresAt
                        ? new Date(coupon.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditing(coupon);
                            setShowDialog(true);
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={deleting === coupon.id}
                          onClick={() => handleDelete(coupon.id)}
                        >
                          {deleting === coupon.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Cupom" : "Novo Cupom"}</DialogTitle>
          </DialogHeader>
          <CouponForm
            coupon={editing}
            onSave={() => {
              setShowDialog(false);
              load();
            }}
            onClose={() => setShowDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
