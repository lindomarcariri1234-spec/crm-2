       eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]),
      ));

    let reservedSeats = 0;
    let confirmedSeats = 0;
    for (const r of activeReservations) {
      const seatCount = (r.seats ?? []).length;
      if (r.status === RESERVATION_STATUS.CONFIRMED) confirmedSeats += seatCount;
      else reservedSeats += seatCount;
    }
    const fpCount = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]).length : 0;
    const totalCapacity = Number(trip.totalCapacity) || 0;
    const availableSeats = Math.max(0, totalCapacity - reservedSeats - confirmedSeats - fpCount);

    await db.update(tripsTable).set({
      reservedSeats,
      confirmedSeats,
      availableSeats,
    }).where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)));

    await db.insert(auditLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      userId: me.id,
      action: "sync_seat_counters",
      entityType: "trip",
      entityId: req.params.id,
      after: { reservedSeats, confirmedSeats, availableSeats, totalCapacity, freePassengers: fpCount },
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    const [refreshed] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!refreshed) { next(new AppError("Falha ao buscar viagem atualizada", 500, "TRIP_FETCH_FAILED")); return; }
    res.json(formatTrip(refreshed));
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/seats/stream", async (req, res, next: NextFunction): Promise<void> => {
  const me = await requireAuth(req, res);
  if (!me) return;

  const features = await getTenantSupportedFeatures(me.tenantId);
  if (!hasSeatMapFeature(features)) {
    next(new ForbiddenError("Mapa de assentos não está disponível no seu plano atual", "FEATURE_NOT_IN_PLAN"));
    return;
  }

  const [trip] = await db.select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
    .limit(1);
  if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

  const tripId = trip.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  addSeatClient(tripId, res);
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 30000);
  req.on("close", () => {
    clearInterval(ping);
    removeSeatClient(tripId, res);
  });
});

router.get("/trips/:id/boarding-panel", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    let numberingType = "sequential";
    if (trip.layoutId) {
      const [layout] = await db.select({ numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
        .limit(1);
      if (layout) numberingType = layout.numberingType;
    }

    if (!trip.manifestNumber) {
      const year = trip.departureDate.getFullYear();
      let assigned: string | null | undefined = null;
      for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
        const [countRow] = await db.select({ count: sql<number>`count(*)` })
          .from(tripsTable)
          .where(and(
            eq(tripsTable.tenantId, me.tenantId),
            sql`manifest_number IS NOT NULL`,
            sql`EXTRACT(YEAR FROM departure_date) = ${year}`,
          ));
        const seq = (Number(countRow?.count ?? 0) + 1 + attempt).toString().padStart(6, "0");
        const candidate = `MAN-${year}-${seq}`;
        try {
          await db.update(tripsTable).set({ manifestNumber: candidate })
            .where(and(
              eq(tripsTable.id, trip.id),
              eq(tripsTable.tenantId, me.tenantId),
              sql`manifest_number IS NULL`,
            ));
        } catch {
          continue;
        }
        const [refreshed] = await db.select({ manifestNumber: tripsTable.manifestNumber })
          .from(tripsTable)
          .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, me.tenantId)))
          .limit(1);
        assigned = refreshed?.manifestNumber;
      }
      if (!assigned) {
        const [final] = await db.select({ manifestNumber: tripsTable.manifestNumber })
          .from(tripsTable)
          .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, me.tenantId)))
          .limit(1);
        assigned = final?.manifestNumber;
      }
      if (!assigned) {
        req.log.error({ tripId: trip.id }, "Failed to assign manifest number after 5 attempts");
        next(new AppError("Não foi possível gerar o número do manifesto. Tente novamente.", 500, "MANIFEST_NUMBER_FAILED"));
        return;
      }
      trip.manifestNumber = assigned;
    }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    if (reservations.length === 0) {
      const [tenantEarly] = await db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
      const earlyFreePassengers = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
      const earlyFreeCheckedIn = earlyFreePassengers.filter(fp => !!fp.checkedInAt).length;
      res.json({
        tripId: trip.id,
        tripName: trip.name,
        departureDate: trip.departureDate.toISOString(),
        totalPassengers: earlyFreePassengers.length,
        checkedIn: earlyFreeCheckedIn,
        passengers: [],
        freePassengers: earlyFreePassengers,
        tenantName: tenantEarly?.name ?? "",
        tenantCnpj: tenantEarly?.cnpj ?? null,
        numberingType,
        boardingPoints: (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string; address?: string }>,
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
      });
      return;
    }

    const reservationIds = reservations.map(r => r.id);
    const clientIds = [...new Set(reservations.map(r => r.clientId).filter((id): id is string => id !== null))];

    const [passengers, clients, [tenant], boardingLocations] = await Promise.all([
      db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds)),
      db.select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone, whatsapp: clientsTable.whatsapp }).from(clientsTable).where(inArray(clientsTable.id, clientIds)),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name, address: boardingLocationsTable.address, departureTime: boardingLocationsTable.departureTime }).from(boardingLocationsTable).where(eq(boardingLocationsTable.tenantId, me.tenantId)),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));
    const clientMap = new Map(clients.map(c => [c.id, c]));

    const boardingPassengers = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const client = reservation?.clientId ? clientMap.get(reservation.clientId) : undefined;
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        id: p.id,
        reservationId: p.reservationId,
        voucherCode: reservation?.voucherCode ?? "",
        reservationNumber: reservation?.reservationNumber ?? null,
        clientName: client?.name ?? "—",
        name: p.name,
        cpf: p.cpf ?? null,
        seatNumber: p.seatNumber ?? null,
        ageCategory: p.ageCategory,
        checkedInAt: p.checkedInAt?.toISOString() ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        phone: client?.phone ?? null,
        whatsapp: client?.whatsapp ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        disembarkLocationId: p.disembarkLocationId ?? null,
        passengerPhone: p.phone ?? null,
        observations: p.observations ?? null,
        specialNeeds: p.specialNeeds ?? null,
        documentType: p.documentType ?? null,
        isGratuidade: reservation?.isGratuidade ?? false,
        totalValue: reservation?.totalValue ?? null,
        paidValue: reservation?.paidValue ?? null,
        balance: reservation?.balance ?? null,
      };
    });

    const checkedIn = boardingPassengers.filter(p => p.checkedInAt !== null).length;
    const tripFreePassengers = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const freeCheckedIn = tripFreePassengers.filter(fp => !!fp.checkedInAt).length;

    res.json({
      tripId: trip.id,
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      totalPassengers: boardingPassengers.length + tripFreePassengers.length,
      checkedIn: checkedIn + freeCheckedIn,
      passengers: boardingPassengers,
      freePassengers: tripFreePassengers,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
      numberingType,
      boardingPoints: [
        ...(trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string; address?: string }>,
        ...boardingLocations.map(bl => ({ id: bl.id, name: bl.name, time: bl.departureTime ?? undefined, address: bl.address })),
      ],
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
    });
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/free-passengers/:fpId/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const fps: FreePassenger[] = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const idx = fps.findIndex(fp => fp.id === req.params.fpId);
    if (idx === -1) { next(new NotFoundError("Free passenger not found", "NOT_FOUND")); return; }

    const now = new Date().toISOString();
    fps[idx] = { ...fps[idx], checkedInAt: now };
    await db.update(tripsTable).set({ freePassengers: fps }).where(eq(tripsTable.id, trip.id));

    res.json({ id: fps[idx].id, checkedInAt: now });
  } catch (err) {
    next(err);
  }
});

