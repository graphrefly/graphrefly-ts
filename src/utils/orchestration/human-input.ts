/**
 * Phase 13.F — `humanInput<T>` sibling preset.
 *
 * Source: `archive/docs/SESSION-human-llm-intervention-primitives.md` §5
 * "Sibling presets on the substrate" + §9 Phase 2.
 *
 * **Role.** LLM↔human runtime Q&A channel. The agent (or any consumer)
 * reactively asks for human input by emitting a prompt; humanInput
 * publishes a {@link Message} envelope to the well-known
 * {@link PROMPTS_TOPIC} on the hub and watches {@link RESPONSES_TOPIC} for
 * the matching `correlationId`. When the response arrives, humanInput's
 * output Node emits the typed payload `T`.
 *
 * **Sibling to `approvalGate`** ([pipeline-graph.ts](pipeline-graph.ts)):
 * approvalGate is design-time veto on a topology edge; humanInput is a
 * runtime Q&A channel. They share substrate (hub + envelope) but differ
 * in role and initiator.
 *
 * **No imperative `.run()` / `.ask()`** — caller writes to `prompt` (any
 * `NodeInput<string>`) and reads `humanInput()`'s output Node.
 *
 * **Multi-prompt.** Each new `prompt` DATA mints a fresh correlationId
 * and a new pending request. The output Node's emission tracks the latest
 * correlationId — earlier in-flight requests are abandoned (switchMap
 * semantics). To run parallel requests, instantiate two humanInput nodes.
 */

import { wallClockNs } from "@graphrefly/pure-ts/core";
import { COMPLETE, DATA } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import {
	type JsonSchema,
	type TopicMessage,
	type MessagingHubGraph,
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
} from "../messaging/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outbound prompt envelope payload. */
export interface HumanPromptPayload {
	readonly prompt: string;
	readonly schema?: JsonSchema;
}

/**
 * Options for {@link humanInput}.
 */
export interface HumanInputOpts {
	/**
	 * Messaging hub. {@link PROMPTS_TOPIC} is created lazily for outbound
	 * prompts; {@link RESPONSES_TOPIC} is read for incoming responses.
	 */
	readonly hub: MessagingHubGraph;
	/**
	 * Reactive prompt source. Any `NodeInput<string>` is accepted (Node,
	 * Promise, AsyncIterable, scalar) — coerced via `fromAny`. Each new
	 * DATA on this input mints a fresh request.
	 */
	readonly prompt: NodeInput<string>;
	/**
	 * Optional response-shape schema. Carried in the prompt envelope for
	 * UI / consumer-side validation. Caller-supplied validators (ajv,
	 * zod, valibot) consume this field; the substrate doesn't validate.
	 */
	readonly schema?: JsonSchema;
	/**
	 * Optional ID generator for the per-prompt correlationId. Default is
	 * a monotonic counter derived from a tight closure (sufficient for
	 * in-process correlation; cross-process consumers should supply UUID
	 * / ULID generation).
	 */
	readonly idGenerator?: () => string;
}

// ---------------------------------------------------------------------------
// humanInput
// ---------------------------------------------------------------------------

/**
 * Constructs a reactive human-input request channel. Each DATA on
 * `prompt` mints a fresh request:
 *
 * 1. Mints a fresh `correlationId` (via `opts.idGenerator` if provided).
 * 2. Publishes `TopicMessage<HumanPromptPayload>` to {@link PROMPTS_TOPIC}
 *    (`{ id, schema?, correlationId, payload: { prompt, schema? } }`).
 * 3. Watches {@link RESPONSES_TOPIC} for an envelope whose
 *    `correlationId` matches.
 * 4. When matched, emits the response payload as the output Node's DATA.
 *
 * **Switchmap semantics.** A new prompt arriving before the prior
 * response abandons the prior wait. Output Node emits the response for
 * the latest in-flight request only.
 *
 * **Output type `T`** is the response payload type. Caller is responsible
 * for ensuring the response producer (UI / human-side) sends the right
 * shape — `schema` is the wire-level convention for validation.
 *
 * @example
 * ```ts
 * import {
 *   humanInput,
 *   messagingHub,
 *   PROMPTS_TOPIC,
 *   RESPONSES_TOPIC,
 * } from "@graphrefly/graphrefly-ts";
 *
 * const hub = messagingHub("hub");
 * const promptN = state<string>("prompt");
 * const reply = humanInput<{ ok: boolean; reason: string }>({
 *   hub,
 *   prompt: promptN,
 *   schema: { type: "object", required: ["ok", "reason"] },
 * });
 *
 * // UI / human side: subscribe to PROMPTS_TOPIC, present, then publish to
 * // RESPONSES_TOPIC with the matching correlationId.
 * promptN.emit("Approve change?");
 * const decision = await awaitSettled(reply);  // resolves when human responds
 * ```
 *
 * @category patterns
 */
