import { contentJson } from "./client";
import { parseFlow } from "./contracts";

// Looking up a lost authentication response must never complete or repeat a mutation.
export async function readLoginRecovery(origin: string, transport: typeof fetch = fetch) {
  return parseFlow(await contentJson(origin, "/auth/flow", {}, transport));
}
