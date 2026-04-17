/**
 * Singleton protocol config. Holds the message-type registry, the
 * `onMessage` / `onSubscribe` hooks, versioning defaults, and the freeze flag.
 *
 * Layering: this file is protocol-pure. It imports only from `messages.ts`
 * and declares opaque type shapes for handlers — the concrete default
 * implementations and the `defaultConfig` instance live in `node.ts` so that
 * handler bodies can touch `NodeImpl` internals without creating a cycle.
 *
 * Two access paths:
 * 1. **Default instance** (`defaultConfig` in `node.ts`) — use
 *    `configure((cfg) => ...)` at app startup; every node implicitly binds to it.
 * 2. **Isolated instance** (`new GraphReFlyConfig(...)`) — pass via
 *    `opts.config` for test isolation or custom protocol stacks.
 *
 * A config **freezes on first getter read** of any hook (`onMessage`,
 * `onSubscribe`). `NodeImpl`'s constructor intentionally touches one of these
 * on first use so configuration cannot drift once nodes exist.
 */

import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Message,
	type Messages,
	type MessageTypeRegistration,
	type MessageTypeRegistrationInput,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
	TEARDOWN,
} from "./messages.js";
import type { HashFn, VersioningLevel } from "./versioning.js";

// ---------------------------------------------------------------------------
// Handler type shapes
// ---------------------------------------------------------------------------

/**
 * Minimal node surface visible to default handlers. Concrete `NodeImpl`
 * implements this plus a large set of package-private fields; handlers that
 * need the richer surface cast to the concrete type in `node.ts`.
 */
export interface NodeCtx {
	readonly name?: string;
	readonly status: string;
	readonly cache: unknown;
}

/** Imperative actions available inside a node's compute function (§5). */
export interface NodeActions {
	/**
	 * Sugar for `down([[DATA, value]])`. One call = one wave with a
	 * single DATA payload. The emit pipeline auto-prefixes `[DIRTY]`,
	 * runs equals substitution against the live cache, and dispatches
	 * to sinks with phase deferral. Diamond-safe by construction.
	 */
	emit(value: unknown): void;
	/**
	 * Send one or more messages downstream. Accepts either a single
	 * {@link Message} tuple or a {@link Messages} array of tuples. One
	 * call = one wave: the emit pipeline tier-sorts the input,
	 * auto-prefixes `[DIRTY]` when a tier-3 payload is present and the
	 * node isn't already dirty, runs equals substitution, then
	 * dispatches. Multiple calls produce multiple waves.
	 */
	down(messageOrMessages: Message | Messages): void;
	/**
	 * Send one or more messages upstream. Accepts the same shapes as
	 * {@link down}. Tier 3 (DATA/RESOLVED) and tier 4 (COMPLETE/ERROR)
	 * are downstream-only and will throw — up is for DIRTY, INVALIDATE,
	 * PAUSE, RESUME, and TEARDOWN only. No cache advance, no equals,
	 * no framing — a plain forward to every dep.
	 */
	up(messageOrMessages: Message | Messages): void;
}

/**
 * Message-flow context passed to {@link OnMessageHandler}.
 *
 * - `"down-in"` — message arriving from a dep (identified by `depIndex`).
 * - `"up-in"` — message arriving from a sink.
 */
export type MessageContext = { direction: "down-in"; depIndex: number } | { direction: "up-in" };

/**
 * Per-sink context passed to {@link OnSubscribeHandler}.
 */
export interface SubscribeContext {
	/** Post-subscribe sink count. `1` means first subscriber after 0. */
	sinkCount: number;
	/** True when this subscribe cleared a resubscribable terminal state. */
	afterTerminalReset: boolean;
}

/**
 * Singleton message interceptor. Called for every message in either direction
 * before the default per-tier dispatch runs. Return `"consume"` to suppress
 * default handling.
 */
export type OnMessageHandler = (
	node: NodeCtx,
	msg: Message,
	ctx: MessageContext,
	actions: NodeActions,
) => "consume" | undefined;

/**
 * Singleton subscribe ceremony. Fires for every sink subscribe on every node.
 * Default implementation emits the START handshake (+ cached DATA when
 * present) to the new sink. Return a cleanup function to run on unsubscribe.
 */
