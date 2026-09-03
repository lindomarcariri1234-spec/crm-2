        //
        // Lookup by reservationId (set for all storefront and CRM bookings).
        if (existing.discountReferralCode && !existing.referralReversalAt) {
          let referralRecord: { id: string; referrerId: string; referredId: string | null; bonusAmount: string } | undefined;

          const [byReservation] = await tx
            .select({ id: referralsTable.id, referrerId: referralsTable.referrerId, referredId: referralsTable.referredId, bonusAmount: referralsTable.bonusAmount })
            .from(referralsTable)
            .where(and(
              eq(referralsTable.tenantId, me.tenantId),
              eq(referralsTable.reservationId, req.params.id),
              eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
            ))
            .limit(1);

          if (byReservation) {
            referralRecord = byReservation;
          } else {
            // Secondary lookup: find any COMPLETED referral for this code
            // (ignoring reservationId) to distinguish a data integrity gap from
            // an already-reversed idempotency case.  If a COMPLETED row exists
            // for the code but has a different (or missing) reservation_id, that
            // is a gap worth surfacing to operators; if nothing exists the
            // referral was already reversed and silence is correct.
            const [byCode] = await tx
              .select({ id: referralsTable.id, referrerId: referralsTable.referrerId })
              .from(referralsTable)
              .where(and(
                eq(referralsTable.tenantId, me.tenantId),
                eq(referralsTable.code, existing.discountReferralCode),
                eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
              ))
              .limit(1);

            if (byCode) {
              req.log.warn(
                {
                  tenantId: me.tenantId,
                  referrerId: byCode.referrerId,
                  referralCode: existing.discountReferralCode,
                  reservationId: req.params.id,
                  reason: "missing_reservation_id",
                },
                "Referral reversal skipped: COMPLETED referral found by code but no record matches reservationId — possible missing reservation_id on referral row",
              );
            } else {
              // Both COMPLETED lookups returned nothing.  Distinguish a
              // re-cancel flow (referral already REVERSED — expected,
              // idempotent) from a reservation that was never linked to a
              // referral record (e.g. legacy data, or code applied after
              // conversion).  A third query checks for the REVERSED row so
              // operators can tell the two cases apart in logs.
              const [alreadyReversed] = await tx
                .select({ id: referralsTable.id })
                .from(referralsTable)
                .where(and(
                  eq(referralsTable.tenantId, me.tenantId),
                  eq(referralsTable.code, existing.discountReferralCode),
                  eq(referralsTable.status, REFERRAL_STATUS.REVERSED),
                ))
                .limit(1);

              if (alreadyReversed) {
                req.log.debug(
                  {
                    tenantId: me.tenantId,
                    referralCode: existing.discountReferralCode,
                    reservationId: req.params.id,
                    reason: "already_reversed",
                  },
                  "Referral reversal skipped: record is already REVERSED — expected re-cancel idempotency, no action needed",
                );
              } else {
                // Neither a COMPLETED nor a REVERSED referral row exists for
                // this code.  Before assuming the legitimate legacy case (a
                // discount code applied without ever generating a referral row),
                // check for a referral row stuck in some OTHER status (e.g.
                // PENDING, CONVERTED, EXPIRED — anything but COMPLETED/REVERSED).
                // Such a row means a referral exists but was never completed, so
                // the COMPLETED-filtered reversal above silently skipped it and a
                // bonus could be left dangling/unreversed.  Surface it loudly so
                // operators can investigate and reverse manually — but do NOT
                // auto-reverse it here.
                const [unexpectedStatus] = await tx
                  .select({ id: referralsTable.id, status: referralsTable.status })
                  .from(referralsTable)
                  .where(and(
                    eq(referralsTable.tenantId, me.tenantId),
                    eq(referralsTable.code, existing.discountReferralCode),
                    notInArray(referralsTable.status, [REFERRAL_STATUS.COMPLETED, REFERRAL_STATUS.REVERSED]),
                  ))
                  .limit(1);

                if (unexpectedStatus) {
                  req.log.warn(
                    {
                      tenantId: me.tenantId,
                      referralId: unexpectedStatus.id,
                      referralStatus: unexpectedStatus.status,
                      referralCode: existing.discountReferralCode,
                      reservationId: req.params.id,
                      reason: "unexpected_status",
                    },
                    "Referral reversal skipped: referral row found in an unexpected status (not COMPLETED/REVERSED) — bonus may be left unreversed; investigate and reverse manually",
                  );
                }
                // else: no referral record in ANY status — legitimate legacy
                // case (code may have been applied without generating a referral
                // row, or the row was never created; no bonus to reverse).
                // Silently skip.
              }
            }
          }

          if (referralRecord) {
            const bonusToReverse = Number(referralRecord.bonusAmount);
            await tx.execute(
              sql`SELECT id FROM clients WHERE id = ${referralRecord.referrerId} AND tenant_id = ${me.tenantId} FOR UPDATE`
            );
            await tx.update(clientsTable)
              .set({
                successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
                referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
              })
              .where(and(
                eq(clientsTable.id, referralRecord.referrerId),
                eq(clientsTable.tenantId, me.tenantId),
              ));
            const reversalNow = new Date();
            await tx.update(referralsTable)
              .set({ status: REFERRAL_STATUS.REVERSED, reversalReason: "reservation_cancelled", reversalAt: reversalNow, updatedAt: reversalNow })
              .where(eq(referralsTable.id, referralRecord.id));
            // Keep the original commission row for auditability; only its
            // lifecycle status changes when the referral is reversed.
            await tx.execute(
              sql`UPDATE referral_commissions
                  SET status = 'reversed', reversed_at = ${reversalNow}, updated_at = ${reversalNow}
                  WHERE tenant_id = ${me.tenantId}
                    AND referral_id = ${referralRecord.id}
                    AND status IN ('pending', 'approved')`,
            );

            // Referral conversion awards separate loyalty points to the
            // referrer. Add a compensating transaction rather than deleting
            // the original earn record.
            await tx.execute(
              sql`SELECT id FROM loyalty_members
                  WHERE tenant_id = ${me.tenantId} AND client_id = ${referralRecord.referrerId}
                  LIMIT 1 FOR UPDATE`,
            );
            const referralPointsResult = await tx.execute(
              sql`SELECT lm.id AS member_id, lm.total_points, lm.available_points, lt.points
                  FROM loyalty_members lm
                  JOIN loyalty_transactions lt
                    ON lt.tenant_id = lm.tenant_id
                   AND lt.member_id = lm.id
                   AND lt.type = 'referral'
                   AND lt.reference_id = ${referralRecord.id}
                   AND lt.reference_type = 'referral'
                  WHERE lm.tenant_id = ${me.tenantId}
                    AND lm.client_id = ${referralRecord.referrerId}
                    AND NOT EXISTS (
                      SELECT 1 FROM loyalty_transactions reversal
                      WHERE reversal.tenant_id = ${me.tenantId}
                        AND reversal.member_id = lm.id
                        AND reversal.reference_id = ${referralRecord.id}
                        AND reversal.reference_type = 'referral_reversal'
                    )
                  LIMIT 1`,
            );
            const referralPointsRow = (referralPointsResult as unknown as {
              rows: Array<{ member_id: string; total_points: number; available_points: number; points: number }>;
            }).rows[0];
            if (referralPointsRow && referralPointsRow.points > 0) {
                const newTotalPoints = Math.max(0, referralPointsRow.total_points - referralPointsRow.points);
                await tx.update(loyaltyMembersTable)
                  .set({
                    totalPoints: newTotalPoints,
                    availablePoints: sql`GREATEST(0, ${referralPointsRow.available_points} - ${referralPointsRow.points})`,
                    tier: calculateTier(newTotalPoints),
                    lastActivityAt: reversalNow,
                  })
                  .where(and(
                    eq(loyaltyMembersTable.id, referralPointsRow.member_id),
                    eq(loyaltyMembersTable.tenantId, me.tenantId),
                  ));
                await tx.insert(loyaltyTransactionsTable).values({
                  id: `${referralRecord.id}:reversal`,
                  tenantId: me.tenantId,
                  memberId: referralPointsRow.member_id,
                  type: "redeem",
                  points: -referralPointsRow.points,
                  description: `Estorno de pontos — indicação ${referralRecord.id}`,
                  referenceId: referralRecord.id,
                  referenceType: "referral_reversal",
                });
            }
            // Mark the reversal as completed so re-cancel flows are short-circuited
            // by the explicit idempotency guard above (mirrors couponReversalAt).
            updates.referralReversalAt = new Date();
            // Capture for post-transaction notification (#28)
            reversedReferralInfo = { referralId: referralRecord.id, referrerId: referralRecord.referrerId, referredId: referralRecord.referredId, bonusAmount: referralRecord.bonusAmount };
          }
        }

        // --- Reversal 4: loyalty points earned from this reservation ---
        // Points can be earned either when payments are received (referenceType="payment")
        // or when the reservation is confirmed (referenceType="reservation"). We must
        // clawback both kinds, so we always look up the loyalty member when a clientId
        // exists — not just when payments exist.
        if (existing.clientId) {
          // Acquire a row-level lock on the loyalty member BEFORE the idempotency
          // check.  Without this lock, two concurrent cancellation requests can both
          // pass the idempotency SELECT (seeing no existing "cancellation" transaction)
          // before either one commits its INSERT, resulting in two clawback transactions
          // and a double-deduction of points.  The FOR UPDATE lock serializes concurrent
          // transactions: the second request blocks here until the first commits, then
          // re-checks the idempotency condition and correctly finds the existing record.
          await tx.execute(
            sql`SELECT id FROM loyalty_members WHERE tenant_id = ${me.tenantId} AND client_id = ${existing.clientId} LIMIT 1 FOR UPDATE`
          );
          const reservationPayments = await tx
            .select({ id: paymentsTable.id })
            .from(paymentsTable)
            .where(and(
              eq(paymentsTable.tenantId, me.tenantId),
              eq(paymentsTable.reservationId, req.params.id),
            ));
          const [loyaltyMember] = await tx
            .select({
              id: loyaltyMembersTable.id,
              availablePoints: loyaltyMembersTable.availablePoints,
              totalPoints: loyaltyMembersTable.totalPoints,
            })
            .from(loyaltyMembersTable)
            .where(and(
              eq(loyaltyMembersTable.tenantId, me.tenantId),
              eq(loyaltyMembersTable.clientId, existing.clientId),
            ))
            .limit(1);
          if (loyaltyMember) {
            // Idempotency: skip if a "cancellation" transaction for this reservation already exists
            // (prevents double-clawback on reopen → re-cancel flows)
            const [existingClawback] = await tx
              .select({ id: loyaltyTransactionsTable.id })
              .from(loyaltyTransactionsTable)
              .where(and(
                eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
                eq(loyaltyTransactionsTable.type, "cancellation"),
                eq(loyaltyTransactionsTable.referenceId, req.params.id),
              ))
              .limit(1);
            if (!existingClawback) {
              const paymentIds = reservationPayments.map(p => p.id);
              // Query earn transactions tied to this reservation directly (confirmation-earned)
              // and, when payments exist, also those tied to individual payments.
              const earnTransactions = await tx
                .select({ points: loyaltyTransactionsTable.points })
                .from(loyaltyTransactionsTable)
                .where(and(
                  eq(loyaltyTransactionsTable.tenantId, me.tenantId),
                  eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
                  eq(loyaltyTransactionsTable.type, "earn"),
                  paymentIds.length > 0
                    ? or(
                        inArray(loyaltyTransactionsTable.referenceId, paymentIds),
                        eq(loyaltyTransactionsTable.referenceId, req.params.id),
                      )
                    : eq(loyaltyTransactionsTable.referenceId, req.params.id),
                ));
              const totalEarnedPoints = earnTransactions.reduce((sum, t) => sum + t.points, 0);
              if (totalEarnedPoints > 0) {
                const newAvailable = Math.max(0, loyaltyMember.availablePoints - totalEarnedPoints);
                const newTotal = Math.max(0, loyaltyMember.totalPoints - totalEarnedPoints);
                await tx.update(loyaltyMembersTable)
                  .set({
                    availablePoints: newAvailable,
                    totalPoints: newTotal,
                    tier: calculateTier(newTotal),
                    lastActivityAt: new Date(),
                  })
                  .where(eq(loyaltyMembersTable.id, loyaltyMember.id));
                await tx.insert(loyaltyTransactionsTable).values({
                  id: generateId(),
                  tenantId: me.tenantId,
                  memberId: loyaltyMember.id,
                  type: "cancellation",
                  points: -totalEarnedPoints,
                  description: `Estorno de pontos — cancelamento da reserva ${existing.voucherCode}`,
                  referenceId: req.params.id,
                  referenceType: "reservation",
                });
              }
            }
          }
        }

        // --- Cancel orphan commissions (pending/approved) tied to this reservation ---
        await tx.update(commissionsTable)
          .set({ status: COMMISSION_STATUS.CANCELLED })
          .where(and(
            eq(commissionsTable.reservationId, req.params.id),
            eq(commissionsTable.tenantId, me.tenantId),
            inArray(commissionsTable.status, [COMMISSION_STATUS.PENDING, COMMISSION_STATUS.APPROVED]),
          ));

        // --- Cancel linked store order ---
        // Reservations created via the storefront carry a storeOrderId (= orderNumber
        // of the originating store order). When the reservation is cancelled we must
        // also close out that order so it does not remain in a dangling open state.
        // We skip orders that are already cancelled or completed to stay idempotent.
        if (existing.storeOrderId) {
          const [storeOrder] = await tx
            .select({ id: storeOrdersTable.id, status: storeOrdersTable.status })
            .from(storeOrdersTable)
            .where(and(
              eq(storeOrdersTable.tenantId, me.tenantId),
              eq(storeOrdersTable.orderNumber, existing.storeOrderId),
            ))
            .limit(1);
          if (
            storeOrder &&
            storeOrder.status !== STORE_ORDER_STATUS.CANCELLED &&
            storeOrder.status !== STORE_ORDER_STATUS.COMPLETED
          ) {
            await tx.update(storeOrdersTable)
              .set({ status: STORE_ORDER_STATUS.CANCELLED, cancelledAt: new Date() })
              .where(eq(storeOrdersTable.id, storeOrder.id));
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(reservationsTable).set(updates)
          .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)));
      }
      const [updated] = await tx.select().from(reservationsTable)
        .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!updated) return null;

      if (parsed.data.seats != null) {
        const newSeats = parsed.data.seats;
        const newCount = newSeats.length;
        // Use the row obtained under the reservation lock. A concurrent seat
        // edit may have committed while this request waited, and capacity as
        // well as passenger remapping must be based on that committed state.
        const priorSeats: string[] = lockedReservation?.seats ?? existing.seats ?? [];

        // --- Seat counter delta for seat array SIZE changes ---
        // The status-transition blocks above (isBeingConfirmed / isBeingDemoted) already
        // moved the OLD seat count between buckets. Here we compensate for any CHANGE in
        // the NUMBER of seats so the counters remain accurate even when only the seats
        // array changes (e.g. adding a seat to an existing confirmed reservation).
        // Skip when being cancelled — that path restores all seats in its own block.
        // An active reservation seat edit is serialized with cancellation by
        // the reservation lock above. If cancellation acquired that lock
        // first, this request may still update the seat data, but it must not
        // apply a capacity delta to the already-cancelled reservation.
        const mayAdjustSeatCapacity = !requiresCapacityTransitionLock || lockedReservation !== undefined;
        if (!isBeingCancelled && mayAdjustSeatCapacity && lockedReservation?.tripId) {
          const seatDelta = newCount - priorSeats.length;
          if (seatDelta !== 0) {
            const finalStatus = isBeingConfirmed
              ? RESERVATION_STATUS.CONFIRMED
              : isBeingDemoted
                ? RESERVATION_STATUS.PENDING
                : lockedReservation.status;
            if (finalStatus === RESERVATION_STATUS.CONFIRMED) {
              await tx.update(tripsTable).set({
                confirmedSeats: sql`GREATEST(0, confirmed_seats + ${seatDelta})`,
                availableSeats: sql`GREATEST(0, LEAST(total_capacity, available_seats - ${seatDelta}))`,
              }).where(and(eq(tripsTable.id, lockedReservation.tripId), eq(tripsTable.tenantId, me.tenantId)));
            } else if (finalStatus === RESERVATION_STATUS.PENDING) {
              await tx.update(tripsTable).set({
                reservedSeats: sql`GREATEST(0, reserved_seats + ${seatDelta})`,
                availableSeats: sql`GREATEST(0, LEAST(total_capacity, available_seats - ${seatDelta}))`,
              }).where(and(eq(tripsTable.id, lockedReservation.tripId), eq(tripsTable.tenantId, me.tenantId)));
            }
          }
        }

        // Order passengers by their position in the prior seats array (primary always first).
        const currentPassengers = await tx.select()
          .from(passengersTable)
          .where(eq(passengersTable.reservationId, req.params.id))
          .orderBy(desc(passengersTable.isPrimary), asc(passengersTable.id));

        // Re-sort in JS to use prior seats index for stable positional mapping.
        currentPassengers.sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          const ai = priorSeats.indexOf(a.seatNumber ?? "");
          const bi = priorSeats.indexOf(b.seatNumber ?? "");
          return (ai === -1 ? priorSeats.length : ai) - (bi === -1 ? priorSeats.length : bi);
        });

        const currentCount = currentPassengers.length;

        if (newCount === 0) {
          // seats cleared: delete all passenger rows to keep count aligned with seats.length.
          if (currentCount > 0) {
            const filledOnClear = currentPassengers.filter(p =>
              (p.name && p.name !== "A preencher") || p.cpf
            );
            if (filledOnClear.length > 0) {
              throw new AppError(
                "Cannot reduce seats: some passengers being removed already have their details filled in. Please clear or reassign them first.",
                409,
                "PASSENGERS_FILLED",
                { affectedPassengers: filledOnClear.map(p => ({ id: p.id, name: p.name, cpf: p.cpf })) },
              );
            }
            await tx.delete(passengersTable)
              .where(eq(passengersTable.reservationId, req.params.id));
          }
        } else if (currentCount === 0) {
          // No passengers exist yet — bootstrap primary from client data then add placeholders.
          if (existing.clientId) {
            const [clientData] = await tx.select().from(clientsTable)
              .where(and(eq(clientsTable.id, existing.clientId), eq(clientsTable.tenantId, me.tenantId)))
              .limit(1);
            if (clientData) {
              await tx.insert(passengersTable).values({
                id: generateId(),
                reservationId: req.params.id,
                name: clientData.name,
                cpf: clientData.cpf ?? null,
                rg: clientData.rg ?? null,
                birthDate: clientData.birthDate ?? null,
                ageCategory: deriveAgeCategory(clientData.birthDate ?? null),
                seatNumber: newSeats[0] ?? null,
                isChildUnder7: getAgeYears(clientData.birthDate ?? null) < 7,
                isPrimary: true,
              }).onConflictDoNothing();
            }
          }
          for (let i = 1; i < newCount; i++) {
            await tx.insert(passengersTable).values({
              id: generateId(),
              reservationId: req.params.id,
              name: "A preencher",
              cpf: null,
              rg: null,
              birthDate: null,
              ageCategory: "adult",
              seatNumber: newSeats[i] ?? null,
              isChildUnder7: false,
              isPrimary: false,
            });
          }
        } else if (newCount >= currentCount) {
          // Same count or more: add placeholders for extra seats, remap existing ones.
          for (let i = currentCount; i < newCount; i++) {
            await tx.insert(passengersTable).values({
              id: generateId(),
              reservationId: req.params.id,
              name: "A preencher",
              cpf: null,
              rg: null,
              birthDate: null,
              ageCategory: "adult",
              seatNumber: newSeats[i] ?? null,
              isChildUnder7: false,
              isPrimary: false,
            });
          }
          for (let i = 0; i < currentCount; i++) {
            const p = currentPassengers[i];
            const newSeat = newSeats[i] ?? null;
            const seatFields: Partial<typeof passengersTable.$inferInsert> = { seatNumber: newSeat };
            // Recalculate child/baby category when seat changes for isChildUnder7 passengers
            if (p.isChildUnder7) {
              seatFields.ageCategory = resolveChildAgeCategory(newSeat);
            }
            await tx.update(passengersTable).set(seatFields)
              .where(eq(passengersTable.id, p.id));
          }
        } else {
          // Fewer seats: choose removal candidates globally.
          // Priority: blank non-primary first (no cpf / placeholder name), then non-primary
          // with data; primary is always the last to be removed.
          const primaryPassenger = currentPassengers.find(p => p.isPrimary);
          const nonPrimary = currentPassengers.filter(p => !p.isPrimary);

          const sortedNonPrimary = [...nonPrimary].sort((a, b) => {
            const aBlank = (!a.cpf && (!a.name || a.name === "A preencher")) ? 0 : 1;
            const bBlank = (!b.cpf && (!b.name || b.name === "A preencher")) ? 0 : 1;
            return aBlank - bBlank;
          });

          const keepNonPrimaryCount = primaryPassenger ? newCount - 1 : newCount;
          const keepNonPrimary = sortedNonPrimary.slice(sortedNonPrimary.length - Math.max(0, keepNonPrimaryCount));
          const removeNonPrimary = sortedNonPrimary.slice(0, sortedNonPrimary.length - Math.max(0, keepNonPrimaryCount));
          const passengersToKeep = primaryPassenger ? [primaryPassenger, ...keepNonPrimary] : keepNonPrimary;

          const filledPassengers = removeNonPrimary.filter(p =>
            (p.name && p.name !== "A preencher") || p.cpf
          );
          if (filledPassengers.length > 0) {
            throw new AppError(
              "Cannot reduce seats: some passengers being removed already have their details filled in. Please clear or reassign them first.",
              409,
              "PASSENGERS_FILLED",
              { affectedPassengers: filledPassengers.map(p => ({ id: p.id, name: p.name, cpf: p.cpf })) },
            );
          }

          if (removeNonPrimary.length > 0) {
            await tx.delete(passengersTable)
              .where(inArray(passengersTable.id, removeNonPrimary.map(p => p.id)));
          }

          const orderedKept = [
            ...passengersToKeep.filter(p => p.isPrimary),
            ...passengersToKeep.filter(p => !p.isPrimary),
          ];
          for (let i = 0; i < orderedKept.length; i++) {
            const p = orderedKept[i];
            const newSeat = newSeats[i] ?? null;
            const seatFields: Partial<typeof passengersTable.$inferInsert> = { seatNumber: newSeat };
            // Recalculate child/baby category when seat changes for isChildUnder7 passengers
            if (p.isChildUnder7) {
              seatFields.ageCategory = resolveChildAgeCategory(newSeat);
            }
            await tx.update(passengersTable).set(seatFields)
              .where(eq(passengersTable.id, p.id));
          }
        }
      }

      return updated;
    });

    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    // Run only after the update transaction commits. The converter locks and
    // selects PENDING, making confirmation/payment replays exactly-once.
    if (
      reservation.discountReferralCode &&
      Number(reservation.paidValue ?? 0) > 0 &&
      !([RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED, RESERVATION_STATUS.FAILED] as string[]).includes(reservation.status)
    ) {
      await convertPaidReservationReferral(reservation.id, me.tenantId);
    }
    if (parsed.data.totalValue != null && existing.clientId) {
      await syncClientDeal(
        existing.clientId,
        me.tenantId,
        existing.tripId,
        parsed.data.totalValue,
        reservation.sellerId ?? me.id,
        req.params.id,
      );
    }
    if (isBeingConfirmed && existing.clientId) {
      loyaltyAwardPointsForReservation({
        clientId: existing.clientId,
        reservationId: req.params.id,
        amount: reservation.totalValue,
        tenantId: me.tenantId,
      }).catch((err) => req.log.error({ err }, "Error awarding loyalty points on reservation confirmation"));
    }
    if (isBeingCancelled && cancellationApplied && existing.clientId) {
      const code = existing.voucherCode ?? req.params.id.slice(-8).toUpperCase();
      writeClientActivity(existing.clientId, "reservation_cancelled", `Reserva ${code} cancelada`, me.id, { voucherCode: code })
        .catch((err) => req.log.error({ err }, "Error writing cancellation activity"));
      await cancelDealOnReservationCancellation({ tenantId: me.tenantId, reservationId: existing.id });
    }
    if (!isBeingCancelled) {
      enqueueCommissionSync(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueuing commission sync after reservation update"));
    }
    const formatted = await formatReservation(reservation, false);
    res.json(formatted);
    if (parsed.data.firstDueDate) {
      const instCount = parsed.data.installments ?? reservation.installments ?? 1;
      const total = parsed.data.totalValue != null ? parsed.data.totalValue : Number(reservation.totalValue);
      generateInstallments(req.params.id, me.tenantId, total, instCount, parsed.data.firstDueDate)
        .catch((err) => req.log.error({ err }, "Error regenerating installments on reservation update"));
    }
    // Send cancellation email only on a true active → cancelled transition
    // (not for "refunded", not for repeated patches on already-cancelled reservations)
    if (!isCsvImport && parsed.data.status === RESERVATION_STATUS.CANCELLED && cancellationApplied && existing.clientId) {
      enqueueReservationCancellationEmail(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing cancellation email"));
      const loyaltyPointsRefunded = (existing.discountLoyaltyPoints ?? 0) > 0
        ? (existing.discountLoyaltyPoints ?? 0)
        : undefined;
      insertClientNotification(
        existing.clientId,
        me.tenantId,
        "reservation_cancelled",
        {
          voucherCode: existing.voucherCode ?? undefined,
          ...(loyaltyPointsRefunded != null && { loyaltyPointsRefunded }),
        },
      ).catch((err) => req.log.error({ err }, "Error inserting cancellation client notification"));
    }
    // When a fully-paid reservation is confirmed via status change, notify the agency
    if (!isCsvImport && isBeingConfirmed) {
      enqueueNewBookingNotificationEmail(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing agency new-booking notification on reservation confirmation"));
    }
    // #18: When a reservation is confirmed, push a notification to the client's mobile app
    if (!isCsvImport && isBeingConfirmed && existing.clientId) {
      (async () => {
        try {
          const [client] = await db.select({
            expoPushToken: clientsTable.expoPushToken,
            whatsapp: clientsTable.whatsapp,
            phone: clientsTable.phone,
            name: clientsTable.name,
            whatsappOptIn: clientsTable.whatsappOptIn,
          })
            .from(clientsTable)
            .where(and(eq(clientsTable.id, existing.clientId!), eq(clientsTable.tenantId, me.tenantId)))
            .limit(1);
          if (client?.expoPushToken) {
            await sendPushNotification({
              to: client.expoPushToken,
              title: "Reserva confirmada",
              body: `Sua reserva ${existing.voucherCode ?? ""} foi confirmada. Boa viagem!`.trim(),
              data: { type: "reservation_confirmed", reservationId: existing.id },
            });
          }
          // WhatsApp confirmation when status changes to confirmed via PATCH
          dispatchWhatsAppReservationConfirmed({
            reservationId: existing.id,
            tenantId: me.tenantId,
          }).catch((err) => req.log.warn({ err }, "[whatsapp] Reservation confirmed (PATCH) dispatch failed — non-fatal"));
        } catch (err) {
          req.log.error({ err }, "Error sending push notification on reservation confirmation");
        }
      })();
    }
    // #28: When a referral is reversed on cancellation, notify the referrer
    if (!isCsvImport && reversedReferralInfo) {
      // TypeScript cannot observe assignments made inside the transaction
      // callback and narrows the outer variable to `never`; the runtime guard
      // above is authoritative here.
      const reversalInfo = reversedReferralInfo as {
        referralId: string;
        reservationId?: string;
        referrerId: string;
        referredId: string | null;
        bonusAmount: string;
      };
      const { referrerId: _rrReferrerId, referredId: _rrReferredId, bonusAmount: _rrBonusAmount } = reversalInfo;
      dispatchReferralReversedEmail({ referrerId: _rrReferrerId, referredId: _rrReferredId, bonusAmount: _rrBonusAmount, tenantId: me.tenantId, reason: "reservation_cancelled", referralId: reversalInfo.referralId, reservationId: reversalInfo.reservationId ?? existing.id })
        .catch((err) => req.log.error({ err }, "Error enqueueing referral reversal notification email"));
    }
    // A trip change affects both seat maps: the origin trip loses the
    // reservation and the destination trip gains it. Broadcast both after the
    // transaction has committed so connected SSE clients refresh each view.
    const affectedTripIds = new Set([existing.tripId, reservation.tripId]);
    for (const tripId of affectedTripIds) {
      broadcastSeatUpdate(tripId, me.tenantId).catch(() => {});
    }
    // Sync Google Calendar events after every reservation PATCH.
    // A move affects both trips: the origin must lose the reservation and the
    // destination must gain it. syncTrips deduplicates the IDs and runs only
    // after the update transaction has committed.
    // Use the dedicated cancellation path for active→cancelled/refunded
    // transitions so stale seller events are removed explicitly.
    if (isBeingCancelled && cancellationApplied) {
      CalendarSyncService.syncTripOnReservationCancellation(existing.tripId)
        .catch((err) => req.log.error({ err }, "Error syncing Google Calendar after reservation cancellation"));
      if (tripChanged && reservation.tripId !== existing.tripId) {
        CalendarSyncService.syncTrip(reservation.tripId)
          .catch((err) => req.log.error({ err }, "Error syncing destination Google Calendar after reservation cancellation"));
      }
    } else if (tripChanged) {
      CalendarSyncService.syncTrips([existing.tripId, reservation.tripId])
        .catch((err) => req.log.error({ err }, "Error syncing Google Calendar after reservation trip change"));
    } else {
      CalendarSyncService.syncTrip(existing.tripId)
        .catch((err) => req.log.error({ err }, "Error syncing Google Calendar after reservation update"));
    }
  } catch (err) {
    next(err);
  }
});

