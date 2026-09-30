import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

// `Spectrum()` is async and `providers` is required, so the client cannot be a
// plain module-level const. Construct it once, lazily, and await it at callsites.
function create() {
  return Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID!,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
    providers: [imessage.config()],
    webhookSecret: process.env.SPECTRUM_SIGNING_SECRET,
  });
}

let instance: ReturnType<typeof create> | undefined;

export function spectrum() {
  if (!instance) {
    instance = create();
    // Never cache a rejection: one transient construction failure would
    // otherwise poison every later call until the next deploy.
    instance.catch(() => {
      instance = undefined;
    });
  }
  return instance;
}

/**
 * `im.space.get()` is local construction — measured at 0ms, no network call,
 * and it returns an object even for an unknown id. Nothing to cache.
 */
export async function getSpace(spaceId: string) {
  const im = imessage(await spectrum());
  return im.space.get(spaceId);
}
