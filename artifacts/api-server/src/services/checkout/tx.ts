import { db } from "@workspace/db";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
