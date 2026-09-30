import { createHash } from "node:crypto";

const REFLEX_NAMESPACE = Buffer.from("b3f1c2d45e6a4b7c8d9e0f1a2b3c4d5e", "hex");

export function senderThreadId(senderId: string): string {
  const bytes = createHash("sha1")
    .update(REFLEX_NAMESPACE)
    .update(senderId, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}