const UpdateInstallmentBodySchema = z.object({
  paidAmount: z.number().positive().nullish(),
  paidAt: z.string().nullish(),
  dueDate: z.string().nullish(),
  notes: z.string().nullish(),
});

router.get("/reservations/:id/installments", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await requireReservationAccess(me, req.params.id);
    const rows = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.reservationId, req.params.id))
      .orderBy(asc(reservationInstallmentsTable.installmentNumber));
    const now = new Date();
    const formatted = rows.map(r => ({
      id: r.id,
      reservationId: r.reservationId,
      installmentNumber: r.installmentNumber,
      dueDate: (r.dueDate as unknown as Date).toISOString(),
      amount: Number(r.amount),
      paidAmount: r.paidAmount != null ? Number(r.paidAmount) : null,
      paidAt: r.paidAt ? (r.paidAt as unknown as Date).toISOString() : null,
      notes: r.notes ?? null,
      status: r.paidAt != null ? "paid" : (r.dueDate as unknown as Date) < now ? "overdue" : "pending",
    }));
    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/installments/upcoming", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === "cliente") { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "7")), 1), 90);
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + days);
    until.setHours(23, 59, 59, 999);

    const rows = await db
      .select({
        id: reservationInstallmentsTable.id,
        reservationId: reservationInstallmentsTable.reservationId,
        installmentNumber: reservationInstallmentsTable.installmentNumber,
        dueDate: reservationInstallmentsTable.dueDate,
        amount: reservationInstallmentsTable.amount,
        paidAt: reservationInstallmentsTable.paidAt,
        notes: reservationInstallmentsTable.notes,
        voucherCode: reservationsTable.voucherCode,
        clientId: reservationsTable.clientId,
        clientName: clientsTable.name,
        tripName: tripsTable.name,
      })
      .from(reservationInstallmentsTable)
      .innerJoin(reservationsTable, eq(reservationInstallmentsTable.reservationId, reservationsTable.id))
      .leftJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
      .leftJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .where(and(
        eq(reservationInstallmentsTable.tenantId, me.tenantId),
        sql`${reservationInstallmentsTable.paidAt} IS NULL`,
        sql`${reservationInstallmentsTable.dueDate} >= NOW()`,
        sql`${reservationInstallmentsTable.dueDate} <= ${until.toISOString()}`,
      ))
      .orderBy(asc(reservationInstallmentsTable.dueDate));

    res.json(rows.map(r => ({
      id: r.id,
      reservationId: r.reservationId,
      installmentNumber: r.installmentNumber,
      dueDate: (r.dueDate as unknown as Date).toISOString(),
      amount: Number(r.amount),
      paidAt: r.paidAt ? (r.paidAt as unknown as Date).toISOString() : null,
      notes: r.notes ?? null,
      status: "pending",
      voucherCode: r.voucherCode ?? null,
      clientName: r.clientName ?? null,
      tripName: r.tripName ?? null,
    })));
  } catch (err) {
    next(err);
  }
});