router.delete("/trips/:id/free-passengers/:fpId/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const fps: FreePassenger[] = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const idx = fps.findIndex(fp => fp.id === req.params.fpId);
    if (idx === -1) { next(new NotFoundError("Free passenger not found", "NOT_FOUND")); return; }

    fps[idx] = { ...fps[idx], checkedInAt: null };
    await db.update(tripsTable).set({ freePassengers: fps }).where(eq(tripsTable.id, trip.id));

    res.json({ id: fps[idx].id, checkedInAt: null });
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/passengers/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const [exportLayoutRow] = trip.layoutId
      ? await db.select({ numberingType: vehicleLayoutsTable.numberingType })
          .from(vehicleLayoutsTable)
          .where(eq(vehicleLayoutsTable.id, trip.layoutId))
          .limit(1)
      : [undefined];
    const exportNumberingType = exportLayoutRow?.numberingType ?? null;

    const statusParam = req.query.status as string | undefined;
    const validStatuses: string[] = [...Object.values(RESERVATION_STATUS), "all"];
    if (statusParam && !validStatuses.includes(statusParam)) {
      next(new ValidationError(`Status inválido: "${statusParam}". Valores permitidos: ${validStatuses.join(", ")}`, "INVALID_STATUS"));
      return;
    }
    const filterStatus = statusParam ?? null;

    const reservations = await db.select().from(reservationsTable)
      .where(
        filterStatus === "all"
          ? and(eq(reservationsTable.tripId, trip.id), eq(reservationsTable.tenantId, me.tenantId))
          : filterStatus
            ? and(
                eq(reservationsTable.tripId, trip.id),
                eq(reservationsTable.tenantId, me.tenantId),
                eq(reservationsTable.status, filterStatus as ReservationStatus),
              )
            : and(
                eq(reservationsTable.tripId, trip.id),
                eq(reservationsTable.tenantId, me.tenantId),
                sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
              ),
      );

    const boardingPoints: Array<{ id: string; name: string; time?: string }> =
      Array.isArray(trip.boardingPoints) ? (trip.boardingPoints as Array<{ id: string; name: string; time?: string }>) : [];
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp.name]));

    const boardingLocations = await db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name })
      .from(boardingLocationsTable)
      .where(eq(boardingLocationsTable.tenantId, me.tenantId));
    const blMap = new Map(boardingLocations.map(bl => [bl.id, bl.name]));

    const AGE_LABELS: Record<string, string> = {
      adult: "Adulto",
      child: "Criança",
      senior: "Idoso",
      infant: "Bebê",
    };

    let rows: string[][] = [];
    if (reservations.length > 0) {
      const reservationIds = reservations.map(r => r.id);
      const passengers = await db.select().from(passengersTable)
        .where(inArray(passengersTable.reservationId, reservationIds));

      const reservationMap = new Map(reservations.map(r => [r.id, r]));
      const emittedReservationIds = new Set<string>();

      rows = passengers.map(p => {
        const reservation = reservationMap.get(p.reservationId);
        const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
        const boardingName = effectiveBoardingLocationId ? (bpMap.get(effectiveBoardingLocationId) ?? blMap.get(effectiveBoardingLocationId) ?? effectiveBoardingLocationId) : "";
        const birthDateStr = p.birthDate ? p.birthDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
        const checkInStr = p.checkedInAt ? "Sim" : "Não";
        const totalValue = Number(reservation?.totalValue ?? 0);
        const discount = Number(reservation?.discountTotal ?? 0);
        const financialValues = reservation
          ? getPassengerExportFinancialValues(reservation.id, totalValue, discount, emittedReservationIds)
          : ["0.00", "0.00", "0.00"] as [string, string, string];
        return [
          p.name,
          reservation?.reservationNumber ?? reservation?.voucherCode ?? "",
          p.cpf ?? "",
          p.rg ?? "",
          birthDateStr,
          AGE_LABELS[p.ageCategory] ?? p.ageCategory,
          seatWithPosition(p.seatNumber ?? null, exportNumberingType),
          boardingName,
          checkInStr,
          "",
          ...financialValues,
        ];
      });
    }

    const freePassengersData = Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [];
    const freeRoleLabel: Record<string, string> = { organizer: "Organizador", guide: "Guia de Turismo" };
    const freeRows: string[][] = freePassengersData.map(fp => [
      fp.name,
      "",
      fp.cpf ?? "",
      "",
      "",
      "Gratuidade",
      seatWithPosition(fp.seatNumber ?? null, exportNumberingType),
      "",
      "—",
      freeRoleLabel[fp.role] ?? fp.role,
      "0.00",
      "0.00",
      "0.00",
    ]);

    const header = [
      "Passageiro", "Nº Reserva", "CPF", "RG", "Data Nasc.", "Categoria", "Assento",
      "Local de Embarque", "Check-in", "Função", "Valor Total", "Valor Base", "Desconto",
    ];
    const csvLines = [header, ...rows, ...freeRows].map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csvContent = "\uFEFF" + csvLines.join("\n");

    const safeName = trip.name.replace(/[^a-zA-Z0-9\-_]/g, "_");
    const dateStr = format(new Date(), "yyyy-MM-dd");
    const statusLabelMap: Record<string, string> = {
      confirmed: "confirmados",
      pending: "pendentes",
      completed: "concluidos",
      cancelled: "cancelados",
      all: "todos",
    };
    const statusLabel = filterStatus ? (statusLabelMap[filterStatus] ?? filterStatus) : "ativos";
    const filename = `passageiros-${safeName}-${statusLabel}-${dateStr}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/sync-passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    if (reservations.length === 0) {
      res.json({ created: 0 });
      return;
    }

    const reservationIds = reservations.map(r => r.id);
    const existingPassengers = await db.select({ reservationId: passengersTable.reservationId })
      .from(passengersTable)
      .where(inArray(passengersTable.reservationId, reservationIds));
    const reservationIdsWithPassengers = new Set(existingPassengers.map(p => p.reservationId));

    const reservationsNeedingPassenger = reservations.filter(r => !reservationIdsWithPassengers.has(r.id));

    if (reservationsNeedingPassenger.length === 0) {
      res.json({ created: 0 });
      return;
    }

    const clientIds = [...new Set(reservationsNeedingPassenger.map(r => r.clientId).filter((id): id is string => id !== null))];
    const clients = await db.select().from(clientsTable)
      .where(inArray(clientsTable.id, clientIds));
    const clientMap = new Map(clients.map(c => [c.id, c]));

    let created = 0;
    for (const r of reservationsNeedingPassenger) {
      const client = r.clientId ? clientMap.get(r.clientId) : undefined;
      if (!client) continue;
      const inserted = await db.insert(passengersTable).values({
        id: generateId(),
        reservationId: r.id,
        name: client.name,
        cpf: client.cpf ?? null,
        rg: client.rg ?? null,
        birthDate: client.birthDate ?? null,
        ...(() => {
          const cat = deriveAgeCategory(client.birthDate ?? null);
          return { ageCategory: cat, isChildUnder7: syncIsChildUnder7(cat) };
        })(),
        seatNumber: r.seats?.[0] ?? null,
        isPrimary: true,
        boardingLocationId: r.boardingLocationId ?? null,
      }).onConflictDoNothing().returning({ id: passengersTable.id });
      if (inserted.length > 0) created++;
    }

    res.json({ created });
  } catch (err) {
    next(err);
  }
});

const UpdatePassengerBody = z.object({
  boardingLocationId: z.string().nullish(),
  disembarkLocationId: z.string().nullish(),
  passengerPhone: z.string().nullish(),
  observations: z.string().nullish(),
  specialNeeds: z.string().nullish(),
  documentType: z.string().nullish(),
});

router.patch("/trips/:tripId/passengers/:passengerId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { tripId, passengerId } = req.params;
    const parsedBody = UpdatePassengerBody.safeParse(req.body);
    if (!parsedBody.success) {
      next(new ValidationError(parsedBody.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { boardingLocationId, disembarkLocationId, passengerPhone, observations, specialNeeds, documentType } = parsedBody.data;

    const [trip] = await db.select({ id: tripsTable.id, boardingPoints: tripsTable.boardingPoints })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id, reservationId: passengersTable.reservationId })
      .from(passengersTable)
      .where(eq(passengersTable.id, passengerId))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passenger not found", "NOT_FOUND")); return; }

    const [reservation] = await db.select({ tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, passenger.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation || reservation.tripId !== trip.id) { next(new NotFoundError("Passenger not found", "NOT_FOUND")); return; }

    if (boardingLocationId === undefined && disembarkLocationId === undefined &&
        passengerPhone === undefined && observations === undefined &&
        specialNeeds === undefined && documentType === undefined) {
      next(new AppError("At least one field must be provided", 422, "VALIDATION_ERROR"));
      return;
    }

    const VALID_DOCUMENT_TYPES = ["RG", "CNH", "PASSAPORTE", "Certidão de Nascimento"];
    if (documentType !== undefined && documentType !== null && !VALID_DOCUMENT_TYPES.includes(documentType)) {
      next(new AppError(`Invalid documentType. Must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}`, 422, "VALIDATION_ERROR")); return;
    }

    const boardingPointIds = new Set(
      ((trip.boardingPoints ?? []) as Array<{ id: string }>).map(bp => bp.id)
    );

    if (boardingLocationId !== undefined && boardingLocationId !== null && !boardingPointIds.has(boardingLocationId)) {
      next(new AppError("Invalid boardingLocationId: not in trip boarding points", 422, "VALIDATION_ERROR"));
      return;
    }
    if (disembarkLocationId !== undefined && disembarkLocationId !== null && !boardingPointIds.has(disembarkLocationId)) {
      next(new AppError("Invalid disembarkLocationId: not in trip boarding points", 422, "VALIDATION_ERROR"));
      return;
    }

    const updateData: Partial<typeof passengersTable.$inferSelect> = {};
    if (boardingLocationId !== undefined) updateData.boardingLocationId = boardingLocationId;
    if (disembarkLocationId !== undefined) updateData.disembarkLocationId = disembarkLocationId;
    if (passengerPhone !== undefined) updateData.phone = passengerPhone;
    if (observations !== undefined) updateData.observations = observations;
    if (specialNeeds !== undefined) updateData.specialNeeds = specialNeeds;
    if (documentType !== undefined) updateData.documentType = documentType;

    const [updated] = await db.update(passengersTable)
      .set(updateData)
      .where(eq(passengersTable.id, passengerId))
      .returning();

    res.json({
      id: updated.id,
      boardingLocationId: updated.boardingLocationId ?? null,
      disembarkLocationId: updated.disembarkLocationId ?? null,
      passengerPhone: updated.phone ?? null,
      observations: updated.observations ?? null,
      specialNeeds: updated.specialNeeds ?? null,
      documentType: updated.documentType ?? null,
    });
  } catch (err) {
    next(err);
  }
});


const SendManifestBody = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), to: z.string().email("Endereço de e-mail inválido") }),
  z.object({ channel: z.literal("whatsapp"), to: z.string().min(8, "Número de WhatsApp muito curto").max(20, "Número de WhatsApp muito longo").regex(/^[\d\s\(\)\-\+]+$/, "Número de WhatsApp inválido") }),
]);

router.post("/trips/:id/manifest/send", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = SendManifestBody.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      next(new ValidationError(firstIssue?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { channel, to } = parsed.data;

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Excursão não encontrada", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const reservationIds = reservations.map(r => r.id);

    const [passengers, [tenant], [layoutRow]] = await Promise.all([
      reservationIds.length > 0
        ? db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      trip.layoutId
        ? db.select({ numberingType: vehicleLayoutsTable.numberingType }).from(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.id, trip.layoutId)).limit(1)
        : Promise.resolve([undefined]),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const manifestPassengers: ManifestPassenger[] = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        name: p.name,
        cpf: p.cpf ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        ageCategory: p.ageCategory,
        seatNumber: p.seatNumber ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        documentType: p.documentType ?? null,
        specialNeeds: p.specialNeeds ?? null,
        observations: p.observations ?? null,
      };
    });

    const panel: ManifestPanel = {
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      departureTime: trip.departureTime ?? null,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
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
      freePassengers: Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [],
      destinationCity: trip.destinationCity,
      destinationState: trip.destinationState,
      numberingType: layoutRow?.numberingType ?? null,
    };

    const auditMeta: Record<string, string> = { channel, to: channel === "whatsapp" ? to : to.replace(/(.{2}).+(@.+)/, "$1***$2") };

    if (channel === "email") {
      const pdfQueue = getPdfQueue();
      if (pdfQueue) {
        await pdfQueue.add("manifest", {
          type: "manifest",
          tenantId: me.tenantId,
          tripId: trip.id,
          recipientEmail: to,
          userId: me.id,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        });
        res.status(202).json({ success: true, channel: "email", queued: true });
        return;
      }

      if (!areWorkersEnabled()) {
        logger.warn(
          { jobType: "pdf-manifest", tenantId: me.tenantId, tripId: trip.id },
          "[workers-disabled] ENABLE_WORKERS=false — sending manifest PDF directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
        );
      }

      const [html, pdfBuffer] = await Promise.all([
        Promise.resolve(generateManifestHtml(panel)),
        generateManifestPdf(panel),
      ]);

      const result = await sendManifestEmail({
        to,
        tripName: trip.name,
        manifestNumber: trip.manifestNumber ?? null,
        agencyName: tenant?.name ?? "VisiteCRM",
        htmlContent: html,
        pdfAttachment: pdfBuffer,
      });

      if (!result.success) {
        req.log.error({ error: result.error }, "Failed to send manifest email");
        next(new AppError(result.error ?? "Falha ao enviar e-mail", 500, "MANIFEST_EMAIL_FAILED"));
        return;
      }

      await db.insert(auditLogsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        userId: me.id,
        action: "manifest_sent",
        entityType: "trip",
        entityId: trip.id,
        after: auditMeta,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.json({ success: true, channel: "email" });
    } else {
      const depDate = trip.departureDate ? format(trip.departureDate, "dd/MM/yyyy", { locale: ptBR }) : "";
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      const host = req.headers["x-forwarded-host"] ?? req.get("host") ?? "";
      const manifestLink = `${proto}://${host}/trips/${trip.id}/passengers`;

      const messageParts = [
        `📋 *Manifesto ANTT — ${trip.name}*`,
        trip.manifestNumber ? `Nº Manifesto: ${trip.manifestNumber}` : null,
        panel.destinationCity ? `Destino: ${panel.destinationCity}${panel.destinationState ? `/${panel.destinationState}` : ""}` : null,
        depDate ? `Saída: ${depDate}` : null,
        `Total de passageiros: ${manifestPassengers.length + panel.freePassengers.length}`,
        ``,
        `🔗 Acesso ao manifesto: ${manifestLink}`,
        ``,
        `_Emitido via VisiteCRM_`,
      ].filter((l): l is string => l !== null).join("\n");

      const digits = to.replace(/\D/g, "");
      const phone = digits.startsWith("55") ? digits : `55${digits}`;
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageParts)}`;

      await db.insert(auditLogsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        userId: me.id,
        action: "manifest_sent",
        entityType: "trip",
        entityId: trip.id,
        after: auditMeta,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.json({ success: true, channel: "whatsapp", whatsappUrl });
    }
  } catch (err) {
    next(err);
  }
});

router.get("/trips/:id/manifest/pdf", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Excursão não encontrada", "NOT_FOUND")); return; }

    const reservations = await db.select().from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const reservationIds = reservations.map(r => r.id);

    const [passengers, [tenant], [layoutRow]] = await Promise.all([
      reservationIds.length > 0
        ? db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      db.select({ name: tenantsTable.name, cnpj: tenantsTable.cnpj }).from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1),
      trip.layoutId
        ? db.select({ numberingType: vehicleLayoutsTable.numberingType }).from(vehicleLayoutsTable).where(eq(vehicleLayoutsTable.id, trip.layoutId)).limit(1)
        : Promise.resolve([undefined]),
    ]);

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const manifestPassengers: ManifestPassenger[] = passengers.map(p => {
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      return {
        name: p.name,
        cpf: p.cpf ?? null,
        birthDate: p.birthDate?.toISOString() ?? null,
        ageCategory: p.ageCategory,
        seatNumber: p.seatNumber ?? null,
        boardingLocationId: effectiveBoardingLocationId,
        documentType: p.documentType ?? null,
        specialNeeds: p.specialNeeds ?? null,
        observations: p.observations ?? null,
      };
    });

    const panel: ManifestPanel = {
      tripName: trip.name,
      departureDate: trip.departureDate.toISOString(),
      departureTime: trip.departureTime ?? null,
      tenantName: tenant?.name ?? "",
      tenantCnpj: tenant?.cnpj ?? null,
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
      freePassengers: Array.isArray(trip.freePassengers) ? (trip.freePassengers as FreePassenger[]) : [],
      destinationCity: trip.destinationCity,
      destinationState: trip.destinationState,
      numberingType: layoutRow?.numberingType ?? null,
    };

    const pdfBuffer = await generateManifestPdf(panel);

    const safeName = trip.name.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `manifesto-${safeName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "Error generating manifest PDF");
    next(err);
  }
});

