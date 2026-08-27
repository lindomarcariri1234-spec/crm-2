import type { Response } from "express";

/**
 * Writes a chunk to the response, honoring backpressure so a large export
 * cannot buffer without bound in memory. Same pattern as the batched
 * GET /trips/export endpoint.
 */
export async function writeStreamChunk(res: Response, chunk: string): Promise<void> {
  if (res.write(chunk)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Export client disconnected"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

/**
 * Minimal incremental JSON writer for streaming a large export document
 * without materializing the whole payload in memory. It only supports a
 * strict, linear, depth-first sequence of writes (objects/arrays are opened
 * and closed in nesting order) — there is no random access or backtracking.
 *
 * Usage:
 *   const w = new JsonStreamWriter(res);
 *   await w.beginObject();
 *     await w.key("name"); await w.value("Trip A");
 *     await w.key("items"); await w.beginArray();
 *       await w.arrayItem({ id: 1 });
 *       await w.arrayItem({ id: 2 });
 *     await w.endArray();
 *   await w.endObject();
 */
export class JsonStreamWriter {
  private res: Response;
  // Each entry tracks whether the currently-open object/array is still
  // waiting for its first member (key or item). `true` = no comma needed yet.
  private stack: boolean[] = [];

  constructor(res: Response) {
    this.res = res;
  }

  private async raw(chunk: string): Promise<void> {
    await writeStreamChunk(this.res, chunk);
  }

  // Called immediately before writing a key (inside an object) or an item
  // (inside an array): inserts a comma unless this is the first member.
  private async beforeMember(): Promise<void> {
    if (this.stack.length === 0) return;
    const top = this.stack.length - 1;
    if (this.stack[top]) {
      this.stack[top] = false;
    } else {
      await this.raw(",");
    }
  }

  async beginObject(): Promise<void> {
    await this.raw("{");
    this.stack.push(true);
  }

  async endObject(): Promise<void> {
    await this.raw("}");
    this.stack.pop();
  }

  async beginArray(): Promise<void> {
    await this.raw("[");
    this.stack.push(true);
  }

  async endArray(): Promise<void> {
    await this.raw("]");
    this.stack.pop();
  }

  /** Writes `"name":` inside the currently open object. Must be followed by exactly one value write. */
  async key(name: string): Promise<void> {
    await this.beforeMember();
    await this.raw(`${JSON.stringify(name)}:`);
  }

  /** Writes a full JSON-serializable value — used right after key(), or standalone at the root. */
  async value(v: unknown): Promise<void> {
    await this.raw(JSON.stringify(v));
  }

  /** Writes one element inside the currently open array, handling comma placement. */
  async arrayItem(v: unknown): Promise<void> {
    await this.beforeMember();
    await this.raw(JSON.stringify(v));
  }
}
