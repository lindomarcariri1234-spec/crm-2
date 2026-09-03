(y, m1 - 1, d, 3, 0, 0, 0));
    const twelveMonthsAgo = _brMid2(_r2Y, _r2M1 - 11, 1);

    const [monthlyRows, channelRows, commercialRows] = await Promise.all([
      // Monthly series for the selected date window — Brazil timezone to avoid wrong-month at 21h-midnight BRT
      db.select({
        month: sql<string>`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
        created: count(),
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
        bonusTotal: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
      }).from(referralsTable)
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.createdAt} >= ${since}`,
          sql`${referralsTable.createdAt} <= ${until}`,
        ))
        .groupBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
        .orderBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`),

      // Channel breakdown for the same window
      db.select({
        source: sql<string>`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`,
        visitors: sql<number>`COUNT(DISTINCT ${referralTrackingTable.cookieId})`,
        converted: sql<number>`COUNT(DISTINCT CASE WHEN ${referralTrackingTable.converted} = true THEN ${referralTrackingTable.cookieId} END)`,
      }).from(referralTrackingTable)
        .where(and(
          eq(referralTrackingTable.tenantId, me.tenantId),
          sql`${referralTrackingTable.createdAt} >= ${since}`,
          sql`${referralTrackingTable.createdAt} <= ${until}`,
        ))
        .groupBy(sql`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`)
        .orderBy(sql`COUNT(DISTINCT ${referralTrackingTable.cookieId}) DESC`),

      // Export the same linked, reversible commercial result used by the
      // dashboard; do not infer attribution from a reservation code.
      db.select({
        tenantId: referralsTable.tenantId,
        referrerId: referralsTable.referrerId,
        referrerName: clientsTable.name,
        status: referralsTable.status,
        convertedAt: referralsTable.convertedAt,
        bonusAmount: referralsTable.bonusAmount,
        bonusPaid: referralsTable.bonusPaid,
        bonusPaidAt: referralsTable.bonusPaidAt,
        bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
        discountAmount: referralsTable.discountAmount,
        reservationStatus: reservationsTable.status,
        reservationPaidValue: reservationsTable.paidValue,
        commissionAmount: referralCommissionsTable.amount,
        commissionStatus: referralCommissionsTable.status,
      })
        .from(referralsTable)
        .leftJoin(
          reservationsTable,
          and(
            eq(reservationsTable.id, referralsTable.reservationId),
            eq(reservationsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          clientsTable,
          and(
            eq(clientsTable.id, referralsTable.referrerId),
            eq(clientsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          referralCommissionsTable,
          and(
            eq(referralCommissionsTable.referralId, referralsTable.id),
            eq(referralCommissionsTable.tenantId, me.tenantId),
          ),
        )
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.convertedAt} >= ${since}`,
          sql`${referralsTable.convertedAt} <= ${until}`,
        )),
    ]);

    const commercialAnalytics = calculateReferralCommercialAnalytics(
      commercialRows,
      me.tenantId,
      since,
      until,
    );

    const CHANNEL_LABEL_MAP: Record<string, string> = {
      whatsapp: "WhatsApp", qr_code: "QR Code", qrcode: "QR Code",
      direct: "Link direto", direto: "Link direto", instagram: "Instagram",
      facebook: "Facebook", email: "E-mail", sms: "SMS",
    };
    const channelLabelFn = (s: string) => CHANNEL_LABEL_MAP[s.toLowerCase()] ?? s;

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "VisiteCRM";

    // Sheet 1: Monthly series
    const wsMonthly = wb.addWorksheet("Série Mensal");
    const monthlyHeaders = ["Mês", "Indicações criadas", "Convertidas", "Bônus pagos", "Total bônus (R$)", "Taxa de conversão (%)"];
    const hRowM = wsMonthly.addRow(monthlyHeaders);
    hRowM.font = { bold: true };
    for (const r of monthlyRows) {
      const monthLabel = r.month.slice(0, 7);
      const cr = Number(r.created);
      const cv = Number(r.converted);
      wsMonthly.addRow([
        monthLabel,
        cr,
        cv,
        Number(r.bonusPaid),
        Number(r.bonusTotal).toFixed(2),
        cr > 0 ? Math.round((cv / cr) * 100) : 0,
      ]);
    }
    monthlyHeaders.forEach((_, i) => { wsMonthly.getColumn(i + 1).width = Math.max(monthlyHeaders[i].length, 16) + 2; });

    // Sheet 2: Channel breakdown
    const wsChannels = wb.addWorksheet("Canais");
    const channelHeaders = ["Canal", "Visitantes únicos", "Conversões", "Taxa de conversão (%)"];
    const hRowC = wsChannels.addRow(channelHeaders);
    hRowC.font = { bold: true };
    for (const r of channelRows) {
      const v = Number(r.visitors);
      const cv = Number(r.converted);
      wsChannels.addRow([channelLabelFn(r.source), v, cv, v > 0 ? Math.round((cv / v) * 100) : 0]);
    }
    channelHeaders.forEach((_, i) => { wsChannels.getColumn(i + 1).width = Math.max(channelHeaders[i].length, 16) + 2; });

    // Sheet 3: Commercial result
    const wsRoi = wb.addWorksheet("Resultado Comercial");
    wsRoi.addRow(["Métrica", "Valor"]).font = { bold: true };
    wsRoi.addRow(["Conversões válidas", commercialAnalytics.summary.validReferrals]);
    wsRoi.addRow(["Receita atribuída / valor pago (R$)", commercialAnalytics.summary.attributedRevenue.toFixed(2)]);
    wsRoi.addRow(["Bônus promocionais pagos (R$)", commercialAnalytics.summary.rewardsPaid.toFixed(2)]);
    wsRoi.addRow(["Bônus promocionais pendentes (R$)", commercialAnalytics.summary.rewardsPending.toFixed(2)]);
    wsRoi.addRow(["Descontos concedidos (R$)", commercialAnalytics.summary.discountGiven.toFixed(2)]);
    wsRoi.addRow(["Comissões contratuais (R$)", commercialAnalytics.summary.commissions.toFixed(2)]);
    wsRoi.addRow(["Custo de aquisição (R$)", commercialAnalytics.summary.acquisitionCost.toFixed(2)]);
    wsRoi.addRow(["CAC (R$)", commercialAnalytics.summary.cac.toFixed(2)]);
    wsRoi.addRow(["ROI (%)", commercialAnalytics.summary.roiPercent.toFixed(2)]);
    wsRoi.addRow(["ROI (múltiplo)", commercialAnalytics.summary.acquisitionCost > 0 ? commercialAnalytics.summary.roiMultiple.toFixed(2) : "—"]);
    wsRoi.getColumn(1).width = 36;
    wsRoi.getColumn(2).width = 20;

    // Sheet 4: commercial ranking. Contractual commissions are ledger-backed
    // and remain distinct from promotional bonuses.
    const wsRanking = wb.addWorksheet("Ranking Comercial");
    const rankingHeaders = ["Posição", "Indicador", "Conversões", "Receita atribuída (R$)", "Bônus pagos (R$)", "Comissão (R$)"];
    wsRanking.addRow(rankingHeaders).font = { bold: true };
    commercialAnalytics.ranking.forEach((row, index) => {
      wsRanking.addRow([
        index + 1,
        row.referrerName,
        row.conversions,
        row.attributedRevenue.toFixed(2),
        row.rewardsPaid.toFixed(2),
        row.commissionAmount.toFixed(2),
      ]);
    });
    rankingHeaders.forEach((header, index) => {
      wsRanking.getColumn(index + 1).width = Math.max(header.length, 18) + 2;
    });

    const dateStr = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
    const filename = `analytics-indicacoes-${dateStr}.xlsx`;
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // The raw referral export includes contact and campaign data and remains
    // an administrator-only export exception to COMMISSIONS.VIEW.
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const format = (req.query.format as string | undefined) ?? "csv";
    if (!["csv", "xlsx", "json"].includes(format)) {
      next(new ValidationError("format must be csv, xlsx, or json", "VALIDATION_ERROR"));
      return;
    }

    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const bonusPaidParam = req.query.bonusPaid as string | undefined;
    const fraudFlagParam = req.query.fraudFlag as string | undefined;
    const expiringSoonParam = req.query.expiringSoon as string | undefined;
    const bonusNotifiedParam = req.query.bonusNotified as string | undefined;

    const validReferralStatusesExport = Object.values(REFERRAL_STATUS);
    if (status && status !== "all" && !validReferralStatusesExport.includes(status as (typeof validReferralStatusesExport)[number])) {
      next(new ValidationError(String(`Invalid status. Must be one of: all, ${validReferralStatusesExport.join(", ")}`), "VALIDATION_ERROR"));
      return;
    }

    const conditions = [eq(referralsTable.tenantId, me.tenantId)];
    if (status && status !== "all") conditions.push(eq(referralsTable.status, status));
    if (bonusPaidParam === "false") conditions.push(eq(referralsTable.bonusPaid, false));
    if (fraudFlagParam === "true") conditions.push(eq(referralsTable.fraudFlag, true));
    if (bonusNotifiedParam === "true") conditions.push(isNotNull(referralsTable.bonusReleaseNotifiedAt));
    if (bonusNotifiedParam === "false") conditions.push(isNull(referralsTable.bonusReleaseNotifiedAt));
    if (expiringSoonParam === "true") {
      const nowDate = new Date();
      const sevenDays = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      conditions.push(
        and(
          eq(referralsTable.status, REFERRAL_STATUS.PENDING),
          sql`${referralsTable.expiresAt} > NOW()`,
          sql`${referralsTable.expiresAt} <= ${sevenDays}`,
        )!,
      );
    }
    if (search) {
      conditions.push(or(
        ilike(referralsTable.code, `%${search}%`),
        ilike(referralsTable.referrerName, `%${search}%`),
        ilike(referralsTable.referredEmail, `%${search}%`),
        ilike(referralsTable.referredName, `%${search}%`),
        ilike(clientsTable.name, `%${search}%`),
        ilike(clientsTable.email, `%${search}%`),
      )!);
    }

    const rows = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(...conditions))
      .orderBy(desc(referralsTable.createdAt));

    const STATUS_MAP: Record<string, string> = {
      pending: "Pendente",
      completed: "Convertida",
      expired: "Expirada",
      converted: "Convertida",
      reversed: "Revertida",
    };

    const headers = [
      "Código", "Indicador", "E-mail Indicador", "Indicado", "E-mail Indicado",
      "Status", "Bônus (R$)", "Desconto (R$)", "Bônus Pago", "Notif. Bônus em", "Visitas", "Última visita",
      "Criado em", "Convertido em", "Expira em", "Motivo (suspeita)",
    ];

    const dataRows = rows.map(r => [
      r.code,
      r.referrerClientName ?? r.referrerName ?? "",
      r.referrerClientEmail ?? r.referrerEmail ?? "",
      r.referredName ?? "",
      r.referredEmail ?? "",
      STATUS_MAP[r.status] ?? r.status,
      r.bonusAmount ? parseFloat(String(r.bonusAmount)).toFixed(2) : "0.00",
      r.discountAmount ? parseFloat(String(r.discountAmount)).toFixed(2) : "0.00",
      r.bonusPaid ? "Sim" : "Não",
      r.bonusReleaseNotifiedAt ? new Date(r.bonusReleaseNotifiedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      String(r.visitsCount ?? 0),
      r.lastVisit ? new Date(r.lastVisit).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.convertedAt ? new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.fraudReason ?? "",
    ]);

    const dateStr = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);

    if (format === "json") {
      const jsonData = rows.map(r => ({
        code: r.code,
        referrerName: r.referrerClientName ?? r.referrerName ?? "",
        referrerEmail: r.referrerClientEmail ?? r.referrerEmail ?? "",
        referredName: r.referredName ?? "",
        referredEmail: r.referredEmail ?? "",
        status: STATUS_MAP[r.status] ?? r.status,
        bonusAmount: r.bonusAmount ? parseFloat(String(r.bonusAmount)).toFixed(2) : "0.00",
        discountAmount: r.discountAmount ? parseFloat(String(r.discountAmount)).toFixed(2) : "0.00",
        bonusPaid: r.bonusPaid ? "Sim" : "Não",
        bonusReleaseNotifiedAt: r.bonusReleaseNotifiedAt ? new Date(r.bonusReleaseNotifiedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        visitsCount: r.visitsCount ?? 0,
        lastVisit: r.lastVisit ? new Date(r.lastVisit).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        createdAt: r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        convertedAt: r.convertedAt ? new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        fraudReason: r.fraudReason ?? "",
      }));
      res.json({ headers, rows: jsonData });
      return;
    }

    if (format === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "VisiteCRM";
      const ws = wb.addWorksheet("Indicações");
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true };
      for (const row of dataRows) ws.addRow(row);
      headers.forEach((h, i) => {
        ws.getColumn(i + 1).width = Math.max(h.length, ...dataRows.map(r => String(r[i] ?? "").length)) + 2;
      });
      const buf = await wb.xlsx.writeBuffer();
      const filename = `indicacoes-${dateStr}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buf));
      return;
    }

    const csv = [headers, ...dataRows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const filename = `indicacoes-${dateStr}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    next(err);
  }
});