router.patch("/reservations/installments/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = UpdateInstallmentBodySchema.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [installment] = await db.select().from(reservationInstallmentsTable)
      .where(and(eq(reservationInstallmentsTable.id, req.params.id), eq(reservationInstallmentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!installment) { next(new NotFoundError("Installment not found", "NOT_FOUND")); return; }

    // Ensure the caller has access to the parent reservation
    await requireReservationAccess(me, installment.reservationId);

    const updates: Partial<typeof reservationInstallmentsTable.$inferInsert> = {};
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    if (parsed.data.dueDate !== undefined && parsed.data.dueDate) {
      const d = new Date(`${parsed.data.dueDate}T12:00:00Z`);
      if (!isNaN(d.getTime())) updates.dueDate = d;
    }
    if (parsed.data.paidAmount !== undefined) {
      updates.paidAmount = parsed.data.paidAmount != null ? String(parsed.data.paidAmount) : null;
    }
    if (parsed.data.paidAt !== undefined) {
      updates.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;
    }
    if (parsed.data.paidAmount != null && !parsed.data.paidAt && !installment.paidAt) {
      updates.paidAt = new Date();
    }

    await db.update(reservationInstallmentsTable)
      .set(updates)
      .where(eq(reservationInstallmentsTable.id, req.params.id));

    const allInstallments = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.reservationId, installment.reservationId));
    const totalPaid = allInstallments.reduce((sum, r) => {
      const pa = r.id === req.params.id ? (parsed.data.paidAmount ?? (updates.paidAt ? Number(r.amount) : null)) : (r.paidAt ? Number(r.paidAmount ?? r.amount) : null);
      return sum + (pa ?? 0);
    }, 0);

    const [reservation] = await db.select({ totalValue: reservationsTable.totalValue })
      .from(reservationsTable).where(eq(reservationsTable.id, installment.reservationId)).limit(1);
    if (reservation) {
      const total = Number(reservation.totalValue);
      const newBalance = Math.max(0, total - totalPaid);
      await db.update(reservationsTable)
        .set({ paidValue: totalPaid.toFixed(2), balance: newBalance.toFixed(2) })
        .where(eq(reservationsTable.id, installment.reservationId));
    }

    const [updated] = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.id, req.params.id)).limit(1);
    const now = new Date();
    res.json({
      id: updated.id,
      reservationId: updated.reservationId,
      installmentNumber: updated.installmentNumber,
      dueDate: (updated.dueDate as unknown as Date).toISOString(),
      amount: Number(updated.amount),
      paidAmount: updated.paidAmount != null ? Number(updated.paidAmount) : null,
      paidAt: updated.paidAt ? (updated.paidAt as unknown as Date).toISOString() : null,
      notes: updated.notes ?? null,
      status: updated.paidAt != null ? "paid" : (updated.dueDate as unknown as Date) < now ? "overdue" : "pending",
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.DELETE)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const existing = await requireReservationAccess(me, req.params.id);

    await db.transaction(async (tx) => {
      await deleteReservationAndReleaseCapacity(tx, me.tenantId, req.params.id);
    });
    res.json({ success: true });
    broadcastSeatUpdate(existing.tripId, me.tenantId).catch(() => {});
    CalendarSyncService.syncTrip(existing.tripId)
      .catch((err) => req.log.warn({ err, context: "reservation.delete", tripId: existing.tripId, reservationId: req.params.id }, "Calendar sync falhou — continuando"));
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const existing = await requireReservationAccess(me, req.params.id);
    await db.update(reservationsTable).set({
      checkedInAt: new Date(),
      status: RESERVATION_STATUS.COMPLETED,
    }).where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)));
    const [reservation] = await db.select().from(reservationsTable)
      .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    if (existing.clientId) {
      await moveDealToStage({
        tenantId: me.tenantId,
        clientId: existing.clientId,
        reservationId: req.params.id,
        targetStageName: "Em Viagem",
        forwardOnly: true,
      });
    }
    const formatted = await formatReservation(reservation, false);
    res.json(formatted);
    broadcastSeatUpdate(existing.tripId, me.tenantId).catch(() => {});
    if (existing.clientId) {
      const [trip] = await db.select({ name: tripsTable.name }).from(tripsTable)
        .where(eq(tripsTable.id, existing.tripId)).limit(1);
      const tripName = trip?.name ?? "viagem";
      writeClientActivity(existing.clientId, "checkin", `Check-in realizado na viagem ${tripName}`, me.id, { tripName })
        .catch((err) => req.log.error({ err }, "Error writing check-in activity"));
    }
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/:reservationId/passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const passengers = await db.select().from(passengersTable)
      .where(eq(passengersTable.reservationId, req.params.reservationId));
    res.json(passengers.map(formatPassenger));
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/import-manifest", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const parsed = ManifestImportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Linhas do manifesto inválidas.", "VALIDATION_ERROR")); return;
    }

    const reservationNumbers = [...new Set(parsed.data.rows.map(row => row.reservationNumber))];
    const reservationRows = await db.select({ reservation: reservationsTable, trip: tripsTable })
      .from(reservationsTable)
      .innerJoin(tripsTable, and(eq(tripsTable.id, reservationsTable.tripId), eq(tripsTable.tenantId, reservationsTable.tenantId)))
      .where(and(eq(reservationsTable.tenantId, me.tenantId), inArray(reservationsTable.reservationNumber, reservationNumbers)));
    const reservationIds = reservationRows.map(row => row.reservation.id);
    const passengerRows = reservationIds.length
      ? await db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservationIds))
      : [];
    const passengersByReservation = new Map<string, typeof passengerRows>();
    for (const passenger of passengerRows) {
      const list = passengersByReservation.get(passenger.reservationId) ?? [];
      list.push(passenger);
      passengersByReservation.set(passenger.reservationId, list);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();

    for (const row of parsed.data.rows) {
      const candidates = reservationRows.filter(candidate =>
        candidate.reservation.reservationNumber === row.reservationNumber
        && normalizeManifestText(candidate.trip.name) === normalizeManifestText(row.tripName)
        && tripMatchesManifestDate(candidate.trip.departureDate, row.departureDate),
      );
      if (candidates.length === 0) {
        skipped++; errors.push(`Linha ${row.line}: reserva ${row.reservationNumber} para "${row.tripName}" em ${row.departureDate} não foi encontrada nesta agência.`);
        continue;
      }
      if (candidates.length > 1) {
        skipped++; errors.push(`Linha ${row.line}: a referência da reserva ${row.reservationNumber} é ambígua.`);
        continue;
      }

      const candidate = candidates[0];
      const duplicateKey = `${candidate.reservation.id}|${row.cpf ?? `${normalizeManifestText(row.name)}|${row.birthDate ?? ""}`}`;
      if (seen.has(duplicateKey)) {
        skipped++; errors.push(`Linha ${row.line}: passageiro duplicado no arquivo para a mesma reserva.`);
        continue;
      }
      seen.add(duplicateKey);

      const current = passengersByReservation.get(candidate.reservation.id) ?? [];
      const byCpf = row.cpf ? current.filter(passenger => passenger.cpf?.replace(/\D/g, "") === row.cpf!.replace(/\D/g, "")) : [];
      const byName = !row.cpf ? current.filter(passenger =>
        normalizeManifestText(passenger.name) === normalizeManifestText(row.name)
        && (!row.birthDate || (passenger.birthDate != null && brazilDateKey(passenger.birthDate) === row.birthDate)),
      ) : [];
      const matches = byCpf.length ? byCpf : byName;
      if (matches.length > 1) {
        skipped++; errors.push(`Linha ${row.line}: há mais de um passageiro correspondente na reserva ${row.reservationNumber}.`);
        continue;
      }

      let boardingLocationId: string | undefined;
      if (row.boardingPoint) {
        const boardingPoints = candidate.trip.boardingPoints ?? [];
        const boarding = boardingPoints.find(point => normalizeManifestText(point.name) === normalizeManifestText(row.boardingPoint!));
        if (boarding) boardingLocationId = boarding.id;
        else warnings.push(`Linha ${row.line}: ponto de embarque "${row.boardingPoint}" não existe nesta viagem; ele não foi alterado.`);
      }
      if (row.status) {
        warnings.push(`Linha ${row.line}: status "${row.status}" foi informado apenas como referência; check-in não é alterado pela importação.`);
      }
      const ageCategory = row.ageCategory ?? undefined;
      const values = {
        name: row.name,
        ...(row.cpf ? { cpf: row.cpf } : {}),
        ...(row.birthDate ? { birthDate: manifestDate(row.birthDate) } : {}),
        ...(ageCategory ? { ageCategory, isChildUnder7: syncIsChildUnder7(ageCategory) } : {}),
        ...(row.seatNumber ? { seatNumber: row.seatNumber } : {}),
        ...(row.phone ? { phone: row.phone } : {}),
        ...(boardingLocationId ? { boardingLocationId } : {}),
      };

      if (matches.length === 1) {
        await db.update(passengersTable).set(values).where(eq(passengersTable.id, matches[0].id));
        updated++;
      } else {
        const id = generateId();
        const category = ageCategory ?? "adult";
        const inserted = {
          id, reservationId: candidate.reservation.id, ...values,
          ageCategory: category, isChildUnder7: syncIsChildUnder7(category),
        };
        await db.insert(passengersTable).values(inserted);
        current.push({ ...inserted, cpf: inserted.cpf ?? null, birthDate: inserted.birthDate ?? null, seatNumber: inserted.seatNumber ?? null, phone: inserted.phone ?? null, boardingLocationId: inserted.boardingLocationId ?? null, rg: null, isPrimary: false, checkedInAt: null, disembarkLocationId: null, observations: null, specialNeeds: null, documentType: null });
        passengersByReservation.set(candidate.reservation.id, current);
        created++;
      }
      broadcastSeatUpdate(candidate.reservation.tripId, me.tenantId).catch(() => {});
    }
    res.json({ created, updated, skipped, errors, warnings });
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:reservationId/passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const parsed = CreatePassengerBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    // Compute ageCategory from the isChildUnder7 hint, then derive isChildUnder7
    // atomically so both fields are always consistent in the DB.
    const resolvedAgeCategory: string = parsed.data.isChildUnder7 === true
      ? resolveChildAgeCategory(parsed.data.seatNumber ?? null)
      : parsed.data.ageCategory;
    const resolvedIsChildUnder7 = syncIsChildUnder7(resolvedAgeCategory);

    const id = generateId();
    await db.insert(passengersTable).values({
      id,
      reservationId: req.params.reservationId,
      name: parsed.data.name,
      cpf: parsed.data.cpf ?? null,
      rg: parsed.data.rg ?? null,
      birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
      ageCategory: resolvedAgeCategory,
      seatNumber: parsed.data.seatNumber ?? null,
      isChildUnder7: resolvedIsChildUnder7,
    });
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new AppError("Failed to create passenger", 500, "PASSENGER_CREATE_FAILED")); return; }
    res.status(201).json(formatPassenger(passenger));
  } catch (err) {
    next(err);
  }
});

