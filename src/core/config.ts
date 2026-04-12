/**
 * Singleton protocol config. Holds the message-type registry, the default
 * `bundle` / `onMessage` / `onSubscribe` hooks, and the freeze flag.
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
 * A config **freezes on first getter read** of any hook (`bundle`,
 * `onMessage`, `onSubscribe`). `NodeImpl`'s constructor intentionally touches
 * one of these on first use so configuration cannot drift once nodes exist.
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
	 * Sugar: framed value delivery. Runs `equals` (current cache vs
	 * `value`) to decide DATA vs RESOLVED, frames the outgoing message
	 * through the singleton `bundle` (tier sort + DIRTY auto-prefix), then
	 * delivers via the raw emit pipeline. Diamond-safe by construction.
	 */
	emit(value: unknown): void;
	/**
	 * Raw downstream passthrough — `messages` are delivered as-is through
	 * the emit pipeline. **No framing.** Developer controls exactly what
	 * goes on the wire; use `actions.bundle(...).resolve()` to build a
	 * framed payload when you need tier sorting or DIRTY auto-prefix.
	 */
	down(messages: Messages): void;
	/**
	 * Raw upstream passthrough — forwards `messages` to every dep without
	 * modifying any local state.
	 */
	up(messages: Messages): void;
	/**
	 * Create a {@link Bundle} that captures this node's context. Accepts a
	 * single {@link Message} tuple or a {@link Messages} array as the
	 * starting payload; append more via `bundle.append(...)` and call
	 * `bundle.resolve()` to obtain a framed (tier-sorted, DIRTY-prefixed)
	 * `Messages` array ready for `actions.down(...)`.
	 */
	bundle(initial: Message | Messages): Bundle;
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
 * Outgoing-message framing primitive. See COMPOSITION-GUIDE §9 for tier
 * ordering and DIRTY auto-prefix semantics.
 */
export interface Bundle {
	append(...messages: Message[]): Bundle;
	/** Resolve to a flat tier-sorted `Messages` array. Pure — does not mutate. */
	resolve(direction?: "down" | "up"): Messages;
}

/**
 * Factory invoked by core emission paths to frame an outgoing payload. Takes
 * the starting messages as a single `Messages` array (not variadic) so
 * internal callers can pass an already-collected array without spreading.
 * The user-facing variadic/flexible form lives on `actions.bundle`.
 */
export type BundleFactory = (node: NodeCtx, initial: Messages) => Bundle;

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
) => "consume" | void;

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
) => (() => void) | void;

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
	private _bundle: BundleFactory;
	private _onMessage: OnMessageHandler;
	private _onSubscribe: OnSubscribeHandler;
	private _frozen = false;

	constructor(init: {
		bundle: BundleFactory;
		onMessage: OnMessageHandler;
		onSubscribe: OnSubscribeHandler;
	}) {
		this._bundle = init.bundle;
		this._onMessage = init.onMessage;
		this._onSubscribe = init.onSubscribe;
	}

	// --- Hook getters (freeze on read) ---

	get bundle(): BundleFactory {
		this._frozen = true;
		return this._bundle;
	}

	get onMessage(): OnMessageHandler {
		this._frozen = true;
		return this._onMessage;
	}

	get onSubscribe(): OnSubscribeHandler {
		this._frozen = true;
		return this._onSubscribe;
	}

	// --- Hook setters (throw when frozen) ---

	set bundle(v: BundleFactory) {
		this._assertUnfrozen();
		this._bundle = v;
	}

	set onMessage(v: OnMessageHandler) {
		this._assertUnfrozen();
		this._onMessage = v;
	}

	set onSubscribe(v: OnSubscribeHandler) {
		this._assertUnfrozen();
		this._onSubscribe = v;
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
	cfg.registerMessageType(INVALIDATE, { tier: 1, wireCrossing: false });
	cfg.registerMessageType(PAUSE, { tier: 2, wireCrossing: false });
	cfg.registerMessageType(RESUME, { tier: 2, wireCrossing: false });
	cfg.registerMessageType(DATA, { tier: 3, wireCrossing: true });
	cfg.registerMessageType(RESOLVED, { tier: 3, wireCrossing: true });
	cfg.registerMessageType(COMPLETE, { tier: 4, wireCrossing: true });
	cfg.registerMessageType(ERROR, { tier: 4, wireCrossing: true });
	cfg.registerMessageType(TEARDOWN, { tier: 5, wireCrossing: true });
}
