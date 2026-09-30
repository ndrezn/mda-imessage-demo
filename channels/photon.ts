import { channels } from "managed-deepagents";

import { parse, post, verify } from "../lib/photon.js";

export const channel = channels.http({
  provider: "photon",
  verify,
  parse,
  post,
});