router.patch("/reservations/:reservationId/passengers/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const parsed = UpdatePassengerBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof passengersTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.cpf !== undefined) updates.cpf = parsed.data.cpf ?? null;
    if (parsed.data.rg !== undefined) updates.rg = parsed.data.rg ?? null;
    if (parsed.data.birthDate !== undefined) updates.birthDate = parsed.data.birthDate ? new Date(parsed.data.birthDate) : null;
    if (parsed.data.seatNumber !== undefined) updates.seatNumber = parsed.data.seatNumber ?? null;

    // Always update both ageCategory and isChildUnder7 atomically so they are
    // never contradictory in the DB.
    //
    // Priority order when both or either are sent:
    //  1. isChildUnder7 flag present → derive ageCategory from seat (flag wins)
    //  2. ageCategory present (no flag) → set ageCategory, derive isChildUnder7 from it
    //
    if (parsed.data.isChildUnder7 !== undefined) {
      if (parsed.data.isChildUnder7) {
        // Determine effective seat: use incoming value if provided, else read from DB
        let effectiveSeat: string | null;
        if (parsed.data.seatNumber !== undefined) {
          effectiveSeat = parsed.data.seatNumber ?? null;
        } else {
          const [existing] = await db.select({ seatNumber: passengersTable.seatNumber })
            .from(passengersTable)
            .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
            .limit(1);
          effectiveSeat = existing?.seatNumber ?? null;
        }
        // seated child → Criança; on-lap child → Bebê
        const resolvedCat = resolveChildAgeCategory(effectiveSeat);
        updates.ageCategory = resolvedCat;
        updates.isChildUnder7 = true; // always true when flag is true
      } else {
        // Flag cleared — derive ageCategory from caller-supplied value or default to adult
        const clearedStr = (parsed.data.ageCategory ?? "adult") as string;
        updates.ageCategory = clearedStr as typeof passengersTable.$inferInsert["ageCategory"];
        updates.isChildUnder7 = syncIsChildUnder7(clearedStr); // false unless caller sends child/baby
      }
    } else if (parsed.data.ageCategory != null) {
      // No flag sent — update ageCategory and derive isChildUnder7 from it atomically
      const catOnly = parsed.data.ageCategory as string;
      updates.ageCategory = catOnly;
      updates.isChildUnder7 = syncIsChildUnder7(catOnly);
    }

    const seatNumberChanged = parsed.data.seatNumber !== undefined;
    await db.update(passengersTable).set(updates)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
    // Broadcast seat-map SSE event when a passenger's seat number changes so
    // the boarding panel (PassengersList / Lista ANTT) auto-refreshes without
    // requiring a manual page reload.
    if (seatNumberChanged) {
      broadcastSeatUpdate(reservation.tripId, me.tenantId).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:reservationId/passengers/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.delete(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:reservationId/passengers/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.update(passengersTable)
      .set({ checkedInAt: new Date() })
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
    broadcastSeatUpdate(reservation.tripId, me.tenantId).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:reservationId/passengers/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.update(passengersTable)
      .set({ checkedInAt: null })
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
    broadcastSeatUpdate(reservation.tripId, me.tenantId).catch(() => {});
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:id/retry-commission-sync", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // Commission synchronization can affect financial records, so it requires
    // the matrix's management permission rather than a broad role shortcut.
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.MANAGE)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const [reservation] = await db.select()
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }

    await enqueueCommissionSync(reservation.id, me.tenantId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
