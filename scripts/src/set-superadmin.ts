import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.log("Usage: pnpm superadmin:set <email>");
    console.log("");
    console.log("Sets the role of an existing user to 'superadmin'.");
    console.log("");
    console.log("Example:");
    console.log("  pnpm superadmin:set admin@example.com");
    process.exit(0);
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (users.length === 0) {
    console.error("Error: No user found with the provided email.");
    process.exit(1);
  }

  const user = users[0]!;

  await db
    .update(usersTable)
    .set({ role: "superadmin" })
    .where(eq(usersTable.id, user.id));

  console.log("Success! User updated to superadmin.");
  console.log(`  ID: ${user.id}`);
}

main().catch(() => {
  console.error("Error: Failed to update user role. Check the database connection and try again.");
  process.exit(1);
});
