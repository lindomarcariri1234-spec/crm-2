import type { BoardingPassenger, FreePassenger } from "@workspace/api-client-react";
import { formatBRLPlain } from "@workspace/shared";

const BRAZIL_TZ = "America/Sao_Paulo";

function formatDateBR(d: string): string {
  if (!d) return "";
  const dt = d.length <= 10 ? new Date(d + "T12:00:00") : new Date(d);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(dt);
}

function formatTimeBR(d: string): string {
  const dt = new Date(d);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ, hour: "2-digit", minute: "2-digit",
  }).format(dt);
}

export interface ManifestPanel {
  tripName?: string | null;
  departureDate?: string | null;
  tenantName?: string | null;
  tenantCnpj?: string | null;
  manifestNumber?: string | null;
  vehiclePlate?: string | null;
  vehicleType?: string | null;
  driverName?: string | null;
  driver1Cpf?: string | null;
  driver1Cnh?: string | null;
  driver1CnhCategory?: string | null;
  driver1CnhExpiry?: string | null;
  driver2Name?: string | null;
  driver2Cpf?: string | null;
  driver2Cnh?: string | null;
  driver2CnhCategory?: string | null;
  driver2CnhExpiry?: string | null;
  tourGuide?: string | null;
  tourGuideCpf?: string | null;
  tourGuideRegistration?: string | null;
}

