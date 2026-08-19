import { useState } from "react";
import {
  useListSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  useListExpenses,
} from "@workspace/api-client-react";
import type { Supplier, CreateSupplierBody, UpdateSupplierBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Eye } from "lucide-react";
import { formatCurrencyBRL as formatCurrency } from "@/lib/utils";

const SUPPLIER_TYPES = ["Transporte", "Hospedagem", "Alimentação", "Guia", "Seguro", "Outro"];
const BANK_OPTIONS = ["Nubank", "Bradesco", "Itaú", "Santander", "Caixa", "BB", "Sicoob", "Outro"];
const PIX_TYPES = ["CPF/CNPJ", "E-mail", "Telefone", "Chave aleatória"];
const STATUS_OPTIONS = ["active", "inactive"];


const statusLabel: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
};


const expenseStatusLabel: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  overdue: "Vencido",
  cancelled: "Cancelado",
};

function SupplierDetailModal({
  supplier,
  open,
  onClose,
}: {
  supplier: Supplier | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: expensesData } = useListExpenses({ limit: 200 });
  const expenses = (expensesData?.data ?? []).filter((e) => e.supplierId === supplier?.id);

  if (!supplier) return null;

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const pixType = supplier.pixType;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{supplier.name}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="info">
          <TabsList className="mb-4">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="bank">Dados Bancários</TabsTrigger>
            <TabsTrigger value="expenses">
              Despesas {expenses.length > 0 && `(${expenses.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Tipo</p>
                <p className="font-medium">{supplier.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">CNPJ</p>
                <p className="font-medium font-mono">{supplier.cnpj ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Contato</p>
                <p className="font-medium">{supplier.contactName ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">E-mail</p>
                <p className="font-medium">{supplier.email ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">WhatsApp</p>
                <p className="font-medium">{supplier.whatsapp ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Cidade/UF</p>
                <p className="font-medium">
                  {supplier.addressCity && supplier.addressState
                    ? `${supplier.addressCity}/${supplier.addressState}`
                    : supplier.addressCity ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Chave PIX</p>
                <p className="font-medium font-mono">{supplier.pixKey ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <Badge variant={supplier.status === "active" ? "default" : "secondary"}>
                  {statusLabel[supplier.status] ?? supplier.status}
                </Badge>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bank" className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Banco</p>
                <p className="font-medium">{supplier.bankName ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Agência</p>
                <p className="font-medium font-mono">{supplier.bankAgency ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Conta</p>
                <p className="font-medium font-mono">{supplier.bankAccount ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Tipo de chave PIX</p>
                <p className="font-medium">{pixType ?? "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">Chave PIX</p>
                <p className="font-medium font-mono">{supplier.pixKey ?? "—"}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="expenses">
            {expenses.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                Nenhuma despesa vinculada a este fornecedor
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{expenses.length} despesa(s)</span>
                  <span className="font-bold">Total: {formatCurrency(totalExpenses)}</span>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-sm">{e.description}</TableCell>
                          <TableCell className="text-sm">{e.category}</TableCell>
                          <TableCell className="text-sm">
                            {new Date(e.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{formatCurrency(e.amount)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                e.status === "paid"
                                  ? "default"
                                  : e.status === "overdue"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="text-xs"
                            >
                              {expenseStatusLabel[e.status] ?? e.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Fornecedores() {
  const { toast } = useToast();
  const { data: suppliers = [], refetch } = useListSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<CreateSupplierBody & UpdateSupplierBody & { bankName?: string; bankAgency?: string; bankAccount?: string; pixType?: string }>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);

  const filtered = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.cnpj ?? "").includes(search) ||
      (s.addressCity ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditing(null);
    setForm({});
    setModalOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contactName: s.contactName ?? "",
      email: s.email ?? "",
      pixKey: s.pixKey ?? "",
      status: s.status,
      bankName: s.bankName ?? "",
      bankAgency: s.bankAgency ?? "",
      bankAccount: s.bankAccount ?? "",
      pixType: s.pixType ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateSupplier.mutateAsync({ id: editing.id, data: {
          name: form.name ?? undefined,
          status: form.status ?? undefined,
          contactName: form.contactName ?? undefined,
          email: form.email ?? undefined,
          pixKey: form.pixKey ?? undefined,
          pixType: form.pixType ?? undefined,
          bankName: form.bankName ?? undefined,
          bankAgency: form.bankAgency ?? undefined,
          bankAccount: form.bankAccount ?? undefined,
        } as UpdateSupplierBody });
        toast({ title: "Fornecedor atualizado" });
      } else {
        if (!form.name || !(form as CreateSupplierBody).type) {
          toast({ title: "Preencha nome e tipo", variant: "destructive" });
          return;
        }
        await createSupplier.mutateAsync({ data: {
          name: form.name!,
          type: (form as CreateSupplierBody).type!,
          cnpj: (form as CreateSupplierBody).cnpj ?? undefined,
          contactName: form.contactName ?? undefined,
          email: form.email ?? undefined,
          whatsapp: (form as CreateSupplierBody).whatsapp ?? undefined,
          addressCity: (form as CreateSupplierBody).addressCity ?? undefined,
          addressState: (form as CreateSupplierBody).addressState ?? undefined,
          pixKey: form.pixKey ?? undefined,
          pixType: form.pixType ?? undefined,
          bankName: form.bankName ?? undefined,
          bankAgency: form.bankAgency ?? undefined,
          bankAccount: form.bankAccount ?? undefined,
        } as CreateSupplierBody });
        toast({ title: "Fornecedor criado" });
      }
      setModalOpen(false);
      refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro ao salvar fornecedor";
      toast({ title: msg, variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSupplier.mutateAsync({ id });
      toast({ title: "Fornecedor excluído" });
      setDeleteId(null);
      refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message
        || "Erro ao excluir";
      toast({ title: msg, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fornecedores</h1>
          <p className="text-sm text-muted-foreground">{suppliers.length} fornecedor(es) cadastrado(s)</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Fornecedor
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome, CNPJ, cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>PIX</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                  Nenhum fornecedor encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.type}</TableCell>
                  <TableCell>{s.cnpj ?? "—"}</TableCell>
                  <TableCell>{s.contactName ?? "—"}</TableCell>
                  <TableCell>{s.whatsapp ?? "—"}</TableCell>
                  <TableCell>
                    {s.addressCity && s.addressState
                      ? `${s.addressCity}/${s.addressState}`
                      : s.addressCity ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.pixKey ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "active" ? "default" : "secondary"}>
                      {statusLabel[s.status] ?? s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setViewSupplier(s)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Fornecedor" : "Novo Fornecedor"}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="dados">
            <TabsList className="mb-2">
              <TabsTrigger value="dados">Dados gerais</TabsTrigger>
              <TabsTrigger value="banco">Dados bancários</TabsTrigger>
            </TabsList>
            <TabsContent value="dados">
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="col-span-2 space-y-1">
                  <Label>Nome *</Label>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                {!editing && (
                  <div className="col-span-2 space-y-1">
                    <Label>Tipo *</Label>
                    <Select
                      value={(form as CreateSupplierBody).type ?? ""}
                      onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPLIER_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!editing && (
                  <div className="col-span-2 space-y-1">
                    <Label>CNPJ</Label>
                    <Input
                      value={(form as CreateSupplierBody).cnpj ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Nome do Contato</Label>
                  <Input
                    value={form.contactName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>E-mail</Label>
                  <Input
                    value={form.email ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                {!editing && (
                  <div className="space-y-1">
                    <Label>WhatsApp</Label>
                    <Input
                      value={(form as CreateSupplierBody).whatsapp ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
                    />
                  </div>
                )}
                {!editing && (
                  <div className="space-y-1">
                    <Label>Cidade</Label>
                    <Input
                      value={(form as CreateSupplierBody).addressCity ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, addressCity: e.target.value }))}
                    />
                  </div>
                )}
                {!editing && (
                  <div className="space-y-1">
                    <Label>Estado (UF)</Label>
                    <Input
                      value={(form as CreateSupplierBody).addressState ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, addressState: e.target.value.toUpperCase() }))
                      }
                      maxLength={2}
                      className="uppercase"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Chave PIX</Label>
                  <Input
                    value={form.pixKey ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, pixKey: e.target.value }))}
                  />
                </div>
                {editing && (
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <Select
                      value={(form as UpdateSupplierBody).status ?? "active"}
                      onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {statusLabel[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="banco">
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="col-span-2 space-y-1">
                  <Label>Banco</Label>
                  <Select
                    value={form.bankName ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, bankName: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar banco" />
                    </SelectTrigger>
                    <SelectContent>
                      {BANK_OPTIONS.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Agência</Label>
                  <Input
                    value={form.bankAgency ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, bankAgency: e.target.value }))}
                    placeholder="0000"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Conta</Label>
                  <Input
                    value={form.bankAccount ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccount: e.target.value }))}
                    placeholder="00000-0"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Tipo de chave PIX</Label>
                  <Select
                    value={form.pixType ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, pixType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={createSupplier.isPending || updateSupplier.isPending}>
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      <SupplierDetailModal
        supplier={viewSupplier}
        open={!!viewSupplier}
        onClose={() => setViewSupplier(null)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Fornecedor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir este fornecedor? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleteSupplier.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