router.post("/referral-settings/test-whatsapp", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { res.status(403).json({ error: "Forbidden" }); return; }

    const parsed = z.object({
      type: z.enum(["converted", "bonusPaid", "reversed", "share"]),
      message: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const phone = settings?.whatsappPhoneNumber;
    if (!phone) {
      res.status(400).json({ error: "whatsapp_not_configured" });
      return;
    }

    const [tenant] = await db.select().from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId)).limit(1);
    const agencyName = tenant?.name ?? "Minha Agência";

    const bonusFormatted = (settings?.bonusValue != null ? Number(settings.bonusValue) : 10)
      .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let template = parsed.data.message ?? "";
    if (!template.trim()) {
      if (parsed.data.type === "converted") {
        template = settings?.whatsappConvertedMessage ?? "";
      } else if (parsed.data.type === "bonusPaid") {
        template = settings?.whatsappBonusPaidMessage ?? "";
      } else if (parsed.data.type === "reversed") {
        template = settings?.whatsappReversedMessage ?? "";
      } else {
        template = settings?.shareMessage ?? "";
      }
    }
    if (!template.trim()) {
      res.status(400).json({ error: "empty_template" });
      return;
    }

    const vars =
      parsed.data.type === "converted"
        ? { nome: "Maria", codigo: "JOAO123", agencia: agencyName, valor: bonusFormatted }
        : parsed.data.type === "bonusPaid"
        ? { nome: "João", codigo: "JOAO123", bonus: `R$ ${bonusFormatted}`, valor: bonusFormatted, agencia: agencyName }
        : parsed.data.type === "reversed"
        ? { nome: "Maria", valor: bonusFormatted, agencia: agencyName, saldo: bonusFormatted }
        : { nome: "João", codigo: "JOAO123", link: "https://exemplo.com.br/ind/JOAO123", bonus: `R$ ${bonusFormatted}` };

    const message = interpolateWhatsAppMessage(template, vars);
    const deliveryResult = await dispatchOutboundMessage({
      tenantId: me.tenantId,
      eventType: "referral_test_whatsapp",
      idempotencyKey: `referral-test-whatsapp:${parsed.data.type}:${generateId()}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: message },
      origin: "referral_settings_test",
      originChannel: "whatsapp",
      createdById: me.id,
    });
    const whatsappDelivery = deliveryResult.deliveries.find((delivery) => delivery.channel === "whatsapp");
    const result = {
      success: whatsappDelivery?.status === "pending" || whatsappDelivery?.status === "accepted",
      error: whatsappDelivery?.lastError ?? whatsappDelivery?.skippedReason ?? undefined,
    };

    if (!result.success) {
      if (result.error === "credentials_not_configured") {
        res.status(400).json({ error: "credentials_not_configured" });
      } else {
        res.status(502).json({ error: result.error ?? "send_failed" });
      }
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/referral-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);
    if (!settings) {
      const defaults = {
        id: generateId(),
        tenantId: me.tenantId,
        isEnabled: true,
        discountType: "percentage",
        discountValue: "5.00",
        bonusType: "credit",
        bonusValue: "10.00",
        expirationDays: 30,
        allowSelfReferral: false,
        requireFirstPurchase: true,
        shareMessage: "Use meu código de indicação e ganhe desconto na sua viagem!",
        tiersConfig: DEFAULT_TIERS_CONFIG,
        whatsappEnabled: false,
        whatsappPhoneNumber: null,
        whatsappConvertedMessage: null,
        whatsappBonusPaidMessage: null,
        whatsappReversedMessage: null,
        expiryWarning7DaysEnabled: true,
        expiryWarning1DayEnabled: true,
        bonusReleaseEmailEnabled: true,
        pointsPerReferral: 0,
        gracePeriodDays: 30,
        bonusValidityDays: 30,
        discountExpirationDays: 30,
        minPurchaseAmount: "0.00",
        maxReferralsPerUser: 0,
      };
      await db.insert(referralSettingsTable).values(defaults);
      res.json(defaults);
      return;
    }
    if (!settings.tiersConfig) {
      res.json({ ...settings, tiersConfig: DEFAULT_TIERS_CONFIG });
      return;
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.patch("/referral-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const TierSchema = z.object({
      level: z.string(),
      label: z.string(),
      minReferrals: z.number().int().nonnegative(),
      bonusMultiplier: z.number().positive(),
    });
    const parsed = z.object({
      isEnabled: z.boolean().optional(),
      discountType: z.string().optional(),
      discountValue: z.number().optional(),
      bonusType: z.string().optional(),
      bonusValue: z.number().optional(),
      expirationDays: z.number().optional(),
      allowSelfReferral: z.boolean().optional(),
      requireFirstPurchase: z.boolean().optional(),
      shareMessage: z.string().optional(),
      tiersConfig: z.array(TierSchema).optional(),
      whatsappEnabled: z.boolean().optional(),
      whatsappPhoneNumber: z.string().optional(),
      whatsappConvertedMessage: z.string().optional(),
      whatsappBonusPaidMessage: z.string().optional(),
      whatsappReversedMessage: z.string().optional(),
      expiryWarning7DaysEnabled: z.boolean().optional(),
      expiryWarning1DayEnabled: z.boolean().optional(),
      bonusReleaseEmailEnabled: z.boolean().optional(),
      pointsPerReferral: z.number().int().min(0).optional(),
      loyaltyPointsEmailEnabled: z.boolean().optional(),
      gracePeriodDays: z.number().int().min(0).optional(),
      bonusValidityDays: z.number().int().min(0).optional(),
      discountExpirationDays: z.number().int().min(0).optional(),
      minPurchaseAmount: z.number().min(0).optional(),
      maxReferralsPerUser: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.isEnabled != null) updates.isEnabled = parsed.data.isEnabled;
    if (parsed.data.discountType) updates.discountType = parsed.data.discountType;
    if (parsed.data.discountValue != null) updates.discountValue = parsed.data.discountValue.toFixed(2);
    if (parsed.data.bonusType) updates.bonusType = parsed.data.bonusType;
    if (parsed.data.bonusValue != null) updates.bonusValue = parsed.data.bonusValue.toFixed(2);
    if (parsed.data.expirationDays != null) updates.expirationDays = parsed.data.expirationDays;
    if (parsed.data.allowSelfReferral != null) updates.allowSelfReferral = parsed.data.allowSelfReferral;
    if (parsed.data.requireFirstPurchase != null) updates.requireFirstPurchase = parsed.data.requireFirstPurchase;
    if (parsed.data.shareMessage !== undefined) updates.shareMessage = parsed.data.shareMessage;
    if (parsed.data.tiersConfig !== undefined) updates.tiersConfig = parsed.data.tiersConfig as ReferralTier[];
    if (parsed.data.whatsappEnabled != null) updates.whatsappEnabled = parsed.data.whatsappEnabled;
    if (parsed.data.whatsappPhoneNumber !== undefined) updates.whatsappPhoneNumber = parsed.data.whatsappPhoneNumber;
    if (parsed.data.whatsappConvertedMessage !== undefined) updates.whatsappConvertedMessage = parsed.data.whatsappConvertedMessage;
    if (parsed.data.whatsappBonusPaidMessage !== undefined) updates.whatsappBonusPaidMessage = parsed.data.whatsappBonusPaidMessage;
    if (parsed.data.whatsappReversedMessage !== undefined) updates.whatsappReversedMessage = parsed.data.whatsappReversedMessage;
    if (parsed.data.expiryWarning7DaysEnabled != null) updates.expiryWarning7DaysEnabled = parsed.data.expiryWarning7DaysEnabled;
    if (parsed.data.expiryWarning1DayEnabled != null) updates.expiryWarning1DayEnabled = parsed.data.expiryWarning1DayEnabled;
    if (parsed.data.bonusReleaseEmailEnabled != null) updates.bonusReleaseEmailEnabled = parsed.data.bonusReleaseEmailEnabled;
    if (parsed.data.pointsPerReferral != null) updates.pointsPerReferral = parsed.data.pointsPerReferral;
    if (parsed.data.loyaltyPointsEmailEnabled != null) updates.loyaltyPointsEmailEnabled = parsed.data.loyaltyPointsEmailEnabled;
    if (parsed.data.gracePeriodDays != null) updates.gracePeriodDays = parsed.data.gracePeriodDays;
    if (parsed.data.bonusValidityDays != null) updates.bonusValidityDays = parsed.data.bonusValidityDays;
    if (parsed.data.discountExpirationDays != null) updates.discountExpirationDays = parsed.data.discountExpirationDays;
    if (parsed.data.minPurchaseAmount != null) updates.minPurchaseAmount = parsed.data.minPurchaseAmount.toFixed(2);
    if (parsed.data.maxReferralsPerUser != null) updates.maxReferralsPerUser = parsed.data.maxReferralsPerUser;

    const [existing] = await db.select({
      id: referralSettingsTable.id,
      expirationDays: referralSettingsTable.expirationDays,
    }).from(referralSettingsTable).where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const expirationDaysChanged = parsed.data.expirationDays != null && (
      !existing || parsed.data.expirationDays !== existing.expirationDays
    );

    const savedSettings = await db.transaction(async (tx) => {
      let result: typeof referralSettingsTable.$inferSelect | undefined;
      if (!existing) {
        const id = generateId();
        await tx.insert(referralSettingsTable).values({
          id,
          tenantId: me.tenantId,
          isEnabled: (updates.isEnabled as boolean | undefined) ?? true,
          discountType: (updates.discountType as string | undefined) ?? "percentage",
          discountValue: (updates.discountValue as string | undefined) ?? "5.00",
          bonusType: (updates.bonusType as string | undefined) ?? "credit",
          bonusValue: (updates.bonusValue as string | undefined) ?? "10.00",
          expirationDays: (updates.expirationDays as number | undefined) ?? 30,
          allowSelfReferral: (updates.allowSelfReferral as boolean | undefined) ?? false,
          requireFirstPurchase: (updates.requireFirstPurchase as boolean | undefined) ?? true,
          shareMessage: (updates.shareMessage as string | undefined) ?? null,
          tiersConfig: (updates.tiersConfig as ReferralTier[] | undefined) ?? DEFAULT_TIERS_CONFIG,
          whatsappEnabled: (updates.whatsappEnabled as boolean | undefined) ?? false,
          whatsappPhoneNumber: (updates.whatsappPhoneNumber as string | undefined) ?? null,
          whatsappConvertedMessage: (updates.whatsappConvertedMessage as string | undefined) ?? null,
          whatsappBonusPaidMessage: (updates.whatsappBonusPaidMessage as string | undefined) ?? null,
          whatsappReversedMessage: (updates.whatsappReversedMessage as string | undefined) ?? null,
          expiryWarning7DaysEnabled: (updates.expiryWarning7DaysEnabled as boolean | undefined) ?? true,
          expiryWarning1DayEnabled: (updates.expiryWarning1DayEnabled as boolean | undefined) ?? true,
          bonusReleaseEmailEnabled: (updates.bonusReleaseEmailEnabled as boolean | undefined) ?? true,
          loyaltyPointsEmailEnabled: (updates.loyaltyPointsEmailEnabled as boolean | undefined) ?? true,
        });
        [result] = await tx.select().from(referralSettingsTable)
          .where(eq(referralSettingsTable.id, id)).limit(1);
      } else {
        await tx.update(referralSettingsTable).set(updates as Partial<typeof referralSettingsTable.$inferInsert>)
          .where(eq(referralSettingsTable.tenantId, me.tenantId));
        [result] = await tx.select().from(referralSettingsTable)
          .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);
      }

      if (expirationDaysChanged) {
        const newDays = parsed.data.expirationDays!;
        await tx.update(referralsTable)
          .set({
            expiresAt: sql`${referralsTable.createdAt} + (${newDays}::integer * interval '1 day')`,
            expiryWarning7SentAt: null,
            expiryWarning1SentAt: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(referralsTable.tenantId, me.tenantId),
            eq(referralsTable.status, REFERRAL_STATUS.PENDING),
          ));
      }

      return result;
    });

    res.json(savedSettings);
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/commissions/report", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const rows = await db.select({
      status: referralCommissionsTable.status,
      total: sql<string>`COALESCE(SUM(${referralCommissionsTable.amount}), 0)`,
      count: count(),
    }).from(referralCommissionsTable)
      .where(eq(referralCommissionsTable.tenantId, me.tenantId))
      .groupBy(referralCommissionsTable.status);
    const totals: Record<"pending" | "approved" | "paid", number> = { pending: 0, approved: 0, paid: 0 };
    const counts: Record<"pending" | "approved" | "paid", number> = { pending: 0, approved: 0, paid: 0 };
    for (const row of rows) {
      if (row.status in totals) {
        const status = row.status as keyof typeof totals;
        totals[status] = Number(row.total);
        counts[status] = Number(row.count);
      }
    }
    const entries = await db.select({
      id: referralCommissionsTable.id,
      referralId: referralCommissionsTable.referralId,
      campaignId: referralCommissionsTable.campaignId,
      recipientType: referralCommissionsTable.recipientType,
      recipientId: referralCommissionsTable.recipientId,
      amount: referralCommissionsTable.amount,
      basis: referralCommissionsTable.basis,
      status: referralCommissionsTable.status,
      approvedAt: referralCommissionsTable.approvedAt,
      paidAt: referralCommissionsTable.paidAt,
      reversedAt: referralCommissionsTable.reversedAt,
      createdAt: referralCommissionsTable.createdAt,
      partnerName: partnersTable.name,
      ambassadorName: clientsTable.name,
    }).from(referralCommissionsTable)
      .leftJoin(partnersTable, and(
        eq(referralCommissionsTable.recipientType, "partner"),
        eq(partnersTable.id, referralCommissionsTable.recipientId),
        eq(partnersTable.tenantId, me.tenantId),
      ))
      .leftJoin(clientsTable, and(
        eq(referralCommissionsTable.recipientType, "ambassador"),
        eq(clientsTable.id, referralCommissionsTable.recipientId),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(eq(referralCommissionsTable.tenantId, me.tenantId))
      .orderBy(desc(referralCommissionsTable.createdAt));
    const partnerTotals = new Map<string, { partnerId: string; partnerName: string; pending: number; approved: number; paid: number; reversed: number; total: number }>();
    for (const entry of entries) {
      if (entry.recipientType !== "partner") continue;
      const item = partnerTotals.get(entry.recipientId) ?? {
        partnerId: entry.recipientId,
        partnerName: entry.partnerName ?? "Parceiro removido",
        pending: 0, approved: 0, paid: 0, reversed: 0, total: 0,
      };
      const amount = Number(entry.amount);
      item.total += amount;
      if (entry.status in item) item[entry.status as "pending" | "approved" | "paid" | "reversed"] += amount;
      partnerTotals.set(entry.recipientId, item);
    }
    res.json({
      totals,
      counts,
      entries: entries.map(({ partnerName, ambassadorName, amount, ...entry }) => ({
        ...entry,
        amount: Number(amount),
        recipientName: partnerName ?? ambassadorName ?? "Beneficiário removido",
      })),
      partnerTotals: [...partnerTotals.values()],
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/commissions/:id/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({ status: z.enum(["approved", "paid", "reversed"]) }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [commission] = await db.select().from(referralCommissionsTable)
      .where(and(eq(referralCommissionsTable.id, req.params.id), eq(referralCommissionsTable.tenantId, me.tenantId))).limit(1);
    if (!commission) { next(new NotFoundError("Comissão não encontrada", "NOT_FOUND")); return; }
    const allowed: Record<string, string[]> = {
      pending: ["approved", "reversed"],
      approved: ["paid", "reversed"],
      paid: [],
      reversed: [],
    };
    if (!allowed[commission.status]?.includes(parsed.data.status)) {
      next(new AppError("Transição de status da comissão não permitida", 422, "INVALID_STATUS_TRANSITION"));
      return;
    }
    const now = new Date();
    const updates: Record<string, unknown> = { status: parsed.data.status, updatedAt: now };
    if (parsed.data.status === "approved") updates.approvedAt = now;
    if (parsed.data.status === "paid") updates.paidAt = now;
    if (parsed.data.status === "reversed") updates.reversedAt = now;
    await db.update(referralCommissionsTable).set(updates)
      .where(and(eq(referralCommissionsTable.id, commission.id), eq(referralCommissionsTable.tenantId, me.tenantId)));
    const [updated] = await db.select().from(referralCommissionsTable)
      .where(and(eq(referralCommissionsTable.id, commission.id), eq(referralCommissionsTable.tenantId, me.tenantId))).limit(1);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const campaigns = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.tenantId, me.tenantId))
      .orderBy(desc(referralCampaignsTable.startsAt));

    if (campaigns.length === 0) { res.json([]); return; }

    // Single grouped query for all campaign stats to avoid N+1
    const statsRows = await db.select({
      campaignId: sql<string>`
        (SELECT c2.id FROM referral_campaigns c2
         WHERE c2.tenant_id = ${me.tenantId}
           AND ${referralsTable.convertedAt} >= c2.starts_at
           AND ${referralsTable.convertedAt} < c2.ends_at
         LIMIT 1)
      `,
      referralsCount: count(),
      bonusPaidAmount: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
    })
    .from(referralsTable)
    .where(and(
      eq(referralsTable.tenantId, me.tenantId),
      eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
      sql`EXISTS (
        SELECT 1 FROM referral_campaigns c2
        WHERE c2.tenant_id = ${me.tenantId}
          AND ${referralsTable.convertedAt} >= c2.starts_at
          AND ${referralsTable.convertedAt} < c2.ends_at
      )`,
    ))
    .groupBy(sql`
      (SELECT c2.id FROM referral_campaigns c2
       WHERE c2.tenant_id = ${me.tenantId}
         AND ${referralsTable.convertedAt} >= c2.starts_at
         AND ${referralsTable.convertedAt} < c2.ends_at
       LIMIT 1)
    `);

    const statsMap = new Map(statsRows.map((r) => [r.campaignId, r]));

    const result = campaigns.map((c) => {
      const stats = statsMap.get(c.id);
      return {
        ...c,
        bonusValue: Number(c.bonusValue),
        referralsCount: Number(stats?.referralsCount ?? 0),
        bonusPaidAmount: Number(stats?.bonusPaidAmount ?? 0),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      name: z.string().min(1).max(120),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      bonusType: CampaignBonusType,
      bonusValue: z.number().nonnegative(),
      bannerText: z.string().max(500).optional(),
    }).extend(CampaignConfig.shape).refine(
      (d) => d.bonusType !== "multiplier" || d.bonusValue >= 1,
      { message: "Multiplicador deve ser ≥ 1 para não reduzir o bônus base", path: ["bonusValue"] },
    ).refine(
      (d) => d.commissionType !== "none" || (d.commissionValue ?? 0) === 0,
      { message: "Comissão 'none' deve ter valor zero", path: ["commissionValue"] },
    ).refine(
      (d) => d.commissionType !== undefined && d.commissionType !== "none" ? (d.commissionValue ?? 0) > 0 : true,
      { message: "Comissão deve ser maior que zero", path: ["commissionValue"] },
    ).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const starts = new Date(parsed.data.startsAt);
    const ends = new Date(parsed.data.endsAt);
    if (ends <= starts) {
      next(new ValidationError(String("endsAt deve ser após startsAt" ), "VALIDATION_ERROR")); return;
    }

    const [overlap] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.startsAt} < ${ends}`,
        sql`${referralCampaignsTable.endsAt} > ${starts}`,
      ))
      .limit(1);
    if (overlap) {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }

    const id = generateId();
    await db.insert(referralCampaignsTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      startsAt: starts,
      endsAt: ends,
      bonusType: parsed.data.bonusType,
      bonusValue: parsed.data.bonusValue.toFixed(4),
      bannerText: parsed.data.bannerText ?? null,
      eligibleStoreProductIds: parsed.data.eligibleStoreProductIds ?? [],
      eligibleTierLevels: parsed.data.eligibleTierLevels ?? [],
      conversionCap: parsed.data.conversionCap ?? null,
      budgetAmount: parsed.data.budgetAmount?.toFixed(2) ?? null,
      shareMessage: parsed.data.shareMessage ?? null,
      materialUrl: parsed.data.materialUrl ?? null,
      publicRanking: parsed.data.publicRanking ?? false,
      eligibleActivitySegments: parsed.data.eligibleActivitySegments ?? [],
      eligibleChannels: parsed.data.eligibleChannels?.map((channel) => channel.toLowerCase()) ?? [],
      commissionType: parsed.data.commissionType ?? "none",
      commissionValue: (parsed.data.commissionValue ?? 0).toFixed(4),
      commissionRecipientType: parsed.data.commissionRecipientType ?? "ambassador",
      eligiblePartnerIds: parsed.data.eligiblePartnerIds ?? [],
    });

    const [campaign] = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.id, id)).limit(1);
    res.status(201).json({ ...campaign!, bonusValue: Number(campaign!.bonusValue) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23P01") {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }
    next(err);
  }
});

