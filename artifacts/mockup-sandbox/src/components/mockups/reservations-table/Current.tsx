import { AlertTriangle, CheckCircle, Eye, MoreHorizontal, Pencil, QrCode, RefreshCcw, Tag, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./_group.css";

export default function CurrentReservationTable() {
  return (
    <main className="reservation-table-sandbox min-h-screen p-5">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <Table className="min-w-[1480px]">
            <TableHeader>
              <TableRow>
                <TableHead>Nº Reserva</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Viagem</TableHead>
                <TableHead>Embarque</TableHead>
                <TableHead>Assentos</TableHead>
                <TableHead>Valor Total</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead>Total líquido</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Saldo devedor</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="whitespace-nowrap font-mono text-xs font-semibold">VSITE-EXC-2026-0065</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">Loja</span>
                      <Badge className="border-purple-200 bg-purple-50 text-xs text-purple-700" variant="outline">
                        <RefreshCcw className="mr-1 h-3 w-3" />
                        Auto-reenviado
                      </Badge>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-start gap-1.5">
                    <button className="flex-1 text-left hover:underline">
                      <p className="text-sm font-medium">Mariana Oliveira de Souza</p>
                      <p className="text-xs text-muted-foreground">(85) 9 8765-4321</p>
                    </button>
                    <span className="mt-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded-full bg-orange-100 p-0.5 text-orange-600" title="Reserva em outra viagem no mesmo período">
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="max-w-[140px] truncate text-sm font-medium">Excursão Fortaleza → Canoa Quebrada</p>
                  <p className="text-xs text-muted-foreground">17/12/2026</p>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">Terminal Central • plataforma 3</TableCell>
                <TableCell>
                  <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">42</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm font-medium">R$ 1.250,00</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-destructive">− R$ 100,00</TableCell>
                <TableCell className="whitespace-nowrap text-sm font-medium">R$ 1.150,00</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-green-700">R$ 450,00</TableCell>
                <TableCell className="whitespace-nowrap text-sm font-medium text-destructive">R$ 700,00</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">PIX</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Pendente
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações da reserva">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem><Eye className="mr-2 h-4 w-4" />Visualizar</DropdownMenuItem>
                      <DropdownMenuItem><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                      <DropdownMenuItem><QrCode className="mr-2 h-4 w-4" />Ver Voucher</DropdownMenuItem>
                      <DropdownMenuItem><CheckCircle className="mr-2 h-4 w-4" />Check-in</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive"><XCircle className="mr-2 h-4 w-4" />Cancelar Reserva</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  );
}