export interface ManifestTrip {
  destinationCity?: string;
  destinationState?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printPassengersManifest(
  panel: ManifestPanel | undefined,
  trip: ManifestTrip | undefined,
  allPassengers: BoardingPassenger[],
  getBoardingPointName: (id: string | null | undefined) => string,
  formatCpf: (cpf: string | null | undefined) => string,
  AGE_CATEGORY_LABELS: Record<string, string>,
  freePassengers: FreePassenger[] = [],
  visibleCols: Record<string, boolean> = {},
  totalCapacity?: number,
) {
  const show = (col: string) => visibleCols[col] !== false;

  const p = panel;
  const tripName = escapeHtml(p?.tripName ?? "");
  const destination = trip ? escapeHtml(`${trip.destinationCity}/${trip.destinationState}`) : "";
  const depDate = p?.departureDate ? escapeHtml(formatDateBR(p.departureDate)) : "";
  const depTimeRaw = p?.departureDate && p.departureDate.length > 10
    ? formatTimeBR(p.departureDate)
    : "";
  const depTime = depTimeRaw && depTimeRaw !== "00:00" ? escapeHtml(depTimeRaw) : "";
  const emitidoEm = escapeHtml(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
  const organizador = escapeHtml(p?.tenantName ?? "");
  const cnpj = escapeHtml(p?.tenantCnpj ?? "");
  const manifestNumber = escapeHtml(p?.manifestNumber ?? "");
  const vehiclePlate = escapeHtml(p?.vehiclePlate ?? "");
  const vehicleType = escapeHtml(p?.vehicleType ?? "");
  const driverName = escapeHtml(p?.driverName ?? "");
  const driver1Cpf = escapeHtml(p?.driver1Cpf ?? "");
  const driver1Cnh = escapeHtml(p?.driver1Cnh ?? "");
  const driver1CnhCat = escapeHtml(p?.driver1CnhCategory ?? "");
  const driver1CnhExp = escapeHtml(p?.driver1CnhExpiry ?? "");
  const driver2Name = escapeHtml(p?.driver2Name ?? "");
  const driver2Cpf = escapeHtml(p?.driver2Cpf ?? "");
  const driver2Cnh = escapeHtml(p?.driver2Cnh ?? "");
  const driver2CnhCat = escapeHtml(p?.driver2CnhCategory ?? "");
  const driver2CnhExp = escapeHtml(p?.driver2CnhExpiry ?? "");
  const tourGuide = escapeHtml(p?.tourGuide ?? "");
  const tourGuideCpf = escapeHtml(p?.tourGuideCpf ?? "");
  const tourGuideReg = escapeHtml(p?.tourGuideRegistration ?? "");

  const anttBucket: Record<string, string> = { adult: "adulto", child: "crianca", senior: "idoso", baby: "gratuidade", pcd: "pcd" };
  const catOrder = ["adulto", "crianca", "idoso", "pcd", "gratuidade"];
  const catLabel: Record<string, string> = { adulto: "Adultos", crianca: "Crianças", idoso: "Idosos", pcd: "PCDs", gratuidade: "Gratuidades" };
  const freeRoleLabel: Record<string, string> = { organizer: "Organizador", guide: "Guia de Turismo" };
  const categoryCounts: Record<string, number> = {};
  for (const pass of allPassengers) {
    if (pass.isGratuidade) {
      categoryCounts["gratuidade"] = (categoryCounts["gratuidade"] ?? 0) + 1;
    } else {
      const bucket = anttBucket[pass.ageCategory] ?? "adulto";
      categoryCounts[bucket] = (categoryCounts[bucket] ?? 0) + 1;
    }
  }
  if (freePassengers.length > 0) {
    categoryCounts["gratuidade"] = (categoryCounts["gratuidade"] ?? 0) + freePassengers.length;
  }

  // --- helpers to render individual row types ---

  const renderPassengerRow = (pass: BoardingPassenger): string => {
    const nome = escapeHtml(pass.name);
    const cpfStr = escapeHtml(formatCpf(pass.cpf));
    const nasc = pass.birthDate ? escapeHtml(formatDateBR(pass.birthDate)) : "—";
    const cat = escapeHtml(AGE_CATEGORY_LABELS[pass.ageCategory] ?? pass.ageCategory);
    const poltrona = escapeHtml(pass.seatNumber ?? "No colo");
    const embarque = escapeHtml(getBoardingPointName(pass.boardingLocationId) || "—");
    const whatsapp = escapeHtml(pass.whatsapp ?? "—");
    const checkedInAt = pass.checkedInAt ? "Embarcado" : "Pendente";
    const isLapChild = pass.ageCategory === "baby" && !pass.seatNumber;
    const obsLines = [
      isLapChild ? "No colo" : null,
      pass.isGratuidade ? "Gratuidade" : null,
      pass.documentType,
      pass.specialNeeds,
      pass.observations,
    ].filter(Boolean).map(s => escapeHtml(s!));
    const obs = obsLines.length > 0 ? obsLines.join(" | ") : "";
    return `<tr>
      ${show("seatNumber") ? `<td class="seat">${poltrona}</td>` : ""}
      ${show("nome") ? `<td>${nome}</td>` : ""}
      ${show("cpf") ? `<td>${cpfStr}</td>` : ""}
      ${show("birthDate") ? `<td>${nasc}</td>` : ""}
      ${show("ageCategory") ? `<td>${cat}</td>` : ""}
      ${show("boardingLocation") ? `<td>${embarque}</td>` : ""}
      ${show("whatsapp") ? `<td>${whatsapp}</td>` : ""}
      ${show("checkedInAt") ? `<td>${checkedInAt}</td>` : ""}
      ${show("totalValue") ? `<td class="num">${pass.totalValue != null ? formatBRLPlain(parseFloat(pass.totalValue)) : "—"}</td>` : ""}
      ${show("paidValue") ? `<td class="num">${pass.paidValue != null ? formatBRLPlain(parseFloat(pass.paidValue)) : "—"}</td>` : ""}
      ${show("balance") ? `<td class="num">${pass.balance != null ? formatBRLPlain(parseFloat(pass.balance)) : "—"}</td>` : ""}
      ${show("obsDoc") ? `<td class="obs-cell">${obs}</td>` : ""}
      ${show("assinatura") ? `<td class="sig"></td>` : ""}
    </tr>`;
  };

  const renderFreeRow = (fp: FreePassenger): string => {
    const nome = escapeHtml(fp.name);
    const cpfStr = escapeHtml(formatCpf(fp.cpf));
    const roleStr = escapeHtml(freeRoleLabel[fp.role] ?? fp.role);
    const poltrona = escapeHtml(fp.seatNumber ?? "—");
    const fpWhatsapp = escapeHtml(fp.whatsapp ?? "—");
    const fpCheckedInAt = fp.checkedInAt ? "Embarcado" : "Pendente";
    return `<tr class="free-row">
      ${show("seatNumber") ? `<td class="seat">${poltrona}</td>` : ""}
      ${show("nome") ? `<td>${nome}</td>` : ""}
      ${show("cpf") ? `<td>${cpfStr}</td>` : ""}
      ${show("birthDate") ? `<td>—</td>` : ""}
      ${show("ageCategory") ? `<td>Gratuidade<br><span class="free-role">${roleStr}</span></td>` : ""}
      ${show("boardingLocation") ? `<td>—</td>` : ""}
      ${show("whatsapp") ? `<td>${fpWhatsapp}</td>` : ""}
      ${show("checkedInAt") ? `<td>${fpCheckedInAt}</td>` : ""}
      ${show("totalValue") ? `<td class="num">—</td>` : ""}
      ${show("paidValue") ? `<td class="num">—</td>` : ""}
      ${show("balance") ? `<td class="num">—</td>` : ""}
      ${show("obsDoc") ? `<td class="obs-cell"></td>` : ""}
      ${show("assinatura") ? `<td class="sig"></td>` : ""}
    </tr>`;
  };

  const renderEmptyRow = (seat: string): string => `<tr class="empty-row">
      ${show("seatNumber") ? `<td class="seat">${seat}</td>` : ""}
      ${show("nome") ? `<td></td>` : ""}
      ${show("cpf") ? `<td></td>` : ""}
      ${show("birthDate") ? `<td></td>` : ""}
      ${show("ageCategory") ? `<td></td>` : ""}
      ${show("boardingLocation") ? `<td></td>` : ""}
      ${show("whatsapp") ? `<td></td>` : ""}
      ${show("checkedInAt") ? `<td></td>` : ""}
      ${show("totalValue") ? `<td class="num"></td>` : ""}
      ${show("paidValue") ? `<td class="num"></td>` : ""}
      ${show("balance") ? `<td class="num"></td>` : ""}
      ${show("obsDoc") ? `<td class="obs-cell"></td>` : ""}
      ${show("assinatura") ? `<td class="sig"></td>` : ""}
    </tr>`;

  // --- natural sort for seat labels (handles "1","2","10" and "1A","1B","2A") ---
  const compareSeatLabels = (a: string, b: string): number => {
    const chunkify = (s: string) => s.match(/(\d+|\D+)/g) ?? [];
    const ca = chunkify(a);
    const cb = chunkify(b);
    for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
      const ai = ca[i] ?? "";
      const bi = cb[i] ?? "";
      const na = parseInt(ai, 10);
      const nb = parseInt(bi, 10);
      if (!isNaN(na) && !isNaN(nb)) {
        if (na !== nb) return na - nb;
      } else {
        const cmp = ai.localeCompare(bi);
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  // --- build string-keyed lookup maps (full label is the key) ---
  const seatToPassenger = new Map<string, BoardingPassenger>();
  const lapBabies: BoardingPassenger[] = [];
  for (const pass of allPassengers) {
    if (pass.seatNumber && pass.ageCategory !== "baby") {
      seatToPassenger.set(pass.seatNumber, pass);
    } else {
      lapBabies.push(pass);
    }
  }

  const seatToFree = new Map<string, FreePassenger>();
  const unseatedFree: FreePassenger[] = [];
  for (const fp of freePassengers) {
    if (fp.seatNumber) {
      seatToFree.set(fp.seatNumber, fp);
    } else {
      unseatedFree.push(fp);
    }
  }

  // Determine the ordered seat list:
  // • If all occupied labels are pure integers and totalCapacity is known → enumerate 1..totalCapacity (shows empty seats)
  // • If all occupied labels are pure integers but no capacity → enumerate 1..max(occupied)
  // • Otherwise (alphanumeric labels) → only occupied labels sorted naturally (we can't enumerate unknowns)
  const occupiedLabels = [...seatToPassenger.keys(), ...seatToFree.keys()];
  const allNumeric = occupiedLabels.every(s => /^\d+$/.test(s));

  let orderedSeatList: string[];
  if (allNumeric && totalCapacity && totalCapacity > 0) {
    orderedSeatList = Array.from({ length: totalCapacity }, (_, i) => String(i + 1));
  } else if (allNumeric && occupiedLabels.length > 0) {
    const maxN = Math.max(...occupiedLabels.map(s => parseInt(s, 10)));
    orderedSeatList = Array.from({ length: maxN }, (_, i) => String(i + 1));
  } else {
    orderedSeatList = [...new Set(occupiedLabels)].sort(compareSeatLabels);
  }

  // --- assemble ordered rows ---
  const orderedRows: string[] = [];
  for (const seatLabel of orderedSeatList) {
    if (seatToPassenger.has(seatLabel)) {
      orderedRows.push(renderPassengerRow(seatToPassenger.get(seatLabel)!));
    } else if (seatToFree.has(seatLabel)) {
      orderedRows.push(renderFreeRow(seatToFree.get(seatLabel)!));
    } else {
      orderedRows.push(renderEmptyRow(seatLabel));
    }
  }
  for (const pass of lapBabies) orderedRows.push(renderPassengerRow(pass));
  for (const fp of unseatedFree) orderedRows.push(renderFreeRow(fp));

  const rows = orderedRows.join("");

  const totalsRow = catOrder
    .filter(c => categoryCounts[c])
    .map(c => `<span><strong>${catLabel[c] ?? c}:</strong> ${categoryCounts[c]}</span>`)
    .join("&nbsp;&nbsp;|&nbsp;&nbsp;");

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

  const theadCols = [
    show("seatNumber") ? `<th class="seat">Poltrona</th>` : "",
    show("nome") ? `<th>Nome Completo</th>` : "",
    show("cpf") ? `<th>CPF</th>` : "",
    show("birthDate") ? `<th>Nasc.</th>` : "",
    show("ageCategory") ? `<th>Cat.</th>` : "",
    show("boardingLocation") ? `<th>Embarque</th>` : "",
    show("whatsapp") ? `<th>WhatsApp</th>` : "",
    show("checkedInAt") ? `<th>Status</th>` : "",
    show("totalValue") ? `<th class="num">Valor Total</th>` : "",
    show("paidValue") ? `<th class="num">Valor Pago</th>` : "",
    show("balance") ? `<th class="num">Saldo</th>` : "",
    show("obsDoc") ? `<th class="obs-cell">Obs / Doc.</th>` : "",
    show("assinatura") ? `<th class="sig">Assinatura</th>` : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Manifesto de Passageiros — ANTT</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; padding: 12mm; }
  .header { border-bottom: 2px solid #000; padding-bottom: 6pt; margin-bottom: 8pt; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .title { font-size: 14pt; font-weight: bold; }
  .subtitle { font-size: 8pt; color: #555; margin-top: 2pt; }
  .manifest-no { font-size: 11pt; font-weight: bold; border: 1px solid #000; padding: 3pt 8pt; }
  .section { margin-bottom: 10pt; }
  .section-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; background: #eee; padding: 3pt 6pt; margin-bottom: 4pt; border-left: 3px solid #333; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4pt; }
  .meta-item label { font-weight: bold; font-size: 8pt; margin-right: 4pt; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th, td { border: 1px solid #ccc; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #ddd; font-weight: bold; font-size: 8pt; }
  .num { width: 24pt; text-align: center; }
  .seat { width: 40pt; text-align: center; }
  .obs-cell { min-width: 70pt; font-size: 7.5pt; }
  .sig { width: 60pt; }
  .totals-row { font-size: 9pt; margin: 4pt 0; }
  .crew-table td { font-size: 8pt; }
  .sig-block { margin-top: 20pt; display: flex; gap: 30pt; }
  .sig-line { flex: 1; border-top: 1px solid #000; padding-top: 4pt; font-size: 8pt; text-align: center; }
  .footer { margin-top: 12pt; display: flex; justify-content: space-between; font-size: 8pt; color: #555; border-top: 1px solid #ccc; padding-top: 4pt; }
  .free-row { background: #fffde7; }
  .free-row td { font-style: italic; }
  .empty-row td { color: #bbb; }
  .free-role { font-size: 7pt; color: #555; font-style: normal; }
  @media print { body { padding: 8mm; } }
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
    <div class="meta-item"><label>Organizador:</label>${organizador}</div>
    ${cnpj ? `<div class="meta-item"><label>CNPJ:</label>${cnpj}</div>` : ""}
    ${vehicleType || vehiclePlate ? `<div class="meta-item"><label>Veículo:</label>${vehicleType}${vehiclePlate ? ` — ${vehiclePlate}` : ""}</div>` : ""}
  </div>
</div>
${crewRows ? `<div class="section"><div class="section-title">Tripulação</div><table class="crew-table"><thead><tr><th>Função</th><th>Nome</th><th>Habilitação / Registro</th><th>CPF</th></tr></thead><tbody>${crewRows}</tbody></table></div>` : ""}
<div class="section">
  <div class="section-title">Lista de Passageiros (${allPassengers.length + freePassengers.length})</div>
  <div class="totals-row">${totalsRow}</div>
  <table>
    <thead>
      <tr>${theadCols}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="sig-block">
  <div class="sig-line">Assinatura do Responsável pela Excursão</div>
  <div class="sig-line">Assinatura do Motorista</div>
</div>
<div class="footer">
  <span>Nº Manifesto: <strong>${manifestNumber || "—"}</strong> &nbsp;|&nbsp; VisiteCRM — Gestão de Agências de Turismo</span>
  <span>Impresso em ${emitidoEm}</span>
</div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }
}
