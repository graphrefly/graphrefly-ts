import { factoryTag } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput, switchMap } from "@graphrefly/pure-ts/extra";

// ---------------------------------------------------------------------------
// handoff — multi-agent routing sugar (B10)
// ---------------------------------------------------------------------------

/**
 * Options for {@link handoff}.
 */
export type HandoffOptions = {
	/**
	 * Reactive gate: when this node's value is `true`, output flows from
	 * `from` to the `to` specialist; when `false`, `from`'s output flows
	 * through unchanged and `to` stays dormant. Omit to always hand off —
	 * useful when `from` is itself a router whose output shape already
	 * encodes routing intent.
	 */
	condition?: NodeInput<boolean>;
	name?: string;
};

/**
 * Multi-agent handoff recipe — route `from`'s output into a specialist
 * agent `toFactory` when `condition` is open. Thin composition over
 * `switchMap` + gate; not a new primitive, just a named shape.
 *
 * The "handoff" pattern (popularized by the OpenAI Agents SDK) covers two
 * idioms:
 *
 * 1. **Full handoff** — a triage agent routes the conversation to a
 *    specialist, and the specialist becomes the active agent for the rest
 *    of the turn. Accumulated context (memory, tool definitions) can travel
 *    along by threading the same `agentMemory` bundle into both.
 * 2. **Agents-as-tools** — the manager keeps control and calls the
 *    specialist like a tool for a bounded subtask. Build this by registering
 *    a `promptNode` instance as a `ToolDefinition` on the parent via
 *    `toolRegistry`.
 *
 * This sugar covers (1) — a reactive route from one agent's output into a
 * specialist factory. For (2) wire a tool registry manually; the pattern is
 * additive with this one.
 *
 * @example Full handoff on a triage signal.
 * ```ts
 * import { handoff, promptNode } from "@graphrefly/graphrefly/patterns/ai";
 *
 * const triage = promptNode(adapter, [userMessage], (msg) =>
 *   `Classify urgency of: ${msg}. Reply "high" or "normal".`);
 * const isUrgent = derived([triage], ([v]) => v === "high");
 *
 * const specialist = handoff(
 *   userMessage,
 *   (input) => promptNode(specialistAdapter, [input], (m) => `Respond urgently: ${m}`),
 *   { condition: isUrgent },
 * );
 * ```
 *
 * @param from - Source node whose value is threaded into the specialist.
 * @param toFactory - Factory that takes `from` (as a reactive source) and
 *   returns the specialist node. Called once, lazily, when the first
 *   subscriber activates.
 * @param opts - Optional reactive `condition` gate + name.
 * @returns Node emitting the specialist's output when the gate is open, or
 *   `from`'s value when the gate is closed. Null when `from` is null.
 *
 * **Performance caveat (Wave A Unit 5):** the specialist is mounted per
 * source emission — each `v != null` DATA on `from` allocates a fresh
 * `state<T>(v)` + invokes `toFactory`, and switchMap cancels the prior
 * branch. For per-turn routing (≤1 emit/sec) this is negligible. For
 * high-frequency sources (per-token routing, tight event loops), batch
 * upstream (e.g. via `audit`, `throttle`, or `distinctUntilChanged`) before
 * handing off — each mount/unmount cycle spins up full subgraphs
 * (`messagesNode` + adapter bridge + output for a `promptNode` specialist).
 *
 * @category patterns.ai
 */
export function handoff<T>(
	from: NodeInput<T | null>,
	toFactory: (input: Node<T>) => Node<T | null>,
	opts?: HandoffOptions,
): Node<T | null> {
	const src = fromAny(from);
	const cond = opts?.condition != null ? fromAny(opts.condition) : null;

	// Shared `null` state — reused across null source emissions so repeated
	// nulls don't allocate a fresh node per switchMap project call.
	const nullState: Node<T | null> = node<T | null>([], {
		initial: null,
		name: opts?.name ? `${opts.name}::null` : "handoff::null",
	});

	// When no condition is supplied, always route through the specialist.
	if (cond == null) {
		return switchMap<T | null, T | null>(
			src,
			(v) => {
				if (v == null) return nullState as NodeInput<T | null>;
				const input = node<T>([], { initial: v });
				return toFactory(input) as NodeInput<T | null>;
			},
			{ meta: factoryTag("handoff") },
		);
	}

	// With a condition: pair src + cond into a router object, then switchMap
	// to either the specialist (when open) or a pass-through state (when
	// closed). Each router emission may re-instantiate the specialist — the
	// switchMap cancels the stale branch.
	const router = node<{ v: T | null; open: boolean }>(
		[src, cond],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit({ v: data[0] as T | null, open: data[1] === true });
		},
		{ name: opts?.name ? `${opts.name}::router` : "handoff::router", describeKind: "derived" },
	);
	return switchMap<{ v: T | null; open: boolean }, T | null>(
		router,
		({ v, open }) => {
			if (v == null) return nullState as NodeInput<T | null>;
			if (!open) return node<T | null>([], { initial: v }) as NodeInput<T | null>;
			const input = node<T>([], { initial: v });
			return toFactory(input) as NodeInput<T | null>;
		},
		{ meta: factoryTag("handoff") },
	);
}
