import { db, notesTable } from "@workspace/db";
import { generateId } from "./id";

export async function writeClientActivity(
  clientId: string,
  type: string,
  content: string,
  createdById: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(notesTable).values({
    id: generateId(),
    clientId,
    type,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    isPrivate: false,
    createdById,
  });
}
