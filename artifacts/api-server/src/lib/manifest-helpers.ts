import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import PDFDocument from "pdfkit";
import { db, tripsTable, reservationsTable, passengersTable, tenantsTable, vehicleLayoutsTable, type FreePassenger } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { RESERVATION_STATUS } from "@workspace/permissions";

export type ManifestPassenger = {
  name: string;
  cpf: string | null;
  birthDate: string | null;
  ageCategory: string;
  seatNumber: string | null;
  boardingLocationId: string | null;
  documentType: string | null;
  specialNeeds: string | null;
  observations: string | null;
};

export type ManifestPanel = {
  tripName: string;
  departureDate: string;
  departureTime: string | null;
  tenantName: string;
  tenantCnpj: string | null;
  manifestNumber: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  driverName: string | null;
  driver1Cpf: string | null;
  driver1Cnh: string | null;
  driver1CnhCategory: string | null;
  driver1CnhExpiry: string | null;
  driver2Name: string | null;
  driver2Cpf: string | null;
  driver2Cnh: string | null;
  driver2CnhCategory: string | null;
  driver2CnhExpiry: string | null;
  tourGuide: string | null;
  tourGuideCpf: string | null;
  tourGuideRegistration: string | null;
  boardingPoints: Array<{ id: string; name: string; time?: string }>;
  passengers: ManifestPassenger[];
  freePassengers: FreePassenger[];
  destinationCity?: string;
  destinationState?: string;
  numberingType?: string | null;
};

/**
 * Loads manifest data at send time. The tenant condition on the trip is
 * intentional: a delayed job must never use data after its trip is moved or
 * otherwise no longer belongs to the queued tenant.
 */
export async function loadManifestPanelForTenant(tenantId: string, tripId: string): Promise<ManifestPanel | null> {
  const [trip] = await db.select().from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
    .limit(1);
  if (!trip) return null;

  const reservations = await db.select().from(reservationsTable)
    .where(and(
      eq(reservationsTable.tripId, trip.id),
      eq(reservationsTable.tenantId, tenantId),
      sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
    ));
  const reservationIds = reservations.map((reservation) => reservation.id);
  const [passengers, [tenant], [layoutRow]] = await Promise.all([
    reservationIds.length > 0
      ? db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
      : Promise.resolve([]),
    db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId)).limit(1),
    trip.layoutId
      ? db.select({ numberingType: vehicleLayoutsTable.numberingType }).from(vehicleLayoutsTable)
        .where(eq(vehicleLayoutsTable.id, trip.layoutId)).limit(1)
      : Promise.resolve([undefined]),
  ]);

  // Do not send a manifest if the tenant was removed while the job waited.
  if (!tenant) return null;

  const reservationMap = new Map(reservations.map((reservation) => [reservation.id, reservation]));
  const manifestPassengers: ManifestPassenger[] = passengers.map((passenger) => {
    const reservation = reservationMap.get(passenger.reservationId);
    return {
      name: passenger.name,
      cpf: passenger.cpf ?? null,
      birthDate: passenger.birthDate?.toISOString() ?? null,
      ageCategory: passenger.ageCategory,
      seatNumber: passenger.seatNumber ?? null,
      boardingLocationId: passenger.boardingLocationId ?? reservation?.boardingLocationId ?? null,
      documentType: passenger.documentType ?? null,
      specialNeeds: passenger.specialNeeds ?? null,
      observations: passenger.observations ?? null,
    };
  });

  return {
    tripName: trip.name,
    departureDate: trip.departureDate.toISOString(),
    departureTime: trip.departureTime ?? null,
    tenantName: tenant.name,
    tenantCnpj: tenant.cnpj ?? null,
    manifestNumber: trip.manifestNumber ?? null,
    vehiclePlate: trip.vehiclePlate ?? null,
    vehicleType: trip.vehicleType ?? null,
    driverName: trip.driverName ?? null,
    driver1Cpf: trip.driver1Cpf ?? null,
    driver1Cnh: trip.driver1Cnh ?? null,
    driver1CnhCategory: trip.driver1CnhCategory ?? null,
    driver1CnhExpiry: trip.driver1CnhExpiry ?? null,
    driver2Name: trip.driver2Name ?? null,
    driver2Cpf: trip.driver2Cpf ?? null,
    driver2Cnh: trip.driver2Cnh ?? null,
    driver2CnhCategory: trip.driver2CnhCategory ?? null,
    driver2CnhExpiry: trip.driver2CnhExpiry ?? null,
    tourGuide: trip.tourGuide ?? null,
    tourGuideCpf: trip.tourGuideCpf ?? null,
    tourGuideRegistration: trip.tourGuideRegistration ?? null,
    boardingPoints: (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string }>,
    passengers: manifestPassengers,
    freePassengers: Array.isArray(trip.freePassengers) ? trip.freePassengers as FreePassenger[] : [],
    destinationCity: trip.destinationCity,
    destinationState: trip.destinationState,
    numberingType: layoutRow?.numberingType ?? null,
  };
}