export type OnSubscribeHandler = (
	node: NodeCtx,
	sink: (messages: Messages) => void,
	ctx: SubscribeContext,
	actions: NodeActions,
) => (() => void) | undefined;

// ---------------------------------------------------------------------------
// GraphReFlyConfig
// ---------------------------------------------------------------------------

/**
 * Singleton protocol config.
 *
 * A config freezes on first getter read of any hook. After freeze, any
 * attempt to mutate (register a message type, set a hook) throws.
 */
export class GraphReFlyConfig {
	private _messageTypes = new Map<symbol, MessageTypeRegistration>();
	private _onMessage: OnMessageHandler;
	private _onSubscribe: OnSubscribeHandler;
	private _defaultVersioning: VersioningLevel | undefined;
	private _defaultHashFn: HashFn | undefined;
	private _inspectorEnabled: boolean = !(
		typeof process !== "undefined" && process.env?.NODE_ENV === "production"
	);
	private _frozen = false;

	/**
	 * Pre-bound tier lookup — shared by every node bound to this config. Since
	 * the registry is frozen on first hook access, this closure can be built
	 * once in the constructor and handed directly to `downWithBatch` /
	 * `_frameBatch` paths without per-node or per-emission `.bind(config)`
	 * allocation.
	 */
	readonly tierOf: (t: symbol) => number;

	constructor(init: {
		onMessage: OnMessageHandler;
		onSubscribe: OnSubscribeHandler;
		defaultVersioning?: VersioningLevel;
		defaultHashFn?: HashFn;
	}) {
		this._onMessage = init.onMessage;
		this._onSubscribe = init.onSubscribe;
		this._defaultVersioning = init.defaultVersioning;
		this._defaultHashFn = init.defaultHashFn;
		// Captured once. Calls back into `this._messageTypes` — still returns
		// the current registration, but post-freeze the registry is immutable
		// so the closure is effectively constant.
		this.tierOf = (t: symbol): number => {
			const reg = this._messageTypes.get(t);
			return reg != null ? reg.tier : 1;
		};
	}

	// --- Hook getters (freeze on read) ---

	get onMessage(): OnMessageHandler {
		this._frozen = true;
		return this._onMessage;
	}

	get onSubscribe(): OnSubscribeHandler {
		this._frozen = true;
		return this._onSubscribe;
	}

	// --- Hook setters (throw when frozen) ---

	set onMessage(v: OnMessageHandler) {
		this._assertUnfrozen();
		this._onMessage = v;
	}

	set onSubscribe(v: OnSubscribeHandler) {
		this._assertUnfrozen();
		this._onSubscribe = v;
	}

	/**
	 * Default versioning level applied to every node bound to this config,
	 * unless the node's own `opts.versioning` provides an explicit override.
	 * Setting this is only allowed before the config freezes (i.e., before
	 * the first node is created) so every node in the graph sees a
	 * consistent starting level. Individual nodes can still opt into a
	 * higher level via `opts.versioning`, or post-hoc via
	 * `NodeImpl._applyVersioning(level)` when the node is quiescent.
	 *
	 * v0 is the minimum opt-in — unversioned nodes (`undefined`) skip
	 * the version counter entirely. v1 adds content-addressed cid.
	 * Future levels (v2, v3) are reserved for linked-history and
	 * cryptographic attestation extensions.
	 */
	get defaultVersioning(): VersioningLevel | undefined {
		return this._defaultVersioning;
	}
	set defaultVersioning(v: VersioningLevel | undefined) {
		this._assertUnfrozen();
		this._defaultVersioning = v;
	}

	/**
	 * Default content-hash function applied to every versioned node bound
	 * to this config, unless the node's own `opts.versioningHash` provides
	 * an explicit override. Use this when a graph needs a non-default hash
	 * — e.g., swap the vendored sync SHA-256 for a faster non-crypto hash
	 * (xxHash, FNV-1a) in hot-path workloads, or a stronger hash when
	 * versioning v1 cids are used as audit anchors.
	 *
	 * Only settable before the config freezes. Individual nodes can still
	 * override via `opts.versioningHash`.
	 */
	get defaultHashFn(): HashFn | undefined {
		return this._defaultHashFn;
	}
	set defaultHashFn(v: HashFn | undefined) {
		this._assertUnfrozen();
		this._defaultHashFn = v;
	}

