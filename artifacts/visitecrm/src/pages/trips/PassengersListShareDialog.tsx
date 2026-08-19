import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Share2, Mail, MessageCircle, Loader2 } from "lucide-react";

interface PassengersListShareDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  shareEmail: string;
  setShareEmail: (v: string) => void;
  sharePhone: string;
  setSharePhone: (v: string) => void;
  shareLoading: boolean;
  handleShareEmail: () => void;
  handleShareWhatsApp: () => void;
}

export function PassengersListShareDialog({
  open, onClose, shareEmail, setShareEmail, sharePhone, setSharePhone,
  shareLoading, handleShareEmail, handleShareWhatsApp,
}: PassengersListShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="w-4 h-4" />Compartilhar Manifesto ANTT</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="email">
          <TabsList className="w-full">
            <TabsTrigger value="email" className="flex-1 gap-2"><Mail className="w-4 h-4" />E-mail</TabsTrigger>
            <TabsTrigger value="whatsapp" className="flex-1 gap-2"><MessageCircle className="w-4 h-4" />WhatsApp</TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">O manifesto completo será enviado para o e-mail informado.</p>
            <div className="space-y-2">
              <Label htmlFor="share-email">Endereço de e-mail</Label>
              <Input
                id="share-email" type="email" placeholder="motorista@exemplo.com"
                value={shareEmail} onChange={e => setShareEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleShareEmail(); }}
              />
            </div>
            <Button className="w-full" onClick={handleShareEmail} disabled={shareLoading || !shareEmail.trim()}>
              {shareLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
              Enviar por E-mail
            </Button>
          </TabsContent>
          <TabsContent value="whatsapp" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">Será gerado um link para envio pelo WhatsApp com os dados da excursão.</p>
            <div className="space-y-2">
              <Label htmlFor="share-phone">Número do WhatsApp</Label>
              <Input
                id="share-phone" type="tel" placeholder="(11) 99999-9999"
                value={sharePhone} onChange={e => setSharePhone(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleShareWhatsApp(); }}
              />
              <p className="text-xs text-muted-foreground">Informe o DDD + número. O código do país (55) será adicionado automaticamente.</p>
            </div>
            <Button className="w-full" onClick={handleShareWhatsApp} disabled={shareLoading || !sharePhone.trim()}>
              {shareLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
              Abrir no WhatsApp
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