router.delete("/referrals/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [existing] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Campanha não encontrada", "NOT_FOUND")); return; }

    await db.delete(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [existing] = await db.select().from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Campanha não encontrada", "NOT_FOUND")); return; }

    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      bonusType: CampaignBonusType.optional(),
      bonusValue: z.number().nonnegative().optional(),
      bannerText: z.string().max(500).nullable().optional(),
    }).extend(CampaignConfig.shape).refine(
      (d) => {
        const effectiveType = d.bonusType ?? existing.bonusType;
        const effectiveVal = d.bonusValue ?? Number(existing.bonusValue);
        return effectiveType !== "multiplier" || effectiveVal >= 1;
      },
      { message: "Multiplicador deve ser ≥ 1 para não reduzir o bônus base", path: ["bonusValue"] },
    ).refine(
      (d) => {
        const type = d.commissionType ?? existing.commissionType;
        const value = d.commissionValue ?? Number(existing.commissionValue);
        return type === "none" ? value === 0 : value > 0;
      },
      { message: "Configuração de comissão inválida", path: ["commissionValue"] },
    ).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const starts = parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(existing.startsAt);
    const ends = parsed.data.endsAt ? new Date(parsed.data.endsAt) : new Date(existing.endsAt);
    if (ends <= starts) { next(new ValidationError(String("endsAt deve ser após startsAt" ), "VALIDATION_ERROR")); return; }

    const [overlap] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.id} != ${req.params.id}`,
        sql`${referralCampaignsTable.startsAt} < ${ends}`,
        sql`${referralCampaignsTable.endsAt} > ${starts}`,
      ))
      .limit(1);
    if (overlap) {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.startsAt !== undefined) updates.startsAt = starts;
    if (parsed.data.endsAt !== undefined) updates.endsAt = ends;
    if (parsed.data.bonusType !== undefined) updates.bonusType = parsed.data.bonusType;
    if (parsed.data.bonusValue !== undefined) updates.bonusValue = parsed.data.bonusValue.toFixed(4);
    if (parsed.data.bannerText !== undefined) updates.bannerText = parsed.data.bannerText;
    if (parsed.data.eligibleStoreProductIds !== undefined) updates.eligibleStoreProductIds = parsed.data.eligibleStoreProductIds;
    if (parsed.data.eligibleTierLevels !== undefined) updates.eligibleTierLevels = parsed.data.eligibleTierLevels;
    if (parsed.data.conversionCap !== undefined) updates.conversionCap = parsed.data.conversionCap;
    if (parsed.data.budgetAmount !== undefined) updates.budgetAmount = parsed.data.budgetAmount?.toFixed(2) ?? null;
    if (parsed.data.shareMessage !== undefined) updates.shareMessage = parsed.data.shareMessage;
    if (parsed.data.materialUrl !== undefined) updates.materialUrl = parsed.data.materialUrl;
    if (parsed.data.publicRanking !== undefined) updates.publicRanking = parsed.data.publicRanking;
    if (parsed.data.eligibleActivitySegments !== undefined) updates.eligibleActivitySegments = parsed.data.eligibleActivitySegments;
    if (parsed.data.eligibleChannels !== undefined) updates.eligibleChannels = parsed.data.eligibleChannels.map((channel) => channel.toLowerCase());
    if (parsed.data.commissionType !== undefined) updates.commissionType = parsed.data.commissionType;
    if (parsed.data.commissionValue !== undefined) updates.commissionValue = parsed.data.commissionValue.toFixed(4);
    if (parsed.data.commissionRecipientType !== undefined) updates.commissionRecipientType = parsed.data.commissionRecipientType;
    if (parsed.data.eligiblePartnerIds !== undefined) updates.eligiblePartnerIds = parsed.data.eligiblePartnerIds;

    await db.update(referralCampaignsTable)
      .set(updates)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ));

    const [updated] = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.id, req.params.id)).limit(1);
    res.json({ ...updated!, bonusValue: Number(updated!.bonusValue) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23P01") {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }
    next(err);
  }
});

router.get("/referrals/active-campaign", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const now = new Date();
    const [campaign] = await db.select().from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.startsAt} <= ${now}`,
        sql`${referralCampaignsTable.endsAt} > ${now}`,
      ))
      .orderBy(desc(referralCampaignsTable.startsAt))
      .limit(1);

    if (!campaign) { res.json(null); return; }
    res.json({ ...campaign, bonusValue: Number(campaign.bonusValue) });
  } catch (err) {
    next(err);
  }
});