const AddTripMediaBody = z.object({
  url: z.string().url(),
  type: z.enum(["image", "video"]).default("image"),
  caption: z.string().max(500).optional(),
});

router.get("/trips/:id/media", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const media = await db.select()
      .from(tripMediaTable)
      .where(and(eq(tripMediaTable.tripId, req.params.id), eq(tripMediaTable.tenantId, me.tenantId)))
      .orderBy(asc(tripMediaTable.createdAt));

    res.json({
      data: media.map(m => ({
        id: m.id,
        url: m.url,
        type: m.type,
        caption: m.caption,
        uploadedByUserId: m.uploadedByUserId,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

router.post("/trips/:id/media", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const parsed = AddTripMediaBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const id = generateId();
    await db.insert(tripMediaTable).values({
      id,
      tripId: req.params.id,
      tenantId: me.tenantId,
      url: parsed.data.url,
      type: parsed.data.type,
      caption: parsed.data.caption ?? null,
      uploadedByUserId: me.id,
    });

    res.status(201).json({ id, url: parsed.data.url, type: parsed.data.type, caption: parsed.data.caption ?? null, createdAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

router.delete("/trips/:id/media/:mediaId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const [media] = await db.select()
      .from(tripMediaTable)
      .where(and(eq(tripMediaTable.id, req.params.mediaId), eq(tripMediaTable.tenantId, me.tenantId)))
      .limit(1);
    if (!media || media.tripId !== req.params.id) { next(new NotFoundError("Mídia não encontrada", "NOT_FOUND")); return; }

    await db.delete(tripMediaTable).where(eq(tripMediaTable.id, req.params.mediaId));

    // Best-effort: remove the file from UploadThing storage.
    // deleteOrphanedFile catches its own errors internally, so a storage
    // failure never blocks the 204 response.
    await deleteOrphanedFile(media.url, null, req.log, me.tenantId);

    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Staff check-in routes (Clerk JWT) ───────────────────────────────────────

router.get("/trips/:id/checkins", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }
    const checkins = await db.select()
      .from(tripCheckinsTable)
      .where(and(eq(tripCheckinsTable.tripId, req.params.id!), eq(tripCheckinsTable.tenantId, me.tenantId)));
    res.json({ data: checkins });
  } catch (err) { next(err); }
});

router.post("/trips/:id/checkins", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const { passengerId, reservationId, notes, status } = z.object({
      passengerId: z.string().min(1),
      reservationId: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["present", "absent"]).default("present"),
    }).parse(req.body);

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, passengerId),
        eq(reservationsTable.tripId, req.params.id!),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    const checkedInAt = new Date();
    await db.insert(tripCheckinsTable)
      .values({
        id: generateId(),
        tripId: req.params.id!,
        tenantId: me.tenantId,
        passengerId,
        reservationId: reservationId ?? null,
        checkedInByUserRef: me.id,
        checkedInAt,
        notes: notes ?? null,
        status,
      })
      .onConflictDoUpdate({
        target: [tripCheckinsTable.tripId, tripCheckinsTable.passengerId],
        set: { checkedInByUserRef: me.id, checkedInAt, notes: notes ?? null, status },
      });

    await db.update(passengersTable)
      .set({ checkedInAt: status === "present" ? checkedInAt : null })
      .where(eq(passengersTable.id, passengerId));

    emitBoardingUpdate(req.params.id!);
    res.status(201).json({ success: true, passengerId, status, checkedInAt: checkedInAt.toISOString() });
  } catch (err) { next(err); }
});

router.delete("/trips/:id/checkins/:passengerId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, req.params.passengerId!),
        eq(reservationsTable.tripId, req.params.id!),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    await db.delete(tripCheckinsTable)
      .where(and(
        eq(tripCheckinsTable.tripId, req.params.id!),
        eq(tripCheckinsTable.passengerId, req.params.passengerId!),
        eq(tripCheckinsTable.tenantId, me.tenantId),
      ));
    await db.update(passengersTable)
      .set({ checkedInAt: null })
      .where(eq(passengersTable.id, req.params.passengerId!));
    emitBoardingUpdate(req.params.id!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Boarding live status + SSE stream ────────────────────────────────────────

router.get("/trips/:id/boarding-live", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const [trip] = await db.select({
      id: tripsTable.id,
      name: tripsTable.name,
      status: tripsTable.status,
      departureDate: tripsTable.departureDate,
      boardingPoints: tripsTable.boardingPoints,
      freePassengers: tripsTable.freePassengers,
    })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const reservations = await db.select({ id: reservationsTable.id, status: reservationsTable.status, boardingLocationId: reservationsTable.boardingLocationId })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, me.tenantId),
        sql`${reservationsTable.status} NOT IN (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.REFUNDED})`,
      ));

    const activeResIds = reservations.map(r => r.id);
    const passengers = activeResIds.length > 0
      ? await db.select({
          id: passengersTable.id,
          name: passengersTable.name,
          seatNumber: passengersTable.seatNumber,
          boardingLocationId: passengersTable.boardingLocationId,
          reservationId: passengersTable.reservationId,
          checkedInAt: passengersTable.checkedInAt,
        }).from(passengersTable).where(inArray(passengersTable.reservationId, activeResIds))
      : [];

    const checkins = await db.select()
      .from(tripCheckinsTable)
      .where(and(eq(tripCheckinsTable.tripId, trip.id), eq(tripCheckinsTable.tenantId, me.tenantId)));

    const checkinMap = new Map(checkins.map(c => [c.passengerId, c]));

    const [boardingLocations] = await Promise.all([
      db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name })
        .from(boardingLocationsTable)
        .where(eq(boardingLocationsTable.tenantId, me.tenantId)),
    ]);

    const boardingPoints = (Array.isArray(trip.boardingPoints) ? trip.boardingPoints : []) as Array<{ id: string; name: string; time?: string }>;
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp]));
    const blMap = new Map(boardingLocations.map(bl => [bl.id, bl.name]));

    const reservationMap = new Map(reservations.map(r => [r.id, r]));

    const freePassengers = (Array.isArray(trip.freePassengers) ? trip.freePassengers : []) as FreePassenger[];

    let checkedIn = 0;
    let absent = 0;
    const absentPassengers: Array<{ id: string; name: string; seatNumber: string | null; boardingLocationId: string | null; boardingLocationName: string | null; isFree: boolean }> = [];

    for (const p of passengers) {
      const c = checkinMap.get(p.id);
      const reservation = reservationMap.get(p.reservationId);
      const effectiveBoardingLocationId = p.boardingLocationId ?? reservation?.boardingLocationId ?? null;
      const boardingLocationName = effectiveBoardingLocationId
        ? (bpMap.get(effectiveBoardingLocationId)?.name ?? blMap.get(effectiveBoardingLocationId) ?? null)
        : null;
      if (c?.status === "present") {
        checkedIn++;
      } else if (c?.status === "absent") {
        absent++;
        absentPassengers.push({
          id: p.id,
          name: p.name,
          seatNumber: p.seatNumber ?? null,
          boardingLocationId: effectiveBoardingLocationId,
          boardingLocationName,
          isFree: false,
        });
      } else {
        absentPassengers.push({
          id: p.id,
          name: p.name,
          seatNumber: p.seatNumber ?? null,
          boardingLocationId: effectiveBoardingLocationId,
          boardingLocationName,
          isFree: false,
        });
      }
    }

    let freeCheckedIn = 0;
    for (const fp of freePassengers) {
      if (fp.checkedInAt) {
        freeCheckedIn++;
      } else {
        absentPassengers.push({
          id: fp.id,
          name: fp.name,
          seatNumber: fp.seatNumber ?? null,
          boardingLocationId: null,
          boardingLocationName: null,
          isFree: true,
        });
      }
    }

    const totalCheckedIn = checkedIn + freeCheckedIn;
    const total = passengers.length + freePassengers.length;
    const pending = total - totalCheckedIn - absent;

    const [guideLocation] = await db.select()
      .from(tripGuideLocationsTable)
      .where(and(
        eq(tripGuideLocationsTable.tripId, trip.id),
        eq(tripGuideLocationsTable.tenantId, me.tenantId),
      ))
      .limit(1);

    res.json({
      tripId: trip.id,
      tripName: trip.name,
      status: trip.status,
      departureDate: trip.departureDate.toISOString(),
      checkedIn: totalCheckedIn,
      absent,
      pending,
      total,
      absentPassengers,
      guideLocation: guideLocation
        ? {
            lat: guideLocation.lat,
            lng: guideLocation.lng,
            guideName: guideLocation.guideName ?? null,
            updatedAt: guideLocation.recordedAt.toISOString(),
          }
        : null,
      boardingPoints,
    });
  } catch (err) { next(err); }
});

