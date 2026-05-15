// Core SDK entrypoint — CloudEvents envelope + Standard Webhooks
// signing for autoblog post-published events.
//
// Subpath exports cover the other standards:
//   @profullstack/autoblog/micropub      — W3C Micropub server helpers
//   @profullstack/autoblog/activitypub   — W3C ActivityPub protocol surface

export * from "./types.js";
export { signRequest, verifySignature } from "./sign.js";
export type { SignInput, VerifyInput, VerifyResult } from "./sign.js";
export { buildEvent, sendWebhook } from "./sender.js";
export type { BuildEventOpts, SendWebhookOpts, DeliveryResult } from "./sender.js";
export { verifyAndParse } from "./receiver.js";
export type {
  ReceivedHeaders,
  ParseOpts,
  ParseResult,
  ParseSuccess,
  ParseFailure,
} from "./receiver.js";
