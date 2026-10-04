import { normalizeBrazilPhone } from "./phone.js";

export type TripWhatsAppBroadcastFilter = "all" | "confirmed" | "pending";

export interface TripWhatsAppBroadcastPhoneCandidate {
  phone: string | null | undefined;
  clientId?: string | null;
}

export interface TripWhatsAppBroadcastPassengerContact {
  reservationStatus: string | null | undefined;
  name: string;
  phones: readonly TripWhatsAppBroadcastPhoneCandidate[];
  reference?: string | null;
  boardingLocation?: string | null;
}

export interface TripWhatsAppBroadcastFreeContact {
  name: string;
  phones: readonly TripWhatsAppBroadcastPhoneCandidate[];
}

export interface TripWhatsAppBroadcastRecipient {
  phone: string;
  recipientClientId?: string;
  name: string;
  reference: string;
  boardingLocation: string;
}

export interface TripWhatsAppBroadcastSelection {
  recipients: TripWhatsAppBroadcastRecipient[];
  skipped: number;
}

export function buildTripWhatsAppBroadcastIdempotencyKey(
  tripId: string,
  requestId: string,
  normalizedPhone: string,
): string {
  return `trip:${tripId}:whatsapp-broadcast:${requestId}:${normalizedPhone}`;
}

export function selectTripWhatsAppBroadcastRecipients(
  filter: TripWhatsAppBroadcastFilter,
  passengers: readonly TripWhatsAppBroadcastPassengerContact[],
  freePassengers: readonly TripWhatsAppBroadcastFreeContact[] = [],
): TripWhatsAppBroadcastSelection {
  const recipients: TripWhatsAppBroadcastRecipient[] = [];
  const sentPhones = new Set<string>();
  let skipped = 0;

  const addRecipient = (
    contact:
      TripWhatsAppBroadcastPassengerContact | TripWhatsAppBroadcastFreeContact,
  ) => {
    const validCandidates = contact.phones.flatMap((candidate) => {
      if (typeof candidate.phone !== "string") return [];
      const phone = normalizeBrazilPhone(candidate.phone);
      return phone
        ? [{ phone, clientId: candidate.clientId ?? undefined }]
        : [];
    });
    const phone = validCandidates[0]?.phone;
    if (!phone || sentPhones.has(phone)) {
      skipped++;
      return;
    }

    sentPhones.add(phone);
    const recipientClientId = validCandidates.find(
      (candidate) => candidate.phone === phone && candidate.clientId,
    )?.clientId;
    recipients.push({
      phone,
      ...(recipientClientId ? { recipientClientId } : {}),
      name: contact.name,
      reference: "reference" in contact ? (contact.reference ?? "") : "",
      boardingLocation:
        "boardingLocation" in contact ? (contact.boardingLocation ?? "") : "",
    });
  };

  for (const passenger of passengers) {
    if (filter === "confirmed" && passenger.reservationStatus !== "confirmed")
      continue;
    if (filter === "pending" && passenger.reservationStatus !== "pending")
      continue;
    if (
      filter === "all" &&
      (passenger.reservationStatus === "cancelled" ||
        passenger.reservationStatus === "refunded")
    )
      continue;
    addRecipient(passenger);
  }

  // Standalone guides and organizers have no reservation status, so only the
  // unfiltered broadcast can include them.
  if (filter === "all") {
    for (const passenger of freePassengers) addRecipient(passenger);
  }

  return { recipients, skipped };
}