export function humanInput<T>(opts: HumanInputOpts): Node<T> {
	const { hub, prompt, schema, idGenerator } = opts;
	const promptNode = fromAny<string>(prompt);
	const promptsTopic = hub.topic<TopicMessage<HumanPromptPayload>>(PROMPTS_TOPIC);
	const responsesTopic = hub.topic<TopicMessage<T>>(RESPONSES_TOPIC);

	const nextId = idGenerator ?? defaultIdGenerator();

	return node<T>(
		(_data, a) => {
			let activeCorrelationId: string | undefined;
			let respUnsub: (() => void) | undefined;

			const promptUnsub = promptNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === COMPLETE) {
						respUnsub?.();
						respUnsub = undefined;
						a.down([[COMPLETE]]);
						return;
					}
					if (m[0] !== DATA) continue;
					const promptStr = m[1] as string;
					// Switch-map semantics: drop the prior in-flight watcher.
					respUnsub?.();
					respUnsub = undefined;
					// Mint new correlationId.
					const correlationId = nextId();
					activeCorrelationId = correlationId;

					// Snapshot the responses topic length BEFORE publishing so
					// we only consider envelopes that arrive AFTER this
					// subscription. Eliminates the stale-replay-on-subscribe
					// hazard (push-on-subscribe of `events` delivers the full
					// retained log, which could include an unrelated old
					// envelope whose `correlationId` happens to match if the
					// caller's id-generator is non-unique).
					const responseCursorAtSubscribe =
						(responsesTopic.events.cache as readonly TopicMessage<T>[] | undefined)?.length ?? 0;

					// Publish the prompt envelope. Schema is carried at
					// envelope-level only (Phase 13.B TopicMessage<T> contract);
					// the payload itself is `HumanPromptPayload` and stays
					// schema-free.
					const envelope: TopicMessage<HumanPromptPayload> = {
						id: correlationId,
						correlationId,
						payload: { prompt: promptStr },
						...(schema != null && { schema }),
					};
					promptsTopic.publish(envelope);

					// Watch responses topic for matching correlationId, but
					// skip the retained log (only consider envelopes at index
					// >= responseCursorAtSubscribe).
					respUnsub = responsesTopic.events.subscribe((rspMsgs) => {
						for (const rm of rspMsgs) {
							if (rm[0] !== DATA) continue;
							const arr = rm[1] as readonly TopicMessage<T>[];
							for (let i = responseCursorAtSubscribe; i < arr.length; i++) {
								const env = arr[i] as TopicMessage<T>;
								if (env.correlationId === activeCorrelationId) {
									a.emit(env.payload);
									// One-shot per prompt — next prompt re-arms the watcher.
									respUnsub?.();
									respUnsub = undefined;
									return;
								}
							}
						}
					});
				}
			});

			return () => {
				promptUnsub();
				respUnsub?.();
			};
		},
		{
			describeKind: "derived",
			name: "humanInput",
			// Each new prompt may produce a structurally-equal response (e.g.
			// from a deterministic UI mock) — disable framework dedup so
			// repeat emissions propagate. Same precedent as `agent.out`.
			equals: () => false,
		},
	);
}

// ---------------------------------------------------------------------------
// Default ID generator
// ---------------------------------------------------------------------------

function defaultIdGenerator(): () => string {
	let n = 0;
	// `wallClockNs()` routes through the central clock per CLAUDE.md "Time
	// utility rule" — testing harnesses that monkey-patch the clock can pin
	// id generation deterministically.
	const base = wallClockNs().toString(36);
	return () => {
		n += 1;
		return `humanInput-${base}-${n.toString(36)}`;
	};
}
