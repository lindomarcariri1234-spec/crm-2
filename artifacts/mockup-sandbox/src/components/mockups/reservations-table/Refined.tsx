import { CalendarDays, CheckCircle, Eye, MapPin, MoreHorizontal, Pencil, QrCode, Tag, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./_group.css";

export default function RefinedReservationTable() {
  return (
    <main className="reservation-table-sandbox min-h-screen p-5">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <Table className="min-w-[1200px]">
            <caption className="sr-only">Reservas com cliente, viagem e resumo financeiro</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[245px]">Cliente / reserva</TableHead>
                <TableHead className="w-[165px]">Viagem</TableHead>
                <TableHead className="w-[150px]">Embarque e assentos</TableHead>
                <TableHead className="w-[130px]">Valor bruto / desconto</TableHead>
                <TableHead className="w-[110px]">Total líquido</TableHead>
                <TableHead className="w-[130px]">Pago / saldo</TableHead>
                <TableHead className="w-[82px]">Pagamento</TableHead>
                <TableHead className="w-[95px]">Status</TableHead>
                <TableHead className="w-[52px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="align-middle hover:bg-muted/50">
                <TableCell>
                  <div className="flex min-w-[220px] flex-col gap-1.5">
                    <div className="flex items-start gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-primary">MO</span>
                      <button className="min-w-0 flex-1 text-left hover:underline">
                        <span className="block whitespace-normal text-sm font-semibold leading-5">Mariana Oliveira de Souza</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">(85) 9 8765-4321</span>
                      </button>
                    </div>
                    <div className="ml-10 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        <span className="font-mono font-semibold">VSITE-EXC-2026-0065</span>
                      </span>
                      <span className="w-fit rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">Loja</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="whitespace-normal text-sm font-medium leading-5">Excursão Fortaleza → Canoa Quebrada</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3 shrink-0" />
                    17 dez 2026
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-start gap-1.5 whitespace-normal text-sm leading-5">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>Terminal Central · plataforma 3</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Assento</span>
                      <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">42</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="whitespace-nowrap">
                    <p className="text-sm font-medium">R$ 1.250,00</p>
                    <p className="mt-1 text-xs text-destructive">Desconto − R$ 100,00</p>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="whitespace-nowrap text-sm font-semibold text-primary">R$ 1.150,00</p>
                </TableCell>
                <TableCell>
                  <div className="space-y-1.5 whitespace-nowrap">
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Pago</span>
                      <span className="font-medium text-green-700">R$ 450,00</span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Saldo</span>
                      <span className="font-semibold text-destructive">R$ 700,00</span>
                    </p>
                  </div>
                </TableCell>
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