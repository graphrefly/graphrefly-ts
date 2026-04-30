/**
 * Webhook IO — `fromWebhook` is a thin wrapper over `externalProducer` that
 * exposes the standard `EmitTriad` (`emit` / `error` / `complete`) callback
 * shape to the caller's framework integration (Express, Fastify, Hono,
 * Cloudflare Workers, etc.).
 *
 * Re-exports from `./index.js` (the consolidated io source); physical body
 * split deferred — see `archive/docs/SESSION-patterns-extras-consolidation-plan.md`
 * §2 for status.
 */

export { fromWebhook, type WebhookRegister } from "./index.js";
