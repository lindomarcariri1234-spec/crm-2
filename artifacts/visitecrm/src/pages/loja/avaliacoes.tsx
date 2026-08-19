import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreReview } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, MessageSquare, Loader2, CheckCircle, XCircle } from "lucide-react";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${
            s <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

function ReviewDetail({
  review,
  onClose,
  onUpdated,
}: {
  review: StoreReview;
  onClose: () => void;
  onUpdated: (r: StoreReview) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState(review.reply ?? "");

  async function handleAction(status: "approved" | "rejected") {
    setLoading(true);
    try {
      const updated = await storeApi.updateReviewStatus(
        review.id,
        status,
        reply || undefined
      );
      toast({
        title: status === "approved" ? "Avaliação aprovada!" : "Avaliação rejeitada",
      });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveReply() {
    setLoading(true);
    try {
      const updated = await storeApi.updateReviewStatus(review.id, "approved", reply);
      toast({ title: "Resposta salva!" });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-muted/50">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">{review.customerName}</div>
          <StarRating rating={review.rating} />
        </div>
        {review.customerEmail && (
          <p className="text-xs text-muted-foreground mb-2">{review.customerEmail}</p>
        )}
        <p className="text-sm">{review.comment}</p>
        <p className="text-xs text-muted-foreground mt-2">
          {new Date(review.createdAt).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            timeZone: "America/Sao_Paulo",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Resposta da Agência (opcional)</label>
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Responda ao cliente..."
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        {review.status !== "rejected" && (
          <Button
            variant="destructive"
            onClick={() => handleAction("rejected")}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 mr-2" />
            )}
            Rejeitar
          </Button>
        )}
        {review.status !== "approved" ? (
          <Button onClick={() => handleAction("approved")} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Aprovar
          </Button>
        ) : (
          <Button onClick={saveReply} disabled={loading || !reply}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar Resposta
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LojaAvaliacoes() {
  const { toast } = useToast();
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<StoreReview | null>(null);

  async function load() {
    setLoading(true);
    try {
      setReviews(await storeApi.getReviews());
    } catch (err: unknown) {
      toast({
        title: "Erro ao carregar avaliações",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered =
    statusFilter === "all"
      ? reviews
      : reviews.filter((r) => r.status === statusFilter);

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Avaliações</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {reviews.length} avaliação(ões) recebida(s)
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{reviews.length}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-500">
              {avgRating.toFixed(1)} ★
            </div>
            <div className="text-sm text-muted-foreground">Média</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600">
              {reviews.filter((r) => r.status === "pending").length}
            </div>
            <div className="text-sm text-muted-foreground">Pendentes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">
              {reviews.filter((r) => r.status === "approved").length}
            </div>
            <div className="text-sm text-muted-foreground">Aprovadas</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="approved">Aprovadas</SelectItem>
            <SelectItem value="rejected">Rejeitadas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma avaliação encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <Card
              key={review.id}
              className={`cursor-pointer hover:border-primary/40 transition-colors ${
                review.status === "pending" ? "border-yellow-300" : ""
              }`}
              onClick={() => setSelected(review)}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-sm">{review.customerName}</span>
                      <StarRating rating={review.rating} />
                      <Badge
                        variant={
                          review.status === "approved"
                            ? "default"
                            : review.status === "rejected"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {review.status === "approved"
                          ? "Aprovada"
                          : review.status === "rejected"
                          ? "Rejeitada"
                          : "Pendente"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {review.comment}
                    </p>
                    {review.reply && (
                      <div className="mt-2 pl-3 border-l-2 border-primary/30">
                        <p className="text-xs text-muted-foreground italic">
                          Resposta: {review.reply}
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground ml-4 shrink-0">
                    {new Date(review.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes da Avaliação</DialogTitle>
          </DialogHeader>
          {selected && (
            <ReviewDetail
              review={selected}
              onClose={() => setSelected(null)}
              onUpdated={(updated) => {
                setReviews((r) => r.map((x) => (x.id === updated.id ? updated : x)));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
