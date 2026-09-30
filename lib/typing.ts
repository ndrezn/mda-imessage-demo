import { getSpace } from "./spectrum.js";

/**
 * One signal per message, deliberately not refreshed.
 *
 * Photon allows 5 requests per second per project, and every typing signal is
 * a real stream publish. A refresh loop multiplies that by run duration and
 * competes with the reply, which is the only call that actually matters. The
 * bubble fades on a long run; that is the accepted trade.
 */
export async function beginTyping(spaceId: string): Promise<void> {
  try {
    const space = await getSpace(spaceId);
    await space?.startTyping();
  } catch {
    // Best-effort: a cosmetic indicator must never break or delay a run.
  }
}
