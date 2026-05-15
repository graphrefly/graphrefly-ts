/**
 * Standard `TopicMessage<T>` envelope for hub topics + well-known topic name
 * constants (Phase 13.B; spec source: archive/docs/SESSION-human-llm-intervention-primitives.md
 * §6 + archive/docs/SESSION-multi-agent-gap-analysis.md §6 cross-cut).
 *
 * `TopicMessage<T>` is the **recommended** wrapper for cross-agent / cross-graph
 * topic payloads — it carries identity, schema, deadline, and correlation
 * metadata alongside the typed `payload`. It is NOT a required protocol
 * type; raw `topic<T>` continues to work for in-process payloads where the
 * envelope fields would be noise.
 *
 * Use the envelope when:
 * - Two or more graphs (or human + LLM consumers) communicate over a topic
 *   and need a stable wire shape — `correlationId` is the join key, `schema`
 *   gates payload validation, `expiresAt` enables TTL enforcement.
 * - A topic carries multiple payload kinds and consumers need to discriminate
 *   without parsing structurally.
 *
 * The standard well-known topic constants below are **conventions** — string
 * literals callers can pass to `messagingHub().topic(NAME)` to get a
 * predictable lookup. The hub does not enforce any topic to actually exist;
 * topics are still lazy on first access.
 */

// ---------------------------------------------------------------------------
// JSON Schema — minimal local type
// ---------------------------------------------------------------------------

/**
 * Minimal JSON Schema shape, scoped to what `TopicMessage<T>` validates against.
 * Locked DS-13.B (2026-04-30): zero-dep posture, structural shape only — no
 * full validator shipped. Callers that want full validation supply their own
 * (e.g. `ajv`, `zod`, `valibot`) and read `Message.schema` as the rule
 * source. The shape covers the JSON-Schema-7 subset that hub-topic payload
 * descriptions actually need:
 * - `type` / `properties` / `required` / `additionalProperties` for objects.
 * - `items` for arrays.
 * - `enum` / `const` for value constraints.
 * - `$ref` / `definitions` for shared sub-schemas.
 *
 * If a concrete consumer needs a richer shape (oneOf, allOf, format, etc.),
 * extend this type — it's a structural contract, not a tagged union, so
 * additive fields don't break existing producers.
 */
export interface JsonSchema {
	readonly type?:
		| "string"
		| "number"
		| "integer"
		| "boolean"
		| "object"
		| "array"
		| "null"
		| readonly ("string" | "number" | "integer" | "boolean" | "object" | "array" | "null")[];
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean | JsonSchema;
	readonly items?: JsonSchema | readonly JsonSchema[];
	readonly enum?: readonly unknown[];
	readonly const?: unknown;
	readonly $ref?: string;
	readonly definitions?: Readonly<Record<string, JsonSchema>>;
	readonly description?: string;
	readonly title?: string;
}

// ---------------------------------------------------------------------------
// TopicMessage<T> envelope
// ---------------------------------------------------------------------------

/**
 * Recommended envelope for hub topic payloads. Carries identity, optional
 * schema reference, optional expiry, optional correlation, and the typed
 * payload itself.
 *
 * - `id` — globally-unique identifier for this message instance. Producers
 *   mint it (UUID, ULID, hash, etc.); consumers use it for deduplication and
 *   trace correlation. **Required.**
 * - `schema` — optional structural description of `payload`. Validators
 *   (caller-supplied) read this to gate or shape consumption. Writers MAY
 *   include the schema inline for self-describing topics, or omit when the
 *   payload type is statically known to all consumers.
 * - `expiresAt` — ISO 8601 timestamp; consumers SHOULD drop / fallback past
 *   this point. Substrate enforcement is via composition (`timeout(source,
 *   ms)` + `fallback`), not a hub-level rule.
 * - `correlationId` — links related messages across topics (request /
 *   response pairs, conversation threads, multi-agent handoffs). Producers
 *   propagate it; consumers filter / group on it.
 * - `payload` — the typed body. Type parameter `T` is the consumer-agreed
 *   shape; the envelope adds metadata around it without coupling consumers
 *   to a concrete payload type.
 *
 * Reactive composition with the envelope:
 *
 * ```ts
 * const requests = hub.topic<TopicMessage<RequestBody>>(PROMPTS_TOPIC);
 * const responses = hub.topic<TopicMessage<ResponseBody>>(RESPONSES_TOPIC);
 *
 * // Filter responses to one correlation
 * const myResponse = derived([responses.latest], ([msg]) =>
 *   msg?.correlationId === requestId ? [msg.payload] : [],
 * );
 * ```
 */
export interface TopicMessage<T> {
	readonly id: string;
	readonly schema?: JsonSchema;
	readonly expiresAt?: string;
	readonly correlationId?: string;
	readonly payload: T;
}

// ---------------------------------------------------------------------------
// Standard topic name constants
// ---------------------------------------------------------------------------

/**
 * Well-known topic name for human / LLM prompts directed at the harness.
 * Example payload: `TopicMessage<{ prompt: string; context?: object }>`.
 *
 * Co-locked with {@link RESPONSES_TOPIC} per the human-LLM intervention
 * session §6 #4 (paired request / response convention).
 */
export const PROMPTS_TOPIC = "prompts";

/**
 * Well-known topic name for responses to {@link PROMPTS_TOPIC} entries.
 * Producers pair the response to its prompt via `correlationId`. Example
 * payload: `TopicMessage<{ content: string; finishReason?: string }>`.
 */
export const RESPONSES_TOPIC = "responses";

/**
 * Well-known topic name for out-of-band injections — runtime overrides /
 * hot-fixes / human nudges that bypass the normal request flow. Example
 * payload: `TopicMessage<{ kind: "context-patch" | "policy-override" | ...;
 * data: unknown }>`. Per-injection consumers decide how (and whether) to
 * apply.
 */
export const INJECTIONS_TOPIC = "injections";

/**
 * Well-known topic name for items the harness deferred for later attention
 * (parked queue, follow-up tracker, "I'll get back to this"). Producer is
 * usually the harness itself; consumer is a tracker / dashboard / human.
 * Example payload: `TopicMessage<{ reason: string; original: unknown }>`.
 */
export const DEFERRED_TOPIC = "deferred";

/**
 * Well-known topic name for spawn requests (Phase 13.I `spawnable()`
 * surface). Producer emits a `TopicMessage<SpawnRequest>` to request a child
 * agent / subgraph; consumer is the materializer that mints the slot.
 * Example payload: `TopicMessage<{ presetId: string; taskInput: unknown;
 * depth?: number }>`. `correlationId` links the spawn to its parent
 * conversation; `expiresAt` enforces TTL on long-lived requests.
 */
export const SPAWNS_TOPIC = "spawns";

/**
 * Tuple of all five well-known topic constants — useful for "register all
 * standard topics on a hub" patterns and for compile-time exhaustiveness
 * checks.
 */
export const STANDARD_TOPICS = [
	PROMPTS_TOPIC,
	RESPONSES_TOPIC,
	INJECTIONS_TOPIC,
	DEFERRED_TOPIC,
	SPAWNS_TOPIC,
] as const;

/**
 * Union of all five well-known topic name string literals.
 */
export type StandardTopic = (typeof STANDARD_TOPICS)[number];
