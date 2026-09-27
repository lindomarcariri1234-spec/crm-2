import { CalendarDays, CheckCircle2, Clock3, ScanLine, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./_group.css";

const passengers = [
  { name: "Camila Nascimento", contact: "(85) 9 1234-5678 · CPF ***.***.***-12", code: "A41C83B5", seats: "12, 13", status: "Confirmada", checkIn: "Feito", time: "08:42" },
  { name: "Rafael Monteiro", contact: "(85) 9 2468-1357 · CPF ***.***.***-34", code: "D5302247", seats: "08", status: "Confirmada", checkIn: "Aguardando", time: "" },
  { name: "Joana Ribeiro", contact: "(85) 9 3579-2468 · CPF ***.***.***-56", code: "D88133E6", seats: "21, 22", status: "Confirmada", checkIn: "Aguardando", time: "" },
  { name: "Miguel Ferreira", contact: "(85) 9 4680-3579 · CPF ***.***.***-78", code: "C95314EA", seats: "17", status: "Confirmada", checkIn: "Aguardando", time: "" },
];

export default function BulkCheckInPreview() {
  return (
    <main className="voucher-checkin-sandbox min-h-screen space-y-5 p-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vouchers e Check-in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Confira cada passageiro e avance o grupo com segurança.</p>
        </div>
        <Button variant="outline"><ScanLine className="mr-2 h-4 w-4" />Scanner QR</Button>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passageiros</p><p className="mt-1 text-2xl font-bold">200</p></div><Users className="h-5 w-5 text-primary" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Check-in realizado</p><p className="mt-1 text-2xl font-bold text-green-700">23</p></div><CheckCircle2 className="h-5 w-5 text-green-600" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aguardando</p><p className="mt-1 text-2xl font-bold text-amber-700">177</p></div><Clock3 className="h-5 w-5 text-amber-600" /></CardContent></Card>
      </div>
      <div className="flex items-center gap-2 border-b">
        <button className="px-3 py-2 text-sm text-muted-foreground">Busca individual</button>
        <button className="border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"><Users className="mr-2 inline h-4 w-4" />Check-in em massa</button>
        <button className="px-3 py-2 text-sm text-muted-foreground">Gerador de vouchers</button>
      </div>
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[300px] flex-1">
            <label className="mb-1.5 block text-sm font-medium">Viagem selecionada</label>
            <Select defaultValue="fortaleza">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="fortaleza">Fortaleza → Canoa Quebrada · 06 dez 2026</SelectItem></SelectContent>
            </Select>
          </div>
          <Button><CheckCircle2 className="mr-2 h-4 w-4" />Check-in em massa (177)</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <span className="font-semibold">Resumo da viagem</span>
          <span className="text-muted-foreground">200 passageiros</span>
          <span className="inline-flex items-center gap-1 font-medium text-green-700"><CheckCircle2 className="h-4 w-4" />23 realizados</span>
          <span className="inline-flex items-center gap-1 font-medium text-amber-700"><Clock3 className="h-4 w-4" />177 aguardando</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />06 dez 2026</span>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Passageiro</TableHead>
                  <TableHead className="w-[180px]">Voucher</TableHead>
                  <TableHead className="w-[100px]">Assentos</TableHead>
                  <TableHead className="w-[140px]">Reserva</TableHead>
                  <TableHead className="w-[160px]">Check-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {passengers.map((person) => (
                  <TableRow key={person.code}>
                    <TableCell>
                      <p className="text-sm font-semibold">{person.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{person.contact}</p>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold">{person.code}</TableCell>
                    <TableCell><span className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium">{person.seats}</span></TableCell>
                    <TableCell><Badge>{person.status}</Badge></TableCell>
                    <TableCell>{person.checkIn === "Feito" ? <Badge className="border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" />Realizado às {person.time}</Badge> : <Badge className="border-amber-200 bg-amber-50 text-amber-800" variant="outline"><Clock3 className="mr-1 h-3 w-3" />Aguardando</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </main>
  );
}