router.post("/referral-settings/whatsapp-test", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      phone: z.string().min(8),
      messageType: z.enum(["converted", "bonusPaid", "reversed", "share"]),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String("Parâmetros inválidos" ), "VALIDATION_ERROR")); return; }

    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const [tenant] = await db.select({ name: tenantsTable.name })
      .from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);

    const agencyName = tenant?.name ?? "Agência";
    const bonusValue = parseFloat(String(settings?.bonusValue ?? "10")) || 10;
    const bonusValFormatted = bonusValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const bonusCurrencyFormatted = formatBRL(bonusValue);

    let message: string;
    const { messageType } = parsed.data;

    if (messageType === "converted") {
      const template = settings?.whatsappConvertedMessage ??
        "Boa notícia! {{nome}} usou seu código {{codigo}} e comprou com a {{agencia}}. Seu bônus de R$ {{valor}} está sendo processado.";
      message = interpolateWhatsAppMessage(template, { nome: "Maria Silva", codigo: "TESTE123", agencia: agencyName, valor: bonusValFormatted });
    } else if (messageType === "bonusPaid") {
      const template = settings?.whatsappBonusPaidMessage ??
        "Seu bônus de R$ {{valor}} foi pago! Obrigado por indicar clientes para a {{agencia}}.";
      message = interpolateWhatsAppMessage(template, { nome: "João Silva", codigo: "TESTE123", bonus: bonusCurrencyFormatted, valor: bonusValFormatted, agencia: agencyName });
    } else if (messageType === "reversed") {
      const template = settings?.whatsappReversedMessage ??
        "Olá! A reserva de {{nome}} foi cancelada e o bônus de R$ {{valor}} foi estornado do seu saldo na {{agencia}}. Seu saldo atual é R$ {{saldo}}.";
      message = interpolateWhatsAppMessage(template, { nome: "Maria Silva", valor: bonusValFormatted, agencia: agencyName, saldo: bonusValFormatted });
    } else {
      const template = settings?.shareMessage ?? "Use meu código de indicação e ganhe desconto na sua viagem!";
      message = template
        .replace(/\{\{?nome\}?\}/g, "João")
        .replace(/\{\{?codigo\}?\}/g, "TESTE123")
        .replace(/\{\{?link\}?\}/g, "https://exemplo.com.br/ind/TESTE123")
        .replace(/\{\{?bonus\}?\}/g, bonusCurrencyFormatted);
    }

    const deliveryResult = await dispatchOutboundMessage({
      tenantId: me.tenantId,
      eventType: "referral_test_whatsapp",
      idempotencyKey: `referral-test-whatsapp:${messageType}:${generateId()}`,
      recipient: { type: "direct", whatsapp: parsed.data.phone },
      whatsapp: { text: message },
      origin: "referral_settings_test",
      originChannel: "whatsapp",
      createdById: me.id,
    });
    const whatsappDelivery = deliveryResult.deliveries.find((delivery) => delivery.channel === "whatsapp");
    const result = {
      success: whatsappDelivery?.status === "pending" || whatsappDelivery?.status === "accepted",
      error: whatsappDelivery?.lastError ?? whatsappDelivery?.skippedReason ?? undefined,
    };

    if (!result.success) {
      const error = result.error ?? "unknown_error";
      let detail: string;
      if (error === "credentials_not_configured") {
        detail = "Credenciais Z-API não configuradas. Verifique as variáveis ZAPI_INSTANCE_ID e ZAPI_TOKEN.";
      } else if (error.startsWith("zapi_")) {
        detail = `Z-API retornou status ${error.replace("zapi_", "")}. Verifique se o número está correto e a instância está conectada.`;
      } else {
        detail = `Erro de rede: ${error}`;
      }
      next(new AppError(detail, 422, "WHATSAPP_SEND_FAILED"));
      return;
    }

    res.json({ success: true, phone: parsed.data.phone });
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/:id/reverse", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      reason: z.string().min(1, "Motivo é obrigatório"),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [existing] = await db.select({
      id: referralsTable.id,
      reservationId: referralsTable.reservationId,
      status: referralsTable.status,
      bonusPaid: referralsTable.bonusPaid,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
      bonusAmount: referralsTable.bonusAmount,
    })
      .from(referralsTable)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!existing) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }
    // Fast pre-flight: avoids opening a transaction for obvious 422 cases.
    // The authoritative check happens inside the transaction under a row lock.
    if (existing.status !== REFERRAL_STATUS.COMPLETED) {
      next(new AppError("Reversão manual só é permitida em indicações com status 'convertida'", 422, "UNPROCESSABLE"));
      return;
    }
    if (existing.bonusPaid) {
      next(new AppError(
        "Um bônus já pago não pode ser revertido por este fluxo.",
        422,
        "REFERRAL_PAID_REVERSAL",
      ));
      return;
    }

    const reversedInfo = await db.transaction(async (tx) => {
      // Lock the referral row first so concurrent duplicate requests serialize.
      const locked = await tx.execute(
        sql`SELECT id, status, bonus_paid, referrer_id, referred_id, bonus_amount FROM referrals WHERE id = ${existing.id} AND tenant_id = ${me.tenantId} FOR UPDATE`
      );
      const lockedRow = (locked.rows as Array<Record<string, unknown>>)[0];
      if (!lockedRow || lockedRow.status !== REFERRAL_STATUS.COMPLETED || lockedRow.bonus_paid === true) {
        // Already reversed by a concurrent request — abort without modifying balances.
        throw new AppError("Reversão manual só é permitida em indicações com status 'convertida'", 422, "UNPROCESSABLE");
      }

      const bonusToReverse = Number(lockedRow.bonus_amount ?? existing.bonusAmount);
      const referrerId = String(lockedRow.referrer_id ?? existing.referrerId);
      const referredId = (lockedRow.referred_id as string | null) ?? existing.referredId ?? null;
      const bonusAmountStr = String(lockedRow.bonus_amount ?? existing.bonusAmount ?? "0");

      // Lock the referrer's client row before modifying their balance.
      await tx.execute(
        sql`SELECT id FROM clients WHERE id = ${referrerId} AND tenant_id = ${me.tenantId} FOR UPDATE`
      );
      await tx.update(clientsTable)
        .set({
          successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
          referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
        })
        .where(and(
          eq(clientsTable.id, referrerId),
          eq(clientsTable.tenantId, me.tenantId),
        ));

      const reversalNow = new Date();
      await tx.update(referralsTable)
        .set({
          status: REFERRAL_STATUS.REVERSED,
          reversalReason: parsed.data.reason,
          reversalAt: reversalNow,
          updatedAt: reversalNow,
        })
        .where(and(
          eq(referralsTable.id, existing.id),
          eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        ));
      await tx.update(referralCommissionsTable)
        .set({ status: "reversed", reversedAt: reversalNow, updatedAt: reversalNow })
        .where(and(
          eq(referralCommissionsTable.tenantId, me.tenantId),
          eq(referralCommissionsTable.referralId, existing.id),
          inArray(referralCommissionsTable.status, ["pending", "approved"]),
        ));

      return { referrerId, referredId, bonusAmountStr };
    });

    const { dispatchReferralReversedEmail } = await import("../queues/email-helpers.js");
    dispatchReferralReversedEmail({
      referrerId: reversedInfo.referrerId,
      referredId: reversedInfo.referredId,
      bonusAmount: reversedInfo.bonusAmountStr,
      tenantId: me.tenantId,
      reason: parsed.data.reason,
      referralId: existing.id,
      reservationId: existing.reservationId,
    }).catch(() => {});

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId))).limit(1);

    if (!updated) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/:id/reverse-paid-bonus", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      reason: z.string().trim().min(1, "Motivo é obrigatório").max(1000),
      // Accept the names used by current clients while requiring an explicit
      // affirmative confirmation instead of treating a missing field as yes.
      confirmed: z.boolean().optional(),
      confirm: z.boolean().optional(),
      confirmation: z.boolean().optional(),
    }).superRefine((body, ctx) => {
      if (body.confirmed !== true && body.confirm !== true && body.confirmation !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmed"],
          message: "Confirme o estorno financeiro para continuar",
        });
      }
    }).safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "REFERRAL_REVERSAL_CONFIRMATION"));
      return;
    }

    const reversal = await reversePaidReferralBonus(
      req.params.id,
      me.tenantId,
      parsed.data.reason,
      me.id,
    );

    if (!reversal.alreadyReversed) {
      const { dispatchReferralReversedEmail } = await import("../queues/email-helpers.js");
      dispatchReferralReversedEmail({
        referrerId: reversal.referrerId,
        referredId: reversal.referredId,
        bonusAmount: reversal.bonusAmount,
        tenantId: me.tenantId,
        reason: parsed.data.reason,
        referralId: reversal.referralId,
        reservationId: reversal.reservationId,
      }).catch((err) => req.log?.warn?.({ err }, "Falha ao notificar estorno de bônus"));
    }

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(
        eq(referralsTable.id, req.params.id),
        eq(referralsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!updated) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }

    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      reversal: {
        id: reversal.reversalId,
        amount: reversal.bonusAmount,
        reason: reversal.reason,
        alreadyApplied: reversal.alreadyReversed,
      },
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