router.get("/trips/:id/boarding-live/stream", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const tripId = req.params.id!;
    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    const clientIp = getClientIp(req);
    if (!tryAddBoardingClient(tripId, res, clientIp)) {
      next(new AppError("Too many concurrent boarding stream connections", 429, "TOO_MANY_REQUESTS"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
    }, 30000);

    req.on("close", () => {
      clearInterval(ping);
      removeBoardingClient(tripId, res);
    });
  } catch (err) { next(err); }
});

// ─── WhatsApp bulk broadcast ───────────────────────────────────────────────────

const WhatsAppBroadcastBody = z.object({
  messageTemplate: z.string().min(1).max(2000),
  filter: z.enum(["all", "confirmed", "pending"]),
});

router.post("/trips/:id/whatsapp-broadcast", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const parsed = WhatsAppBroadcastBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [trip] = await db.select().from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }

    const [tenantRow] = await db.select({ name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId))
      .limit(1);
    const tenantName = tenantRow?.name ?? "";
    const departureDate = format(trip.departureDate, "dd/MM/yyyy", { locale: ptBR });

    const conditions: ReturnType<typeof eq>[] = [
      eq(reservationsTable.tripId, trip.id),
      eq(reservationsTable.tenantId, me.tenantId),
    ];
    if (parsed.data.filter === "confirmed") {
      conditions.push(eq(reservationsTable.status, "confirmed" as const));
    } else if (parsed.data.filter === "pending") {
      conditions.push(eq(reservationsTable.status, "pending" as const));
    } else {
      // "all" — exclude cancelled and refunded, matching active-passenger convention
      conditions.push(sql`${reservationsTable.status} NOT IN ('cancelled', 'refunded')`);
    }

    const reservations = await db
      .select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
      })
      .from(reservationsTable)
      .where(and(...conditions));

    const reservationIds = reservations.map(r => r.id);
    const clientIds = reservations.map(r => r.clientId).filter((id): id is string => id != null);

    // Fetch passengers and booking clients in parallel (skip DB calls when no reservations)
    const [passengers, clients] = await Promise.all([
      reservationIds.length > 0
        ? db.select({
            id: passengersTable.id,
            reservationId: passengersTable.reservationId,
            name: passengersTable.name,
            phone: passengersTable.phone,
            boardingLocationId: passengersTable.boardingLocationId,
          })
          .from(passengersTable)
          .where(inArray(passengersTable.reservationId, reservationIds))
        : Promise.resolve([]),
      clientIds.length > 0
        ? db.select({
            id: clientsTable.id,
            name: clientsTable.name,
            whatsapp: clientsTable.whatsapp,
            phone: clientsTable.phone,
          })
          .from(clientsTable)
          .where(inArray(clientsTable.id, clientIds))
        : Promise.resolve([]),
    ]);

    const clientMap = new Map(clients.map(c => [c.id, c]));
    const reservationMap = new Map(reservations.map(r => [r.id, r]));
    const boardingPoints = (trip.boardingPoints ?? []) as Array<{ id: string; name: string }>;
    const bpMap = new Map(boardingPoints.map(bp => [bp.id, bp.name]));

    const { interpolateWhatsAppMessage } = await import("../lib/whatsapp.js");
    const { enqueueWhatsAppMessage } = await import("../queues/whatsapp-helpers.js");

    let queued = 0;
    let skipped = 0;
    // Track already-sent phones to avoid duplicate messages to the same number
    const sentPhones = new Set<string>();

    for (const passenger of passengers) {
      const reservation = reservationMap.get(passenger.reservationId);
      if (!reservation) { skipped++; continue; }

      // Prefer passenger's own phone; fall back to booking client's contact
      const bookingClient = reservation.clientId ? clientMap.get(reservation.clientId) : null;
      const phone = passenger.phone || bookingClient?.whatsapp || bookingClient?.phone;
      if (!phone) { skipped++; continue; }

      // Deduplicate — if multiple passengers share a contact number, send once
      const normalizedPhone = phone.replace(/\D/g, "");
      if (sentPhones.has(normalizedPhone)) { skipped++; continue; }
      sentPhones.add(normalizedPhone);

      const localSaida = passenger.boardingLocationId
        ? (bpMap.get(passenger.boardingLocationId) ?? "")
        : "";
      const ref = reservation.reservationNumber ?? reservation.voucherCode ?? "";

      const message = interpolateWhatsAppMessage(parsed.data.messageTemplate, {
        nome: passenger.name,
        viagem: trip.name,
        data: departureDate,
        referencia: ref,
        agencia: tenantName,
        local_saida: localSaida,
      });

      try {
        await enqueueWhatsAppMessage(phone, message, me.tenantId);
        queued++;
      } catch {
        skipped++;
      }
    }

    // Also include free passengers (organizers/guides) stored in the trip JSON
    const tripFreePassengers = Array.isArray(trip.freePassengers)
      ? (trip.freePassengers as Array<{ id: string; name: string; whatsapp: string; role: string }>)
      : [];

    for (const fp of tripFreePassengers) {
      const phone = fp.whatsapp?.trim();
      if (!phone) { skipped++; continue; }
      const normalizedPhone = phone.replace(/\D/g, "");
      if (sentPhones.has(normalizedPhone)) { skipped++; continue; }
      sentPhones.add(normalizedPhone);

      const message = interpolateWhatsAppMessage(parsed.data.messageTemplate, {
        nome: fp.name,
        viagem: trip.name,
        data: departureDate,
        referencia: "",
        agencia: tenantName,
        local_saida: "",
      });

      try {
        await enqueueWhatsAppMessage(phone, message, me.tenantId);
        queued++;
      } catch {
        skipped++;
      }
    }

    res.json({ queued, skipped });
  } catch (err) {
    next(err);
  }
});

// ─── Guide location read (staff Clerk JWT) ────────────────────────────────────

router.get("/trips/:id/location", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [location] = await db.select()
      .from(tripGuideLocationsTable)
      .where(and(
        eq(tripGuideLocationsTable.tripId, req.params.id!),
        eq(tripGuideLocationsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    res.json({ location: location ?? null });
  } catch (err) { next(err); }
});

export default router;
