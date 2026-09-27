import { useState } from "react";
import { CheckCircle2, Download, FileText, Search, ScanLine, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./_group.css";

const rows = [
  { id: "reservation-1", name: "Camila Nascimento", cpf: "***.***.***-12", trip: "Excursão Fortaleza → Canoa Quebrada", code: "A41C83B5" },
  { id: "reservation-2", name: "Equipe Horizonte", cpf: "", trip: "Excursão Fortaleza → Canoa Quebrada", code: "3C9522F1" },
  { id: "reservation-3", name: "Rafael Monteiro", cpf: "***.***.***-34", trip: "João Pessoa · 14 a 17 jan 2027", code: "D5302247" },
  { id: "reservation-4", name: "Joana Ribeiro", cpf: "***.***.***-56", trip: "João Pessoa · 14 a 17 jan 2027", code: "D88133E6" },
  { id: "reservation-5", name: "Miguel Ferreira", cpf: "***.***.***-78", trip: "Canoa Quebrada · 3 a 6 dez 2026", code: "C95314EA" },
];

export default function CurrentVoucherGenerator() {
  const [search, setSearch] = useState("");
  const [generated, setGenerated] = useState<Set<string>>(new Set(["reservation-1"]));
  const filtered = rows.filter(
    (row) =>
      !row.code ||
      row.name.toLowerCase().includes(search.toLowerCase()) ||
      row.code.toLowerCase().includes(search.toLowerCase())
  );

  function handleGenerate(id: string) {
    setGenerated((prev) => new Set([...prev, id]));
  }

  function handleGenerateAll() {
    setGenerated((prev) => new Set([...prev, ...filtered.map((row) => row.id)]));
  }

  return (
    <main className="voucher-checkin-sandbox min-h-screen space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vouchers e Check-in</h1>
          <p className="text-sm text-muted-foreground">23 de 200 passageiros realizaram check-in</p>
        </div>
        <Button variant="outline">
          <ScanLine className="mr-2 h-4 w-4" />
          Scanner QR (câmera)
        </Button>
      </div>

      <Tabs defaultValue="generator">
        <TabsList>
          <TabsTrigger value="lookup">
            <Search className="mr-2 h-4 w-4" />
            Busca individual
          </TabsTrigger>
          <TabsTrigger value="bulk">
            <Users className="mr-2 h-4 w-4" />
            Check-in em massa
          </TabsTrigger>
          <TabsTrigger value="generator">
            <FileText className="mr-2 h-4 w-4" />
            Gerador de vouchers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generator" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nome ou código..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Button variant="outline" onClick={handleGenerateAll}>
                <FileText className="mr-2 h-4 w-4" />
                Gerar todos os vouchers
              </Button>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Passageiro</TableHead>
                    <TableHead>Viagem</TableHead>
                    <TableHead>Código do Voucher</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        Nenhuma reserva confirmada encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.cpf}</p>
                        </TableCell>
                        <TableCell className="text-sm">{row.trip}</TableCell>
                        <TableCell>
                          <span className="font-mono text-sm font-bold">{row.code}</span>
                        </TableCell>
                        <TableCell>
                          {generated.has(row.id) ? (
                            <Badge className="bg-green-100 text-xs text-green-700">Gerado</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">Pronto</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={generated.has(row.id) ? "outline" : "default"}
                              onClick={() => handleGenerate(row.id)}
                            >
                              <FileText className="mr-1 h-3 w-3" />
                              {generated.has(row.id) ? "Re-gerar" : "Gerar"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!generated.has(row.id)}
                              title={generated.has(row.id) ? "Baixar voucher" : "Gere o voucher primeiro"}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}