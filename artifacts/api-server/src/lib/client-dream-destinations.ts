import { db, clientsTable, clientDreamDestinationsTable } from "@workspace/db";
import { and, count, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";

export async function insertDreamDestination(input: {
  id: string;
  tenantId: string;
  clientId: string;
  destinationName: string;
  note: string | null;
}): Promise<Date> {
  return db.transaction(async (tx) => {
    // Lock the parent client so concurrent requests cannot both observe 29 rows.
    const [client] = await tx.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.id, input.clientId), eq(clientsTable.tenantId, input.tenantId)))
      .for("update").limit(1);
    if (!client) throw new NotFoundError("Cliente não encontrado", "CLIENT_NOT_FOUND");
    const [result] = await tx.select({ c: count() }).from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.tenantId, input.tenantId), eq(clientDreamDestinationsTable.clientId, input.clientId)));
    if (Number(result?.c ?? 0) >= 30) throw new ValidationError("Limite de 30 destinos atingido", "LIMIT_EXCEEDED");
    const [inserted] = await tx.insert(clientDreamDestinationsTable).values(input)
      .returning({ createdAt: clientDreamDestinationsTable.createdAt });
    return inserted.createdAt;
  });
}