	/**
	 * When `false`, structured observation options (`causal`, `timeline`)
	 * and `Graph.trace()` writes are no-ops. Raw `Graph.observe()` always
	 * works. Default: `true` outside production (`NODE_ENV !== "production"`).
	 *
	 * Settable at any time — inspector gating is an operational concern, not
	 * a protocol invariant, so it does NOT require freeze before node creation.
	 */
	get inspectorEnabled(): boolean {
		return this._inspectorEnabled;
	}
	set inspectorEnabled(v: boolean) {
		this._inspectorEnabled = v;
	}

	// --- Registry (writes require unfrozen; reads are free lookups) ---

	/**
	 * Register a custom message type. Must be called before any node that
	 * uses this config has been created — otherwise throws. Default
	 * `wireCrossing` is `tier >= 3`.
	 */
	registerMessageType(t: symbol, input: MessageTypeRegistrationInput): this {
		this._assertUnfrozen();
		this._messageTypes.set(t, {
			tier: input.tier,
			wireCrossing: input.wireCrossing ?? input.tier >= 3,
			metaPassthrough: input.metaPassthrough ?? true,
		});
		return this;
	}

	/** Tier for `t`. Unknown types default to tier 1 (immediate, after START). */
	messageTier(t: symbol): number {
		const reg = this._messageTypes.get(t);
		return reg != null ? reg.tier : 1;
	}

	/**
	 * Whether `t` is registered as wire-crossing. Unknown types default to
	 * `true` (spec §1.3.6 forward-compat — unknowns cross the wire).
	 */
	isWireCrossing(t: symbol): boolean {
		const reg = this._messageTypes.get(t);
		return reg != null ? reg.wireCrossing : true;
	}

	/** Convenience inverse of {@link isWireCrossing}. */
	isLocalOnly(t: symbol): boolean {
		return !this.isWireCrossing(t);
	}

	/**
	 * Whether `t` is forwarded to meta companions by `Graph.signal`. Defaults
	 * to `true` for unknowns (forward-compat — new types pass through meta by
	 * default; opt-in filter via `registerMessageType({metaPassthrough: false})`).
	 */
	isMetaPassthrough(t: symbol): boolean {
		const reg = this._messageTypes.get(t);
		return reg != null ? reg.metaPassthrough : true;
	}

	/** Whether `t` is a registered (built-in or custom) type. */
	isKnownMessageType(t: symbol): boolean {
		return this._messageTypes.has(t);
	}

	/** @internal Used by tests and dev tooling — check freeze state without triggering it. */
	_isFrozen(): boolean {
		return this._frozen;
	}

	private _assertUnfrozen(): void {
		if (this._frozen) {
			throw new Error(
				"GraphReFlyConfig is frozen: a node has already captured this config. " +
					"Register custom types and set hooks before creating any node.",
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Built-in registration
// ---------------------------------------------------------------------------

/**
 * Register the 10 built-in message types on a fresh config. Called by
 * `node.ts` when it constructs `defaultConfig` and by test code / advanced
 * users after `new GraphReFlyConfig(...)`.
 */
export function registerBuiltins(cfg: GraphReFlyConfig): void {
	cfg.registerMessageType(START, { tier: 0, wireCrossing: false });
	cfg.registerMessageType(DIRTY, { tier: 1, wireCrossing: false });
	// INVALIDATE, COMPLETE, ERROR, TEARDOWN do NOT pass through to meta
	// companions via Graph.signal (spec §2.3). Meta still sees them via the
	// primary's own down-cascade.
	cfg.registerMessageType(INVALIDATE, {
		tier: 1,
		wireCrossing: false,
		metaPassthrough: false,
	});
	cfg.registerMessageType(PAUSE, { tier: 2, wireCrossing: false });
	cfg.registerMessageType(RESUME, { tier: 2, wireCrossing: false });
	cfg.registerMessageType(DATA, { tier: 3, wireCrossing: true });
	cfg.registerMessageType(RESOLVED, { tier: 3, wireCrossing: true });
	cfg.registerMessageType(COMPLETE, {
		tier: 4,
		wireCrossing: true,
		metaPassthrough: false,
	});
	cfg.registerMessageType(ERROR, {
		tier: 4,
		wireCrossing: true,
		metaPassthrough: false,
	});
	cfg.registerMessageType(TEARDOWN, {
		tier: 5,
		wireCrossing: true,
		metaPassthrough: false,
	});
}
