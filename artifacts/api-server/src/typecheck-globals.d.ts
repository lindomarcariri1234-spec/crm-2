import type pino from "pino";
import type { ReqId } from "pino-http";

declare module "http" {
  interface IncomingMessage {
    id: ReqId;
    log: pino.Logger;
  }
}

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}