export const AGE_CATEGORY_LABELS_SERVER: Record<string, string> = {
  adult: "Adulto",
  child: "Criança",
  senior: "Idoso",
  baby: "Gratuidade",
  pcd: "PCD",
};

export function escapeHtmlServer(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatCpfServer(cpf: string | null | undefined): string {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  return cpf;
}

export function seatWithPosition(seatNumber: string | null, numberingType?: string | null): string {
  if (!seatNumber) return "—";
  if (!numberingType?.includes("brazilian_standard")) return seatNumber;
  const num = parseInt(seatNumber.replace(/\D/g, ""), 10);
  if (isNaN(num)) return seatNumber;
  return `${seatNumber} (${num % 2 !== 0 ? "Janela" : "Corredor"})`;
}

export function generateManifestHtml(p: ManifestPanel): string {
  const e = escapeHtmlServer;
  const tripName = e(p.tripName);
  const destination = p.destinationCity && p.destinationState ? e(`${p.destinationCity}/${p.destinationState}`) : "";
  const depDate = p.departureDate ? format(parseISO(p.departureDate), "dd/MM/yyyy", { locale: ptBR }) : "";
  const depTime = p.departureTime ? e(p.departureTime) : "";
  const emitidoEm = e(new Date().toLocaleString("pt-BR"));
  const organizador = e(p.tenantName ?? "");
  const cnpj = e(p.tenantCnpj ?? "");
  const manifestNumber = e(p.manifestNumber ?? "");
  const vehiclePlate = e(p.vehiclePlate ?? "");
  const vehicleType = e(p.vehicleType ?? "");
  const driverName = e(p.driverName ?? "");
  const driver1Cpf = e(p.driver1Cpf ?? "");
  const driver1Cnh = e(p.driver1Cnh ?? "");
  const driver1CnhCat = e(p.driver1CnhCategory ?? "");
  const driver1CnhExp = e(p.driver1CnhExpiry ?? "");
  const driver2Name = e(p.driver2Name ?? "");
  const driver2Cpf = e(p.driver2Cpf ?? "");
  const driver2Cnh = e(p.driver2Cnh ?? "");
  const driver2CnhCat = e(p.driver2CnhCategory ?? "");
  const driver2CnhExp = e(p.driver2CnhExpiry ?? "");
  const tourGuide = e(p.tourGuide ?? "");
  const tourGuideCpf = e(p.tourGuideCpf ?? "");
  const tourGuideReg = e(p.tourGuideRegistration ?? "");

  const bpMap = new Map(p.boardingPoints.map(bp => [bp.id, bp.name]));
  const getBpName = (id: string | null | undefined) => (id ? bpMap.get(id) ?? id : "—");

  const rows = p.passengers.map((pass, i) => {
    const nome = e(pass.name);
    const cpfStr = e(formatCpfServer(pass.cpf));
    const nasc = pass.birthDate ? e(new Date(pass.birthDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })) : "—";
    const cat = e(AGE_CATEGORY_LABELS_SERVER[pass.ageCategory] ?? pass.ageCategory);
    const poltrona = e(seatWithPosition(pass.seatNumber, p.numberingType));
    const embarque = e(getBpName(pass.boardingLocationId));
    const obsLines = [pass.documentType, pass.specialNeeds, pass.observations].filter(Boolean).map(s => e(s!));
    const obs = obsLines.length > 0 ? obsLines.join(" | ") : "";
    return `<tr>
      <td class="num">${String(i + 1).padStart(2, "0")}</td>
      <td>${nome}</td>
      <td>${cpfStr}</td>
      <td>${nasc}</td>
      <td>${cat}</td>
      <td class="seat">${poltrona}</td>
      <td>${embarque}</td>
      <td class="obs-cell">${obs}</td>
    </tr>`;
  }).join("");

  const ROLE_LABEL: Record<string, string> = { organizer: "Organizador", guide: "Guia" };
  const freeRows = p.freePassengers.map((fp, i) => {
    const nome = e(fp.name);
    const cpfStr = e(formatCpfServer(fp.cpf));
    const role = e(ROLE_LABEL[fp.role] ?? fp.role);
    const seat = e(seatWithPosition(fp.seatNumber ?? null, p.numberingType));
    return `<tr>
      <td class="num">${String(i + 1).padStart(2, "0")}</td>
      <td>${nome}</td>
      <td>${cpfStr}</td>
      <td>${role}</td>
      <td class="seat">${seat}</td>
    </tr>`;
  }).join("");

  const gratuitySection = p.freePassengers.length > 0 ? `
<div class="section" style="margin-top:8px;">
  <div class="section-title">Gratuidades (Organizadores / Guias)</div>
  <table>
    <thead>
      <tr>
        <th class="num">Nº</th>
        <th>Nome Completo</th>
        <th>CPF</th>
        <th>Função</th>
        <th class="seat">Assento</th>
      </tr>
    </thead>
    <tbody>${freeRows}</tbody>
  </table>
</div>` : "";

  const crewRows = [
    driverName || driver1Cpf || driver1Cnh
      ? `<tr><td>Motorista 1</td><td>${driverName || "—"}</td><td>CNH ${driver1Cnh || "—"}${driver1CnhCat ? ` — Cat. ${driver1CnhCat}` : ""}${driver1CnhExp ? ` — Val. ${driver1CnhExp}` : ""}</td><td>CPF: ${driver1Cpf || "—"}</td></tr>`
      : "",
    driver2Name || driver2Cpf || driver2Cnh
      ? `<tr><td>Motorista 2</td><td>${driver2Name || "—"}</td><td>CNH ${driver2Cnh || "—"}${driver2CnhCat ? ` — Cat. ${driver2CnhCat}` : ""}${driver2CnhExp ? ` — Val. ${driver2CnhExp}` : ""}</td><td>CPF: ${driver2Cpf || "—"}</td></tr>`
      : "",
    tourGuide || tourGuideCpf || tourGuideReg
      ? `<tr><td>Guia de Turismo</td><td>${tourGuide || "—"}</td><td>CADASTUR: ${tourGuideReg || "—"}</td><td>CPF: ${tourGuideCpf || "—"}</td></tr>`
      : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Manifesto ANTT — ${tripName}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10.5px; margin: 12mm 14mm; color: #000; }
  .header { border: 2px solid #1a1a1a; padding: 8px 10px; margin-bottom: 6px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .title { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .subtitle { font-size: 9px; color: #555; }
  .manifest-no { font-size: 13px; font-weight: bold; font-family: monospace; color: #1a3a6e; }
  .section { border: 1px solid #ccc; padding: 5px 8px; margin-bottom: 5px; font-size: 10.5px; }
  .section-title { font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #555; margin-bottom: 4px; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; }
  .meta-item label { font-weight: bold; margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a1a; color: #fff; text-align: left; padding: 4px 5px; font-size: 9.5px; }
  td { padding: 3px 5px; border-bottom: 1px solid #e8e8e8; font-size: 10px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f8f8; }
  .num { width: 22px; text-align: center; }
  .seat { width: 85px; text-align: center; }
  .obs-cell { font-size: 9px; color: #555; max-width: 120px; }
  .crew-table td { border-bottom: 1px solid #e8e8e8; }
  .crew-table td:first-child { font-weight: bold; width: 110px; }
  .totals { margin-top: 6px; padding: 4px 8px; background: #f0f0f0; border: 1px solid #ccc; font-size: 10.5px; }
  .footer { margin-top: 14px; border-top: 1px solid #ccc; padding-top: 8px; display: flex; justify-content: space-between; font-size: 9px; color: #555; }
  .sig-block { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .sig-line { border-top: 1px solid #000; padding-top: 3px; font-size: 9px; text-align: center; color: #555; }
</style>
</head>
<body>
<div class="header">
  <div class="header-top">
    <div>
      <div class="title">Manifesto de Passageiros — ANTT</div>
      <div class="subtitle">Resolução ANTT nº 4.777/2015 — Transporte rodoviário de passageiros em excursão</div>
    </div>
    ${manifestNumber ? `<div class="manifest-no">${manifestNumber}</div>` : ""}
  </div>
</div>
<div class="section">
  <div class="section-title">Dados da Excursão</div>
  <div class="meta-grid">
    <div class="meta-item"><label>Excursão:</label>${tripName}</div>
    ${destination ? `<div class="meta-item"><label>Destino:</label>${destination}</div>` : ""}
    <div class="meta-item"><label>Saída:</label>${depDate}${depTime ? ` às ${depTime}` : ""}</div>
    ${organizador ? `<div class="meta-item"><label>Organizador:</label>${organizador}</div>` : ""}
    ${cnpj ? `<div class="meta-item"><label>CNPJ:</label>${cnpj}</div>` : ""}
    <div class="meta-item"><label>Total Passageiros:</label>${p.passengers.length + p.freePassengers.length}</div>
    <div class="meta-item"><label>Emitido em:</label>${emitidoEm}</div>
  </div>
</div>
<div class="section">
  <div class="section-title">Veículo</div>
  <div class="meta-grid">
    ${vehicleType ? `<div class="meta-item"><label>Tipo:</label>${vehicleType}</div>` : ""}
    ${vehiclePlate ? `<div class="meta-item"><label>Placa:</label>${vehiclePlate}</div>` : ""}
  </div>
</div>
${crewRows ? `<div class="section">
  <div class="section-title">Tripulação</div>
  <table class="crew-table"><tbody>${crewRows}</tbody></table>
</div>` : ""}
<table>
  <thead>
    <tr>
      <th class="num">Nº</th>
      <th>Nome Completo</th>
      <th>CPF</th>
      <th>Data Nasc.</th>
      <th>Categoria</th>
      <th class="seat">Assento</th>
      <th>Embarque</th>
      <th>Obs.</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
${gratuitySection}
<div class="sig-block">
  <div class="sig-line">Assinatura do Responsável pela Excursão</div>
  <div class="sig-line">Assinatura do Motorista</div>
</div>
<div class="footer">
  <span>Nº Manifesto: <strong>${manifestNumber || "—"}</strong> &nbsp;|&nbsp; VisiteCRM — Gestão de Agências de Turismo</span>
  <span>Emitido em ${emitidoEm}</span>
</div>
</body>
</html>`;
}

export function generateManifestPdf(p: ManifestPanel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bpMap = new Map(p.boardingPoints.map(bp => [bp.id, bp.name]));
    const getBpName = (id: string | null | undefined) => (id ? bpMap.get(id) ?? id : "—");
    const depDate = p.departureDate ? format(parseISO(p.departureDate), "dd/MM/yyyy", { locale: ptBR }) : "";
    const depTime = p.departureTime ? ` às ${p.departureTime}` : "";
    const emitidoEm = new Date().toLocaleString("pt-BR");
    const pageWidth = 595 - 72;

    doc.rect(36, 36, pageWidth, 48).stroke();
    doc.font("Helvetica-Bold").fontSize(12).text("MANIFESTO DE PASSAGEIROS — ANTT", 40, 44, { width: pageWidth - 8, align: "center" });
    doc.font("Helvetica").fontSize(7).text("Resolução ANTT nº 4.777/2015 — Transporte rodoviário de passageiros em excursão", 40, 62, { width: pageWidth - 8, align: "center" });
    if (p.manifestNumber) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1a3a6e").text(p.manifestNumber, pageWidth - 60, 52, { width: 90 });
      doc.fillColor("black");
    }

    let y = 90;
    const labelVal = (label: string, value: string, xOff = 0, yOff = y) => {
      doc.font("Helvetica-Bold").fontSize(8).text(label, 40 + xOff, yOff, { continued: true });
      doc.font("Helvetica").fontSize(8).text(" " + value);
    };

    doc.rect(36, y, pageWidth, 44).stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#555").text("DADOS DA EXCURSÃO", 40, y + 3);
    doc.fillColor("black");
    y += 12;
    const colW = pageWidth / 3;
    labelVal("Excursão:", p.tripName.slice(0, 40), 0, y);
    if (p.destinationCity) labelVal("Destino:", `${p.destinationCity}/${p.destinationState ?? ""}`, colW, y);
    labelVal("Saída:", depDate + depTime, colW * 2, y);
    y += 12;
    if (p.tenantName) labelVal("Organizador:", p.tenantName, 0, y);
    if (p.tenantCnpj) labelVal("CNPJ:", p.tenantCnpj, colW, y);
    labelVal("Total Passageiros:", String(p.passengers.length + p.freePassengers.length), colW * 2, y);
    y += 12;
    labelVal("Emitido em:", emitidoEm, 0, y);
    y += 20;

    if (p.vehiclePlate || p.vehicleType) {
      doc.rect(36, y, pageWidth, 28).stroke();
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#555").text("VEÍCULO", 40, y + 3);
      doc.fillColor("black");
      y += 12;
      if (p.vehicleType) labelVal("Tipo:", p.vehicleType, 0, y);
      if (p.vehiclePlate) labelVal("Placa:", p.vehiclePlate, colW, y);
      y += 20;
    }

    const hasDriver1 = !!(p.driverName || p.driver1Cpf || p.driver1Cnh);
    const hasDriver2 = !!(p.driver2Name || p.driver2Cpf || p.driver2Cnh);
    const hasGuide = !!(p.tourGuide || p.tourGuideCpf || p.tourGuideRegistration);
    if (hasDriver1 || hasDriver2 || hasGuide) {
      const crewRows = [
        hasDriver1 ? ["Motorista 1", p.driverName ?? "—", `CNH: ${p.driver1Cnh ?? "—"}${p.driver1CnhCategory ? " Cat." + p.driver1CnhCategory : ""}`, `CPF: ${p.driver1Cpf ?? "—"}`] : null,
        hasDriver2 ? ["Motorista 2", p.driver2Name ?? "—", `CNH: ${p.driver2Cnh ?? "—"}${p.driver2CnhCategory ? " Cat." + p.driver2CnhCategory : ""}`, `CPF: ${p.driver2Cpf ?? "—"}`] : null,
        hasGuide ? ["Guia de Turismo", p.tourGuide ?? "—", `CADASTUR: ${p.tourGuideRegistration ?? "—"}`, `CPF: ${p.tourGuideCpf ?? "—"}`] : null,
      ].filter((r): r is string[] => r !== null);
      const crewH = 14 + crewRows.length * 14;
      doc.rect(36, y, pageWidth, crewH).stroke();
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#555").text("TRIPULAÇÃO", 40, y + 3);
      doc.fillColor("black");
      y += 14;
      for (const row of crewRows) {
        const cw = pageWidth / 4;
        doc.font("Helvetica-Bold").fontSize(7.5).text(row[0], 40, y, { width: cw - 4 });
        doc.font("Helvetica").fontSize(7.5).text(row[1], 40 + cw, y, { width: cw - 4 });
        doc.text(row[2], 40 + cw * 2, y, { width: cw - 4 });
        doc.text(row[3], 40 + cw * 3, y, { width: cw - 4 });
        y += 14;
      }
      y += 6;
    }

    const colDefs = [
      { label: "Nº", w: 20 },
      { label: "Nome Completo", w: 100 },
      { label: "CPF", w: 72 },
      { label: "Nasc.", w: 48 },
      { label: "Cat.", w: 48 },
      { label: "Assento", w: 65 },
      { label: "Embarque", w: 80 },
      { label: "Obs.", w: 90 },
    ];
    const totalColW = colDefs.reduce((s, c) => s + c.w, 0);
    const scale = pageWidth / totalColW;
    const cols = colDefs.map(c => ({ ...c, w: c.w * scale }));

    doc.rect(36, y, pageWidth, 14).fillAndStroke("#1a1a1a", "#1a1a1a");
    let xOff = 40;
    for (const col of cols) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("white").text(col.label, xOff, y + 3, { width: col.w - 2, lineBreak: false });
      xOff += col.w;
    }
    doc.fillColor("black");
    y += 14;

    const AGE_LABELS: Record<string, string> = { adult: "Adulto", child: "Criança", senior: "Idoso", baby: "Gratuidade", pcd: "PCD" };
    for (let i = 0; i < p.passengers.length; i++) {
      const pass = p.passengers[i];
      if (i % 2 === 0) doc.rect(36, y, pageWidth, 13).fillAndStroke("#f8f8f8", "white");
      doc.rect(36, y, pageWidth, 13).stroke();
      xOff = 40;
      const rowData = [
        String(i + 1).padStart(2, "0"),
        pass.name.slice(0, 25),
        formatCpfServer(pass.cpf),
        pass.birthDate ? new Date(pass.birthDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—",
        AGE_LABELS[pass.ageCategory] ?? pass.ageCategory,
        seatWithPosition(pass.seatNumber, p.numberingType),
        getBpName(pass.boardingLocationId),
        [pass.documentType, pass.specialNeeds, pass.observations].filter(Boolean).join(" | ").slice(0, 20),
      ];
      for (let ci = 0; ci < cols.length; ci++) {
        doc.font("Helvetica").fontSize(7).fillColor("black").text(rowData[ci], xOff, y + 3, { width: cols[ci].w - 2, lineBreak: false });
        xOff += cols[ci].w;
      }
      y += 13;
      if (y > 760) {
        doc.addPage();
        y = 40;
      }
    }

    if (p.freePassengers.length > 0) {
      if (y + 30 > 800) { doc.addPage(); y = 40; }
      const ROLE_LABEL_PDF: Record<string, string> = { organizer: "Organizador", guide: "Guia" };
      doc.rect(36, y, pageWidth, 14).stroke();
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#555").text("GRATUIDADES (ORGANIZADORES / GUIAS)", 40, y + 3);
      doc.fillColor("black");
      y += 14;

      const freeColDefs = [
        { label: "Nº", w: 20 },
        { label: "Nome Completo", w: 140 },
        { label: "CPF", w: 90 },
        { label: "Função", w: 80 },
        { label: "Assento", w: 70 },
      ];
      const freeTotalW = freeColDefs.reduce((s, c) => s + c.w, 0);
      const freeScale = pageWidth / freeTotalW;
      const freeCols = freeColDefs.map(c => ({ ...c, w: c.w * freeScale }));

      doc.rect(36, y, pageWidth, 12).fillAndStroke("#3a3a3a", "#3a3a3a");
      let fxOff = 40;
      for (const col of freeCols) {
        doc.font("Helvetica-Bold").fontSize(7).fillColor("white").text(col.label, fxOff, y + 2, { width: col.w - 2, lineBreak: false });
        fxOff += col.w;
      }
      doc.fillColor("black");
      y += 12;

      for (let i = 0; i < p.freePassengers.length; i++) {
        const fp = p.freePassengers[i];
        if (i % 2 === 0) doc.rect(36, y, pageWidth, 12).fillAndStroke("#f8f8f8", "white");
        doc.rect(36, y, pageWidth, 12).stroke();
        fxOff = 40;
        const rowData = [
          String(i + 1).padStart(2, "0"),
          fp.name.slice(0, 30),
          formatCpfServer(fp.cpf),
          ROLE_LABEL_PDF[fp.role] ?? fp.role,
          seatWithPosition(fp.seatNumber ?? null, p.numberingType),
        ];
        for (let ci = 0; ci < freeCols.length; ci++) {
          doc.font("Helvetica").fontSize(7).fillColor("black").text(rowData[ci], fxOff, y + 2, { width: freeCols[ci].w - 2, lineBreak: false });
          fxOff += freeCols[ci].w;
        }
        y += 12;
        if (y > 760) { doc.addPage(); y = 40; }
      }
      y += 6;
    }

    if (y + 40 > 800) { doc.addPage(); y = 40; }
    const sigW = (pageWidth - 20) / 2;
    doc.moveTo(40, y + 20).lineTo(40 + sigW, y + 20).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Assinatura do Responsável pela Excursão", 40, y + 22, { width: sigW, align: "center" });
    doc.moveTo(40 + sigW + 20, y + 20).lineTo(40 + pageWidth, y + 20).stroke();
    doc.text("Assinatura do Motorista", 40 + sigW + 20, y + 22, { width: sigW, align: "center" });
    y += 40;

    doc.moveTo(36, y).lineTo(36 + pageWidth, y).stroke();
    doc.fontSize(7).fillColor("#555").text(`Nº Manifesto: ${p.manifestNumber ?? "—"} | VisiteCRM — Gestão de Agências de Turismo`, 40, y + 4, { width: pageWidth / 2 });
    doc.text(`Emitido em ${emitidoEm}`, 40 + pageWidth / 2, y + 4, { width: pageWidth / 2, align: "right" });

    doc.end();
  });
}
