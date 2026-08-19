import { db } from "@workspace/db";
import {
  tenantsTable, usersTable, clientsTable, tripsTable, reservationsTable, paymentsTable,
  pipelinesTable, pipelineStagesTable, dealsTable, notesTable, loyaltyProgramsTable, loyaltyMembersTable,
  boardingLocationsTable, automationsTable, messageTemplatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import {
  ROLES,
  TRIP_STATUS,
  RESERVATION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  type ReservationStatus,
  type PaymentStatus,
  type PaymentType,
} from "@workspace/permissions";

function generateId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

const TENANT_SLUG = "demo-agencia";

async function main() {
  console.log("Seeding demo data...");

  const existingTenant = await db.select().from(tenantsTable).where(eq(tenantsTable.slug, TENANT_SLUG)).limit(1);
  if (existingTenant.length > 0) {
    console.log("Demo tenant already exists, skipping seed.");
    process.exit(0);
  }

  const tenantId = generateId();
  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Agencia Demo Turismo",
    slug: TENANT_SLUG,
    email: "demo@visiteCRM.com.br",
    planId: "professional",
    status: "active",
    limits: { users: 20, clients: 5000, trips: 200 },
  });
  console.log("Tenant created:", tenantId);

  const superadminId = generateId();
  await db.insert(usersTable).values({
    id: superadminId,
    clerkId: "seed_superadmin_" + superadminId,
    tenantId,
    name: "Super Admin",
    email: "superadmin@demo.com",
    role: ROLES.SUPER_ADMIN,
    referralCode: "SUPER1",
    referralBalance: "0",
    isActive: true,
  });

  const adminId = generateId();
  await db.insert(usersTable).values({
    id: adminId,
    clerkId: "seed_admin_" + adminId,
    tenantId,
    name: "Admin Demo",
    email: "admin@demo.com",
    role: ROLES.AGENCY_ADMIN,
    referralCode: "DEMO01",
    referralBalance: "0",
    isActive: true,
  });

  const vendedorId = generateId();
  await db.insert(usersTable).values({
    id: vendedorId,
    clerkId: "seed_vendedor_" + vendedorId,
    tenantId,
    name: "Joao Vendedor",
    email: "joao@demo.com",
    role: ROLES.SALES,
    referralCode: "VEND01",
    referralBalance: "50",
    isActive: true,
  });

  const clienteUserId = generateId();
  await db.insert(usersTable).values({
    id: clienteUserId,
    clerkId: "seed_cliente_" + clienteUserId,
    tenantId,
    name: "Ana Cliente",
    email: "ana.cliente@demo.com",
    role: ROLES.CLIENT,
    referralCode: "CLI001",
    referralBalance: "25",
    isActive: true,
  });
  console.log("Users created (superadmin, agencia, vendedor, cliente)");

  const clientIds: string[] = [];
  const clientsData = [
    { name: "Maria Silva", email: "maria@email.com", whatsapp: "11991234567", city: "Sao Paulo", state: "SP", classification: "vip" },
    { name: "Pedro Santos", email: "pedro@email.com", whatsapp: "11987654321", city: "Campinas", state: "SP", classification: "regular" },
    { name: "Ana Costa", email: "ana@email.com", whatsapp: "21991111111", city: "Rio de Janeiro", state: "RJ", classification: "vip" },
    { name: "Carlos Oliveira", email: "carlos@email.com", whatsapp: "31992222222", city: "Belo Horizonte", state: "MG", classification: "regular" },
    { name: "Lucia Ferreira", email: "lucia@email.com", whatsapp: "41993333333", city: "Curitiba", state: "PR", classification: "regular" },
    { name: "Roberto Lima", email: "roberto@email.com", whatsapp: "51994444444", city: "Porto Alegre", state: "RS", classification: "regular" },
    { name: "Fernanda Alves", email: "fernanda@email.com", whatsapp: "62995555555", city: "Goiania", state: "GO", classification: "vip" },
    { name: "Marcelo Souza", email: "marcelo@email.com", whatsapp: "85996666666", city: "Fortaleza", state: "CE", classification: "regular" },
    { name: "Camila Rodrigues", email: "camila@email.com", whatsapp: "71997777777", city: "Salvador", state: "BA", classification: "regular" },
    { name: "Thiago Martins", email: "thiago@email.com", whatsapp: "92998888888", city: "Manaus", state: "AM", classification: "regular" },
  ];

  for (const c of clientsData) {
    const id = generateId();
    clientIds.push(id);
    await db.insert(clientsTable).values({
      id, tenantId,
      name: c.name, email: c.email, whatsapp: c.whatsapp,
      addressCity: c.city, addressState: c.state, addressCountry: "Brasil",
      classification: c.classification,
      status: TRIP_STATUS.ACTIVE,
      createdById: adminId,
    });
  }
  console.log("10 clients created");

  const tripIds: string[] = [];
  const tripsData = [
    {
      name: "Gramado e Canela - Inverno",
      slug: "gramado-canela-inverno",
      destination: "Gramado, RS",
      destinationCity: "Gramado",
      destinationState: "RS",
      description: "A melhor experiencia de inverno do Brasil. Inclui o Natal Luz e degustacao de chocolates finos.",
      departureDate: new Date("2026-07-10"),
      returnDate: new Date("2026-07-15"),
      totalCapacity: 44,
      reservedSeats: 28,
      priceAdult: "1890",
      type: "excursao",
      category: "lazer",
      status: TRIP_STATUS.ACTIVE,
    },
    {
      name: "Bonito Pantanal - Ecoturismo",
      slug: "bonito-pantanal-ecoturismo",
      destination: "Bonito, MS",
      destinationCity: "Bonito",
      destinationState: "MS",
      description: "Mergulho em rios de aguas cristalinas, trilhas e observacao de fauna pantaneira.",
      departureDate: new Date("2026-08-05"),
      returnDate: new Date("2026-08-10"),
      totalCapacity: 30,
      reservedSeats: 12,
      priceAdult: "2450",
      type: "ecoturismo",
      category: "aventura",
      status: TRIP_STATUS.ACTIVE,
    },
    {
      name: "Nordeste Magico - Natal e Fortaleza",
      slug: "nordeste-magico-natal-fortaleza",
      destination: "Natal, RN / Fortaleza, CE",
      destinationCity: "Natal",
      destinationState: "RN",
      description: "Praias paradisiacas, gastronomia local e passeio de buggy nas dunas.",
      departureDate: new Date("2026-09-15"),
      returnDate: new Date("2026-09-22"),
      totalCapacity: 48,
      reservedSeats: 5,
      priceAdult: "3200",
      type: "excursao",
      category: "praia",
      status: TRIP_STATUS.ACTIVE,
    },
  ];

  for (const t of tripsData) {
    const id = generateId();
    tripIds.push(id);
    const seatMap: Record<string, unknown> = {};
    const cols = 4;
    const rows = Math.ceil(t.totalCapacity / cols);
    let seatNum = 1;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        if (seatNum <= t.totalCapacity) {
          seatMap[`${seatNum}`] = { row: r, col: c, status: seatNum <= t.reservedSeats ? "reserved" : "available" };
          seatNum++;
        }
      }
    }
    await db.insert(tripsTable).values({
      id, tenantId,
      name: t.name, slug: t.slug,
      destination: t.destination, destinationCity: t.destinationCity, destinationState: t.destinationState,
      description: t.description,
      departureDate: t.departureDate, returnDate: t.returnDate,
      totalCapacity: t.totalCapacity, reservedSeats: t.reservedSeats,
      availableSeats: t.totalCapacity - t.reservedSeats,
      priceAdult: t.priceAdult,
      type: t.type, category: t.category,
      status: t.status,
      seatMap,
      seatLayout: "2x2",
      createdById: adminId,
    });
  }
  console.log("3 trips created");

  const voucherCodes = new Set<string>();
  function generateVoucher(): string {
    let code: string;
    do {
      code = "VCH-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (voucherCodes.has(code));
    voucherCodes.add(code);
    return code;
  }

  const reservationIds: string[] = [];
  const reservationsData = [
    { tripIdx: 0, clientIdx: 0, seats: 2, status: RESERVATION_STATUS.CONFIRMED, value: "3780" },
    { tripIdx: 0, clientIdx: 1, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "1890" },
    { tripIdx: 0, clientIdx: 2, seats: 2, status: RESERVATION_STATUS.CONFIRMED, value: "3780" },
    { tripIdx: 0, clientIdx: 3, seats: 1, status: RESERVATION_STATUS.PENDING, value: "1890" },
    { tripIdx: 0, clientIdx: 4, seats: 2, status: RESERVATION_STATUS.CONFIRMED, value: "3780" },
    { tripIdx: 1, clientIdx: 5, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "2450" },
    { tripIdx: 1, clientIdx: 6, seats: 2, status: RESERVATION_STATUS.PENDING, value: "4900" },
    { tripIdx: 1, clientIdx: 7, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "2450" },
    { tripIdx: 2, clientIdx: 0, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "3200" },
    { tripIdx: 2, clientIdx: 8, seats: 2, status: RESERVATION_STATUS.PENDING, value: "6400" },
    { tripIdx: 0, clientIdx: 9, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "1890" },
    { tripIdx: 1, clientIdx: 2, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "2450" },
    { tripIdx: 2, clientIdx: 3, seats: 1, status: RESERVATION_STATUS.PENDING, value: "3200" },
    { tripIdx: 0, clientIdx: 6, seats: 2, status: RESERVATION_STATUS.CONFIRMED, value: "3780" },
    { tripIdx: 1, clientIdx: 4, seats: 1, status: RESERVATION_STATUS.CONFIRMED, value: "2450" },
  ];

  for (const r of reservationsData) {
    const id = generateId();
    reservationIds.push(id);
    const voucherCode = generateVoucher();
    const paidValue = r.status === RESERVATION_STATUS.CONFIRMED ? r.value : "0";
    await db.insert(reservationsTable).values({
      id, tenantId,
      tripId: tripIds[r.tripIdx]!,
      clientId: clientIds[r.clientIdx]!,
      seats: Array.from({ length: r.seats }, (_, i) => String(i + 1)),
      totalValue: r.value,
      paidValue,
      balance: String(Number(r.value) - Number(paidValue)),
      status: r.status,
      voucherCode,
      qrCode: "QR-" + id,
      installments: 1,
      createdById: adminId,
    });
  }
  console.log("15 reservations created");

  const now = new Date();
  const paymentData = [
    { reservationIdx: 0, type: PAYMENT_TYPE.RECEIVABLE, amount: "3780", status: PAYMENT_STATUS.PAID, paidDaysAgo: 20 },
    { reservationIdx: 1, type: PAYMENT_TYPE.RECEIVABLE, amount: "1890", status: PAYMENT_STATUS.PAID, paidDaysAgo: 18 },
    { reservationIdx: 2, type: PAYMENT_TYPE.RECEIVABLE, amount: "3780", status: PAYMENT_STATUS.PAID, paidDaysAgo: 15 },
    { reservationIdx: 4, type: PAYMENT_TYPE.RECEIVABLE, amount: "3780", status: PAYMENT_STATUS.PAID, paidDaysAgo: 12 },
    { reservationIdx: 5, type: PAYMENT_TYPE.RECEIVABLE, amount: "2450", status: PAYMENT_STATUS.PAID, paidDaysAgo: 10 },
    { reservationIdx: 7, type: PAYMENT_TYPE.RECEIVABLE, amount: "2450", status: PAYMENT_STATUS.PAID, paidDaysAgo: 8 },
    { reservationIdx: 8, type: PAYMENT_TYPE.RECEIVABLE, amount: "3200", status: PAYMENT_STATUS.PAID, paidDaysAgo: 7 },
    { reservationIdx: 10, type: PAYMENT_TYPE.RECEIVABLE, amount: "1890", status: PAYMENT_STATUS.PAID, paidDaysAgo: 5 },
    { reservationIdx: 11, type: PAYMENT_TYPE.RECEIVABLE, amount: "2450", status: PAYMENT_STATUS.PAID, paidDaysAgo: 3 },
    { reservationIdx: 13, type: PAYMENT_TYPE.RECEIVABLE, amount: "3780", status: PAYMENT_STATUS.PAID, paidDaysAgo: 2 },
    { reservationIdx: 3, type: PAYMENT_TYPE.RECEIVABLE, amount: "1890", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 6, type: PAYMENT_TYPE.RECEIVABLE, amount: "4900", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 9, type: PAYMENT_TYPE.RECEIVABLE, amount: "6400", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 12, type: PAYMENT_TYPE.RECEIVABLE, amount: "3200", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 3, type: PAYMENT_TYPE.PAYABLE, amount: "800", status: PAYMENT_STATUS.PAID, paidDaysAgo: 15 },
    { reservationIdx: 5, type: PAYMENT_TYPE.PAYABLE, amount: "500", status: PAYMENT_STATUS.PAID, paidDaysAgo: 9 },
    { reservationIdx: 8, type: PAYMENT_TYPE.PAYABLE, amount: "1200", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 1, type: PAYMENT_TYPE.PAYABLE, amount: "300", status: PAYMENT_STATUS.PAID, paidDaysAgo: 17 },
    { reservationIdx: 11, type: PAYMENT_TYPE.PAYABLE, amount: "600", status: PAYMENT_STATUS.PENDING, paidDaysAgo: 0 },
    { reservationIdx: 13, type: PAYMENT_TYPE.PAYABLE, amount: "900", status: PAYMENT_STATUS.PAID, paidDaysAgo: 1 },
  ];

  for (const p of paymentData) {
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + (p.status === "pending" ? 30 : -p.paidDaysAgo));
    const paidAt = p.status === "paid" ? new Date(now.getTime() - p.paidDaysAgo * 86400000) : null;
    await db.insert(paymentsTable).values({
      id: generateId(), tenantId,
      reservationId: reservationIds[p.reservationIdx],
      type: p.type as "receivable" | "payable",
      category: p.type === "receivable" ? "reservation" : "expense",
      amount: p.amount,
      paymentMethod: p.type === "receivable" ? "pix" : "transferencia",
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate,
      paidAt: paidAt ?? undefined,
      status: p.status,
    });
  }
  console.log("20 payments created");

  const pipelineId = generateId();
  await db.insert(pipelinesTable).values({
    id: pipelineId, tenantId,
    name: "Pipeline Principal",
    isDefault: true,
    isActive: true,
  });
  const stageIds = [generateId(), generateId(), generateId(), generateId()];
  await db.insert(pipelineStagesTable).values([
    { id: stageIds[0]!, tenantId, pipelineId, name: "Contato Inicial", color: "#6366F1", order: 1, isFinal: false },
    { id: stageIds[1]!, tenantId, pipelineId, name: "Proposta Enviada", color: "#F59E0B", order: 2, isFinal: false },
    { id: stageIds[2]!, tenantId, pipelineId, name: "Em Negociacao", color: "#EF4444", order: 3, isFinal: false },
    { id: stageIds[3]!, tenantId, pipelineId, name: "Fechado", color: "#10B981", order: 4, isFinal: true },
  ]);

  for (let i = 0; i < 4; i++) {
    const stageIdx = Math.min(i, stageIds.length - 1);
    await db.insert(dealsTable).values({
      id: generateId(), tenantId,
      stageId: stageIds[stageIdx]!,
      title: `Pacote Grupo ${i + 1}`,
      description: `Proposta de viagem em grupo`,
      value: String((i + 1) * 5000),
      clientId: clientIds[i],
      ownerId: vendedorId,
      status: stageIdx === 3 ? "won" : "open",
    });
  }
  console.log("Pipeline stages and deals created");

  const loyaltyId = generateId();
  await db.insert(loyaltyProgramsTable).values({
    id: loyaltyId, tenantId,
    name: "Clube Fidelidade Visite",
    description: "Ganhe pontos em cada reserva e troque por descontos.",
    pointsPerReal: "1",
    realPerPoint: "0.01",
    minRedeemPoints: 500,
    isActive: true,
  });

  for (let i = 0; i < 5; i++) {
    const memberId = generateId();
    await db.insert(loyaltyMembersTable).values({
      id: memberId, tenantId,
      programId: loyaltyId,
      clientId: clientIds[i]!,
      totalPoints: (i + 1) * 200,
      availablePoints: (i + 1) * 150,
      tier: i < 2 ? "ouro" : "bronze",
    });
  }
  console.log("Loyalty program created");

  const boardingId = generateId();
  await db.insert(boardingLocationsTable).values({
    id: boardingId, tenantId,
    name: "Terminal Tiete",
    address: "Av. Cruzeiro do Sul, 1800",
    city: "Sao Paulo",
    state: "SP",
    reference: "Proximo ao Metro Tiete",
    departureTime: "06:00",
  });

  await db.insert(automationsTable).values({
    id: generateId(), tenantId,
    name: "Lembrete de Pagamento",
    description: "Envia WhatsApp 3 dias antes do vencimento",
    triggerType: "payment_due_soon",
    triggerConfig: { daysBefore: 3 },
    isActive: true,
    executionsCount: 12,
  });

  await db.insert(messageTemplatesTable).values({
    id: generateId(), tenantId,
    name: "Confirmacao de Reserva",
    channel: "whatsapp",
    content: "Ola {{nome}}, sua reserva para {{viagem}} foi confirmada! Voucher: {{voucher}}. Embarque: {{local_embarque}} as {{horario}}.",
    variables: ["nome", "viagem", "voucher", "local_embarque", "horario"],
    category: "reservation",
  });
  console.log("Automations and templates created");

  for (const clientId of clientIds.slice(0, 3)) {
    await db.insert(notesTable).values({
      id: generateId(),
      clientId,
      createdById: adminId,
      content: "Cliente demonstrou interesse em pacotes de inverno. Preferencia por hotel 4 estrelas.",
      isPrivate: false,
    });
  }
  console.log("Notes created");

  console.log("\nSeed completo! Tenant:", TENANT_SLUG, "(id:", tenantId + ")");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
