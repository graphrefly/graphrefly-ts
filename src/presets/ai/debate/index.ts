/**
 * DS-14.6.A U-C — `heterogeneousDebate()` (Phase 14.5).
 *
 * Stanford-MAD heterogeneity thesis (SESSION-DS-14.6-A L9): participants get
 * **different model adapters + different role prompts**. Closed reasoning
 * loop — no tools / side effects / persistent state beyond the transcript.
 *
 * **Reactive topology (QA M1→b, 2026-05-15).** The round loop is NOT a
 * top-level `async while` driver. It mirrors `refineLoop`'s §7 feedback
 * shape so `describe()` / `explain()` / dry-run see the structure:
 *
 * ```
 *   roundTrigger(state) ──▶ roundWork(switchMap→producer, per-round
 *                            sequential adapter.invoke) ──▶ transcript(scan)
 *                            └─▶ converged(derived)              │
 *        ▲                                                       │
 *        └────────────  decideEffect (feedback + trigger)  ◀─────┘
 * ```
 *
 * The per-round participant calls are an async **source boundary** inside
 * the switchMap producer (spec §5.10 — async belongs in sources), with an
 * abort-on-deactivate `AbortController` (COMPOSITION-GUIDE §45) so a
 * superseded / torn-down round cancels its in-flight LLM calls. `decideEffect`
 * is the sole feedback authority (computes termination inline from the round
 * envelope + closure history, §28); `converged` is a parallel derived purely
 * for external `status` observability. Termination: `fixedRounds |
 * "until-converge" | { until: Node<boolean> }` — `until` is a real reactive
 * dep, not a `.cache` poll. `"until-converge"` uses a pluggable `converge?`
 * fn, default = no participant changed stance across the last 2 rounds
 * (D-C1, zero extra LLM cost). `output:"synthesizer-final"` with no
 * synthesizer-role participant throws at construction (D-C2).
 *
 * @module
 */

import {
	batch,
	node as createNode,
	ERROR,
	INVALIDATE,
	type Node,
	RESOLVED,
} from "@graphrefly/pure-ts/core";
import { fromAny, switchMap } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { awaitSettled, firstValueFrom } from "../../../base/sources/settled.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	NodeInput,
} from "../../../utils/ai/adapters/core/types.js";

export interface Turn {
	readonly round: number;
	readonly role: string;
	readonly content: string;
}

export interface DebateParticipant {
	readonly adapter: LLMAdapter;
	/** e.g. "advocate" | "skeptic" | "synthesizer" | custom. */
	readonly role: string;
	readonly systemPrompt: string;
}

export type DebateTermination = number | "until-converge" | { readonly until: Node<boolean> };

export type DebateOutput =
	| "transcript"
	| "synthesizer-final"
	| { readonly project: (transcript: readonly Turn[]) => unknown };

export type DebateStatus = "running" | "converged" | "max-rounds" | "error";

export interface HeterogeneousDebateOptions {
	readonly question: string;
	readonly participants: readonly DebateParticipant[];
	/** Default `3`. */
	readonly rounds?: DebateTermination;
	/** Default `"transcript"`. */
	readonly output?: DebateOutput;
	/**
	 * D-C1 — `"until-converge"` detector. Default: no participant's latest
	 * content changed vs the previous round (structural compare, no LLM).
	 */
	readonly converge?: (transcript: readonly Turn[]) => boolean;
	readonly name?: string;
	/** Hard ceiling for `"until-converge"` / `{ until }` (default 12). */
	readonly maxRounds?: number;
}

export interface HeterogeneousDebateBundle {
	readonly transcript: Node<readonly Turn[]>;
	readonly result: Node<unknown>;
	readonly status: Node<DebateStatus>;
	readonly graph: DebateGraph;
	/**
	 * Thin `awaitSettled` bridge (mirrors `agentLoop.run()`): kicks the
	 * reactive round loop and resolves the final `result`. Throws
	 * `RangeError` if a prior `run()` is still pending (QA P4 re-entrancy).
	 */
	run(): Promise<unknown>;
}

export class DebateGraph extends Graph {}

const SYNTH_RE = /synth/i;

/** Default converge: every role's latest two rounds are identical. */
function defaultConverge(transcript: readonly Turn[]): boolean {
	const rounds = transcript.reduce((m, t) => Math.max(m, t.round), 0);
	if (rounds < 2) return false;
	const at = (r: number): Map<string, string> => {
		const m = new Map<string, string>();
		for (const t of transcript) if (t.round === r) m.set(t.role, t.content);
		return m;
	};
	const prev = at(rounds - 1);
	const cur = at(rounds);
	if (prev.size === 0 || prev.size !== cur.size) return false;
	for (const [role, content] of cur) if (prev.get(role) !== content) return false;
	return true;
}

