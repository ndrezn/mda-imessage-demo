import { createHmac, timingSafeEqual } from "node:crypto";

import { heifToJpeg } from "heif2jpeg";
import type {
  HttpChannelParseResult,
  HttpChannelPostInput,
  HttpChannelRequest,
  HttpPostedMessage,
} from "managed-deepagents";
import { imessage } from "spectrum-ts/providers/imessage";

import { senderThreadId } from "./ids.js";
import { getSpace, spectrum } from "./spectrum.js";
import { beginTyping } from "./typing.js";

const REPLAY_WINDOW_SECONDS = 300;
const SEND_ATTEMPTS = 4;
const BACKOFF_MS = [1_000, 3_000, 7_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimited(error: unknown): boolean {
  const s = String((error as Error)?.message ?? error);
  return s.includes("429") || /rate.?limit/i.test(s);
}

export function verify({ request, rawBody }: HttpChannelRequest): boolean {
  const secret = process.env.SPECTRUM_SIGNING_SECRET;
  if (!secret) return false;

  const timestamp = request.headers.get("x-spectrum-timestamp");
  const signature = request.headers.get("x-spectrum-signature");
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > REPLAY_WINDOW_SECONDS) return false;

  const expected = Buffer.from(
    "v0=" +
      createHmac("sha256", secret)
        .update(`v0:${timestamp}:`)
        .update(rawBody)
        .digest("hex"),
  );
  const received = Buffer.from(signature);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export async function parse({
  rawBody,
}: HttpChannelRequest): Promise<HttpChannelParseResult> {
  const event = JSON.parse(Buffer.from(rawBody).toString("utf8"));

  // Photon's docs show the discriminator as "messages"; the webhook
  // registration calls the same thing "message.received". Accept either.
  if (event.event !== "messages" && event.event !== "message.received") {
    console.log("[photon] ignored event", JSON.stringify(event).slice(0, 400));
    return { type: "ignore" };
  }

  const { space, message } = event;
  if (!space || !message) {
    console.log("[photon] missing space/message", JSON.stringify(event).slice(0, 400));
    return { type: "ignore" };
  }
  // Treat a missing direction as inbound; only skip explicit outbound echoes.
  if (message.direction && message.direction !== "inbound") {
    console.log("[photon] ignored: direction", message.direction);
    return { type: "ignore" };
  }

  const content: (
    | { type: "text"; text: string }
    | {
        type: "image";
        source_type: "base64";
        mime_type: string;
        data: string;
      }
  )[] = [];
  const c = message.content;

  if (c.type === "text") {
    content.push({ type: "text", text: c.text });
  } else if (c.type === "attachment" && c.mimeType?.startsWith("image/")) {
    const im = imessage(await spectrum());
    const att = await im.getAttachment(c.id);
    if (!att) {
      console.log("[photon] ignored: getAttachment returned nothing for", c.id);
      return { type: "ignore" };
    }

    let bytes: Buffer = Buffer.from(await att.read());
    let mimeType: string = c.mimeType;
    if (mimeType === "image/heic" || mimeType === "image/heif") {
      bytes = await heifToJpeg(bytes, { quality: 85 });
      mimeType = "image/jpeg";
    }

    content.push({
      type: "image",
      source_type: "base64",
      mime_type: mimeType,
      data: bytes.toString("base64"),
    });
  } else {
    console.log(
      "[photon] ignored: unhandled content",
      JSON.stringify({ type: c?.type, mimeType: c?.mimeType, name: c?.name }),
    );
    return { type: "ignore" };
  }

  // Show the "…" bubble while the agent works.
  void beginTyping(String(space.id));

  return {
    type: "message",
    message: {
      userId: String(message.sender.id),
      threadId: senderThreadId(String(message.sender.id)),
      content,
      target: {
        id: String(space.id),
        ...(space.platform ? { platform: String(space.platform) } : {}),
      },
    },
    rawEvent: event,
  };
}

export async function post(
  input: HttpChannelPostInput,
): Promise<HttpPostedMessage> {
  if (input.type !== "content") {
    throw new Error("Photon adapter supports content messages only");
  }
  const target = input.target as { id: string; platform?: string };

  // The payload shows "iMessage" but the SDK platform def is "imessage", and
  // the field can be absent. Only reject a positively-known other platform.
  const platform = target.platform?.toLowerCase();
  if (platform && platform !== "imessage") {
    // TODO: narrow to whatsapp()/telegram() past iMessage.
    throw new Error(`Unsupported platform: ${target.platform}`);
  }

  const raw = input.content;
  const text = (
    typeof raw === "string"
      ? raw
      : raw.map((b) => (b.type === "text" ? String(b.text ?? "") : "")).join("")
  ).trim();
  if (!text) throw new Error("Reply had no text content to send");

  const space = await getSpace(target.id);
  if (!space) throw new Error(`Unknown space: ${target.id}`);

  // Photon allows 5 requests/second per project and returns 429 over it. The
  // reply is the whole point of the run, so retry rather than letting MDA fall
  // back to its generic error text. The typing bubble clears when the reply
  // lands and fades on its own otherwise, so there is nothing to undo here.
  let lastError: unknown;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt++) {
    try {
      const sent = await space.send(text);
      if (!sent) throw new Error("Spectrum returned no message for the reply");
      return { id: String(sent.id) };
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === SEND_ATTEMPTS - 1) throw error;
      await sleep(BACKOFF_MS[attempt] ?? 7_000);
    }
  }
  throw lastError;
}
