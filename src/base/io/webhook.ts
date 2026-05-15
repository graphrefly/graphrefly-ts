/**
 * Webhook IO — `fromWebhook` is a thin wrapper over `externalProducer` that
 * exposes the standard `EmitTriad` (`emit` / `error` / `complete`) callback
 * shape to the caller's framework integration (Express, Fastify, Hono,
 * Cloudflare Workers, etc.).
 */

import type { Node } from "@graphrefly/pure-ts/core";
import {
	type EmitTriad,
	type ExternalRegister,
	externalProducer,
} from "../composition/external-register.js";
import type { ExtraOpts } from "./_internal.js";

/** Registration callback for {@link fromWebhook}. Alias of {@link ExternalRegister} over {@link EmitTriad}. */
export type WebhookRegister<T> = ExternalRegister<EmitTriad<T>>;

/**
 * Bridges HTTP webhook callbacks into a GraphReFly source.
 *
 * The `register` callback wires your runtime/framework callback to GraphReFly and may return a
 * cleanup function. This keeps the adapter runtime-agnostic while following the same producer
 * pattern as {@link fromEvent}.
 *
 * @param register - Registers webhook handlers (`emit`, `error`, `complete`) and optionally returns cleanup.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — webhook payloads as `DATA`; teardown runs returned cleanup.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { fromWebhook } from "@graphrefly/graphrefly-ts";
 *
 * type HookPayload = { event: string; data: unknown };
 * const app = express();
 * app.use(express.json());
 *
 * const hook$ = fromWebhook<HookPayload>(({ emit, error }) => {
 *   const handler = (req: express.Request, res: express.Response) => {
 *     try {
 *       emit(req.body as HookPayload);
 *       res.status(200).send("ok");
 *     } catch (e) {
 *       error(e);
 *       res.status(500).send("error");
 *     }
 *   };
 *   app.post("/webhook", handler);
 *   return () => {
 *     // Express has no direct route-removal API in common use.
 *   };
 * });
 * ```
 *
 * @example Fastify
 * ```ts
 * import Fastify from "fastify";
 * import { fromWebhook } from "@graphrefly/graphrefly-ts";
 *
 * const fastify = Fastify();
 * const hook$ = fromWebhook<any>(({ emit, error }) => {
 *   const handler = async (req: any, reply: any) => {
 *     try {
 *       emit(req.body);
 *       reply.code(200).send({ ok: true });
 *     } catch (e) {
 *       error(e);
 *       reply.code(500).send({ ok: false });
 *     }
 *   };
 *   fastify.post("/webhook", handler);
 *   return () => {};
 * });
 * ```
 *
 * @category extra
 */
export function fromWebhook<T = unknown>(register: WebhookRegister<T>, opts?: ExtraOpts): Node<T> {
	return externalProducer<T>(register, opts);
}