/** Process-wide sequence for collision-safe default mount names (QA P6). */
let _debateSeq = 0;

interface RoundEnvelope {
	readonly round: number;
	readonly turns: readonly Turn[];
}

export function heterogeneousDebate(
	parent: Graph,
	opts: HeterogeneousDebateOptions,
): HeterogeneousDebateBundle {
	const output = opts.output ?? "transcript";
	if (output === "synthesizer-final" && !opts.participants.some((p) => SYNTH_RE.test(p.role))) {
		throw new Error(
			"heterogeneousDebate: output 'synthesizer-final' requires a participant whose role matches /synth/i (DS-14.6.A D-C2).",
		);
	}
	if (opts.participants.length === 0) {
		throw new Error("heterogeneousDebate: at least one participant is required");
	}

	const name = opts.name ?? `debate-${++_debateSeq}`;
	const graph = new DebateGraph(name);
	parent.mount(name, graph);

	const term = opts.rounds ?? 3;
	const maxRounds = opts.maxRounds ?? 12;
	const converge = opts.converge ?? defaultConverge;
	// `{ until }` becomes a real reactive dep (QA P10 — no `.cache` poll);
	// non-until modes use a constant-false node for stable dep arity.
	const untilNode: Node<boolean> =
		typeof term === "object" ? term.until : createNode<boolean>([], { initial: false });

	// --- state / output nodes -------------------------------------------------
	const roundTrigger = createNode<number>([], { name: `${name}.round`, initial: 0 });
	const statusState = createNode<DebateStatus>([], { name: `${name}.status`, initial: "running" });
	const resultState = createNode<unknown>([], { name: `${name}.result`, initial: undefined });

	// Closure history (§28 factory-time mirror) — the feedback authority's
	// view of the transcript without a declared dep cycle.
	let history: Turn[] = [];

	function buildMessages(p: DebateParticipant): ChatMessage[] {
		const msgs: ChatMessage[] = [
			{ role: "system", content: p.systemPrompt },
			{ role: "user", content: opts.question },
		];
		for (const t of history) {
			msgs.push({ role: "assistant", content: `[${t.role} r${t.round}] ${t.content}` });
		}
		return msgs;
	}

	// --- GENERATE: roundTrigger → per-round sequential participant calls -------
	// switchMap producer = async source boundary (spec §5.10). The producer's
	// deactivate cleanup aborts in-flight calls (COMPOSITION-GUIDE §45 + the
	// switchMap supersede path), so a torn-down round burns no extra tokens.
	const roundWork = switchMap<number, RoundEnvelope>(
		roundTrigger,
		(r) =>
			createNode<RoundEnvelope>(
				[],
				(_data, actions) => {
					if (r < 1) {
						actions.down([[RESOLVED]]);
						return undefined;
					}
					const ac = new AbortController();
					let cancelled = false;
					(async () => {
						const turns: Turn[] = [];
						try {
							for (const p of opts.participants) {
								const res = await firstValueFrom(
									fromAny<LLMResponse>(
										p.adapter.invoke(buildMessages(p), {
											signal: ac.signal,
										}) as NodeInput<LLMResponse>,
									),
								);
								if (cancelled) return;
								turns.push({ round: r, role: p.role, content: res.content });
							}
							if (!cancelled) actions.emit({ round: r, turns });
						} catch (err) {
							if (!cancelled) actions.down([[ERROR, err]]);
						}
					})();
					return () => {
						cancelled = true;
						ac.abort();
					};
				},
				{ describeKind: "producer", name: `${name}.round-work` },
			),
		{ name: `${name}.rounds` },
	);
	graph.add(roundWork, { name: "rounds" });

	// --- transcript: scan-accumulate (external observability) -----------------
	const transcript = createNode<readonly Turn[]>(
		[roundWork],
		(batchData, actions, ctx) => {
			const env = (
				batchData[0] != null && batchData[0].length > 0 ? batchData[0].at(-1) : ctx.prevData[0]
			) as RoundEnvelope | undefined;
			if (env === undefined) {
				actions.down([[RESOLVED]]);
				return;
			}
			actions.emit(history.slice());
		},
		{ name: `${name}.transcript`, describeKind: "derived" },
	);
	graph.add(transcript, { name: "transcript" });

	// --- converged: parallel derived for external `status` (NOT authority) ----
	const converged = createNode<{ done: boolean; reason: DebateStatus }>(
		[transcript as Node, untilNode as Node],
		(batchData, actions, ctx) => {
			const tr = (
				batchData[0] != null && batchData[0].length > 0 ? batchData[0].at(-1) : ctx.prevData[0]
			) as readonly Turn[] | undefined;
			const untilV = (
				batchData[1] != null && batchData[1].length > 0 ? batchData[1].at(-1) : ctx.prevData[1]
			) as boolean | undefined;
			const rounds = (tr ?? []).reduce((m, t) => Math.max(m, t.round), 0);
			if (typeof term === "number") {
				actions.emit({ done: rounds >= term, reason: "max-rounds" });
				return;
			}
			if (term === "until-converge") {
				if (converge(tr ?? [])) actions.emit({ done: true, reason: "converged" });
				else actions.emit({ done: rounds >= maxRounds, reason: "max-rounds" });
				return;
			}
			actions.emit({ done: untilV === true || rounds >= maxRounds, reason: "max-rounds" });
		},
		{ name: `${name}.converged`, describeKind: "derived" },
	);
	graph.add(converged, { name: "converged" });

	// --- decideEffect: SOLE feedback authority (§7 single-trigger) ------------
	// Computes termination INLINE (round envelope + closure history + the
	// reactive `untilNode` dep) — does NOT read `converged.cache` (avoids the
	// same-wave drain-order hazard refineLoop documents). `converged` above is
	// purely for external observation.
	const decideEffect = createNode(
		[roundWork as Node, untilNode as Node],
		(batchData, _actions, ctx) => {
			const env = (
				batchData[0] != null && batchData[0].length > 0 ? batchData[0].at(-1) : undefined
			) as RoundEnvelope | undefined;
			const untilV = (
				batchData[1] != null && batchData[1].length > 0 ? batchData[1].at(-1) : ctx.prevData[1]
			) as boolean | undefined;
			if (env === undefined) {
				// `until` flipped with no new round — finalize if it went true.
				if (typeof term === "object" && untilV === true && statusState.cache === "running") {
					finalize("max-rounds");
				}
				return;
			}
			// New round settled — fold into the closure history first.
			history = [...history, ...env.turns];
			const r = env.round;
			let done = false;
			let reason: DebateStatus = "max-rounds";
			if (typeof term === "number") done = r >= term;
			else if (term === "until-converge") {
				if (converge(history)) {
					done = true;
					reason = "converged";
				} else done = r >= maxRounds;
			} else done = untilV === true || r >= maxRounds;

			if (done) finalize(reason);
			else roundTrigger.emit(r + 1); // §7 feedback edge
		},
		{ name: `${name}.decide`, describeKind: "effect", errorWhenDepsError: false },
	);
	graph.add(decideEffect, { name: "decide" });

	function finalize(reason: DebateStatus): void {
		let out: unknown;
		if (output === "transcript") out = history.slice();
		else if (output === "synthesizer-final") {
			const synth = [...history].reverse().find((t) => SYNTH_RE.test(t.role));
			out = synth?.content ?? null;
		} else out = output.project(history.slice());
		batch(() => {
			statusState.emit(reason);
			resultState.emit(out);
		});
	}

	// Error watcher — adapter throw surfaces as ERROR on roundWork.
	const errorWatcher = createNode(
		[roundWork as Node],
		(_b, _a, ec) => {
			const t = ec.terminalDeps[0];
			if (t !== undefined && t !== true && statusState.cache === "running") {
				batch(() => {
					statusState.emit("error");
					resultState.emit(new Error("heterogeneousDebate: a participant adapter errored"));
				});
			}
		},
		{ name: `${name}.error-watcher`, describeKind: "effect", errorWhenDepsError: false },
	);
	graph.add(errorWatcher, { name: "error-watcher" });

	// Keepalive: activate the feedback + observability nodes so the loop runs
	// and `.cache` stays warm without an external subscriber. These live for
	// the graph's lifetime (torn down on parent-graph destroy).
	decideEffect.subscribe(() => undefined);
	errorWatcher.subscribe(() => undefined);
	transcript.subscribe(() => undefined);
	converged.subscribe(() => undefined);

	let running = false;

	return {
		transcript,
		result: resultState,
		status: statusState,
		graph,
		async run(): Promise<unknown> {
			if (running) {
				throw new RangeError(
					`heterogeneousDebate "${name}": run() called while a previous run() is still pending`,
				);
			}
			running = true;
			try {
				history = [];
				batch(() => {
					statusState.emit("running");
					resultState.down([[INVALIDATE]]);
				});
				// Subscribe BEFORE the kick (sync adapters would otherwise drain
				// the terminal before awaitSettled subscribes).
				const settled = awaitSettled(resultState, { skipCurrent: true });
				roundTrigger.emit(1); // kick
				return await settled;
			} finally {
				running = false;
			}
		},
	};
}
