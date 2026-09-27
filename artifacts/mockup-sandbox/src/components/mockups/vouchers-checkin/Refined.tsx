import { CalendarDays, CheckCircle2, Clock3, Download, FileText, Search, ScanLine, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./_group.css";

const rows = [
  { name: "Camila Nascimento", contact: "(85) 9 1234-5678 · CPF ***.***.***-12", trip: "Excursão Fortaleza → Canoa Quebrada", date: "06 dez 2026", seats: "12, 13", code: "A41C83B5", reservation: "RES-2026-0065", voucher: "Gerado", checkIn: "Feito" },
  { name: "Rafael Monteiro", contact: "(85) 9 2468-1357 · CPF ***.***.***-34", trip: "João Pessoa · 14 a 17 jan 2027", date: "14 jan 2027", seats: "08", code: "D5302247", reservation: "RES-2026-0121", voucher: "Pronto", checkIn: "Aguardando" },
  { name: "Joana Ribeiro", contact: "(85) 9 3579-2468 · CPF ***.***.***-56", trip: "Canoa Quebrada · 3 a 6 dez 2026", date: "03 dez 2026", seats: "21, 22", code: "D88133E6", reservation: "RES-2026-0137", voucher: "Pronto", checkIn: "Aguardando" },
];

export default function RefinedVoucherGenerator() {
  return (
    <main className="voucher-checkin-sandbox min-h-screen space-y-5 p-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vouchers e Check-in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Identifique o passageiro, confira o voucher e acompanhe o embarque.</p>
        </div>
        <Button variant="outline"><ScanLine className="mr-2 h-4 w-4" />Scanner QR</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passageiros</p><p className="mt-1 text-2xl font-bold">200</p></div><Users className="h-5 w-5 text-primary" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Check-in realizado</p><p className="mt-1 text-2xl font-bold text-green-700">23 <span className="text-sm font-normal text-muted-foreground">passageiros</span></p></div><CheckCircle2 className="h-5 w-5 text-green-600" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aguardando check-in</p><p className="mt-1 text-2xl font-bold text-amber-700">177 <span className="text-sm font-normal text-muted-foreground">passageiros</span></p></div><Clock3 className="h-5 w-5 text-amber-600" /></CardContent></Card>
      </div>

      <div className="flex items-center gap-2 border-b">
        <button className="px-3 py-2 text-sm text-muted-foreground"><Search className="mr-2 inline h-4 w-4" />Busca individual</button>
        <button className="px-3 py-2 text-sm text-muted-foreground"><Users className="mr-2 inline h-4 w-4" />Check-in em massa</button>
        <button className="border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"><FileText className="mr-2 inline h-4 w-4" />Gerador de vouchers</button>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Vouchers da viagem</h2>
            <p className="text-xs text-muted-foreground">Status do voucher e check-in aparecem separadamente.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-72 max-w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por nome ou código..." readOnly value="" />
            </div>
            <Button variant="outline"><FileText className="mr-2 h-4 w-4" />Gerar todos os vouchers</Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Passageiro</TableHead>
                  <TableHead className="w-[235px]">Viagem</TableHead>
                  <TableHead className="w-[90px]">Assentos</TableHead>
                  <TableHead className="w-[165px]">Voucher</TableHead>
                  <TableHead className="w-[185px]">Acompanhamento</TableHead>
                  <TableHead className="w-[150px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.code}>
                    <TableCell>
                      <p className="text-sm font-semibold">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.contact}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{row.trip}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" />Saída {row.date}</p>
                    </TableCell>
                    <TableCell><span className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium">{row.seats}</span></TableCell>
                    <TableCell>
                      <p className="font-mono text-sm font-bold">{row.code}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.reservation}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {row.voucher === "Gerado" ? <Badge className="border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" />Voucher gerado</Badge> : <Badge variant="outline">Pronto para gerar</Badge>}
                        {row.checkIn === "Feito" ? <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />Check-in feito</Badge> : <Badge className="border-amber-200 bg-amber-50 text-amber-800" variant="outline"><Clock3 className="mr-1 h-3 w-3" />Aguardando</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant={index === 0 ? "outline" : "default"}><FileText className="mr-1 h-3 w-3" />{index === 0 ? "Re-gerar" : "Gerar"}</Button>
                        <Button size="sm" variant="ghost" disabled={index !== 0} aria-label="Baixar voucher"><Download className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
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