import { useState } from "react";
import {
  useListPassengers,
  useCreatePassenger,
  useUpdatePassenger,
  useDeletePassenger,
  useCheckInPassenger,
  useUndoCheckInPassenger,
} from "@workspace/api-client-react";
import type { Passenger } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle, LogIn, Pencil, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { AGE_CATEGORY_LABELS } from "./constants";
import { PassengerForm } from "./PassengerForm";
import { formatDate } from "@/lib/utils";

const PLACEHOLDER_NAME = "A preencher";

export function ReservationPassengersTab({ reservationId }: { reservationId: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingPassenger, setEditingPassenger] = useState<Passenger | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: passengers, refetch } = useListPassengers(reservationId, {
    query: { queryKey: ["passengers", reservationId] },
  });
  const createPassenger = useCreatePassenger();
  const updatePassenger = useUpdatePassenger();
  const deletePassenger = useDeletePassenger();
  const checkInPassenger = useCheckInPassenger();
  const undoCheckInPassenger = useUndoCheckInPassenger();

  const handleAdd = async (fd: FormData, ageCategory: string) => {
    await createPassenger.mutateAsync({
      reservationId,
      data: {
        name: fd.get("name") as string,
        cpf: (fd.get("cpf") as string) || undefined,
        ageCategory,
        seatNumber: (fd.get("seatNumber") as string) || undefined,
        isChildUnder7: ageCategory === "baby" || ageCategory === "child",
      },
    });
    await refetch();
    setAddOpen(false);
  };

  const handleEdit = async (fd: FormData, ageCategory: string) => {
    if (!editingPassenger) return;
    await updatePassenger.mutateAsync({
      reservationId,
      id: editingPassenger.id,
      data: {
        name: (fd.get("name") as string) || undefined,
        cpf: (fd.get("cpf") as string) || null,
        ageCategory,
        seatNumber: (fd.get("seatNumber") as string) || null,
        // Keep isChildUnder7 in sync with the chosen age category so both fields
        // are always consistent after an edit.
        isChildUnder7: ageCategory === "child" || ageCategory === "baby",
      },
    });
    await refetch();
    setEditingPassenger(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deletePassenger.mutateAsync({ reservationId, id: deleteId });
    await refetch();
    setDeleteId(null);
  };

  const handleCheckIn = async (passengerId: string) => {
    try {
      await checkInPassenger.mutateAsync({ reservationId, id: passengerId });
      await refetch();
      toast({ title: "Passageiro embarcado", description: "Check-in registrado com sucesso." });
    } catch {
      toast({ title: "Erro ao fazer check-in", variant: "destructive" });
    }
  };

  const handleUndoCheckIn = async (passengerId: string) => {
    try {
      await undoCheckInPassenger.mutateAsync({ reservationId, id: passengerId });
      await refetch();
      toast({ title: "Check-in desfeito" });
    } catch {
      toast({ title: "Erro ao desfazer check-in", variant: "destructive" });
    }
  };

  const list = (passengers ?? []) as Passenger[];
  const checkedInCount = list.filter(p => p.checkedInAt).length;
  const placeholderCount = list.filter(p => p.name === PLACEHOLDER_NAME).length;

  return (
    <div className="space-y-4 py-2">
      {placeholderCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-semibold">Manifesto incompleto:</span>{" "}
            {placeholderCount} passageiro(s) com nome "A preencher". Use o botão{" "}
            <Pencil className="inline w-3 h-3" /> para preencher os dados.
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{list.length} passageiro(s) cadastrado(s)</p>
          {list.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="text-green-600 font-medium">{checkedInCount} embarcado(s)</span>
              {" · "}
              <span>{list.length - checkedInCount} pendente(s)</span>
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <UserPlus className="w-4 h-4 mr-1.5" /> Adicionar Passageiro
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Nenhum passageiro cadastrado</p>
          <p className="text-xs mt-1">Adicione passageiros com CPF/RG para controle de embarque e lista ANTT.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(p => {
            const isCheckedIn = !!p.checkedInAt;
            return (
              <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border ${isCheckedIn ? "bg-green-50 border-green-200" : p.name === PLACEHOLDER_NAME ? "bg-amber-50 border-amber-200" : "bg-muted/50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-medium text-sm ${p.name === PLACEHOLDER_NAME ? "text-amber-700 italic" : ""}`}>{p.name}</p>
                    {p.name === PLACEHOLDER_NAME && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">
                        <AlertCircle className="w-3 h-3" />
                        Pendente
                      </span>
                    )}
                    {isCheckedIn && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-200">
                        <CheckCircle className="w-3 h-3" />
                        Embarcado {new Date(p.checkedInAt as string).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    {p.cpf && <span className="text-xs text-muted-foreground">CPF: {p.cpf}</span>}
                    {p.seatNumber && <span className="text-xs text-muted-foreground">Assento: {p.seatNumber}</span>}
                    {p.birthDate && <span className="text-xs text-muted-foreground">{formatDate(p.birthDate as string)}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      p.ageCategory === "adult" ? "bg-blue-100 text-blue-700" :
                      p.ageCategory === "child" ? "bg-amber-100 text-amber-700" :
                      p.ageCategory === "senior" ? "bg-purple-100 text-purple-700" :
                      "bg-pink-100 text-pink-700"
                    }`}>
                      {AGE_CATEGORY_LABELS[p.ageCategory] ?? p.ageCategory}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  {isCheckedIn ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-muted-foreground gap-1" onClick={() => handleUndoCheckIn(p.id)} disabled={undoCheckInPassenger.isPending} title="Desfazer check-in">
                      <RotateCcw className="w-3 h-3" /> Desfazer
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50 gap-1" onClick={() => handleCheckIn(p.id)} disabled={checkInPassenger.isPending} title="Fazer check-in">
                      <LogIn className="w-3 h-3" /> Embarcar
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingPassenger(p)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Passageiro</DialogTitle></DialogHeader>
          <div className="mt-2">
            <PassengerForm onSubmit={handleAdd} onCancel={() => setAddOpen(false)} isPending={createPassenger.isPending} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingPassenger} onOpenChange={(o) => { if (!o) setEditingPassenger(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar Passageiro</DialogTitle></DialogHeader>
          {editingPassenger && (
            <div className="mt-2">
              <PassengerForm
                isEdit
                defaultValues={{ name: editingPassenger.name, cpf: editingPassenger.cpf ?? "", ageCategory: editingPassenger.ageCategory, seatNumber: editingPassenger.seatNumber ?? "" }}
                onSubmit={handleEdit}
                onCancel={() => setEditingPassenger(null)}
                isPending={updatePassenger.isPending}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Passageiro</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja remover este passageiro? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={deletePassenger.isPending}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
