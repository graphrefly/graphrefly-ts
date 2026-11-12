/** Private B121 composition. Policies execute in Graph nodes; sinks perform one admitted effect. */
import { randomUUID } from "node:crypto";
import { createGraphContext, depBatch } from "./graph-runtime.mjs";

function requireEdges(pairs) {
	for (const [node, dependency] of pairs)
		if (!node.deps.includes(dependency))
			throw new Error(
				`B121 required control dependency missing: ${node.name} <- ${dependency.name}`,
			);
}
function observeNodes(graph, paths, observe, releases) {
	if (!observe) return;
	for (const path of paths)
		releases.push(
			graph.observe(path).subscribe((event) => {
				try {
					Promise.resolve(
						observe({
							type: "graph-observation",
							data: { path: event.path, tier: event.tier, seq: event.seq, message: event.msg[0] },
						}),
					).catch(() => {});
				} catch {}
			}),
		);
}

export function createB121TransportControl({
	graphContext,
	initialState,
	reduce,
	admit,
	recover,
	persist,
	executeAttempt,
	executeDelay,
	observe,
}) {
	const owned = !graphContext;
	const context = graphContext ?? createGraphContext({ name: "b121-provider" });
	const { graph } = context;
	const prefix = `provider/${randomUUID()}`;
	const input = graph.node([], null, { name: `${prefix}/facts` });
	let snapshot = initialState;
	const waiting = new Map();
	const executed = new Set();
	const active = new Set();
	let disposed = false;
	const state = graph.node(
		[input],
		(ctx) => {
			let value = ctx.state.get() ?? initialState;
			for (const fact of depBatch(ctx, 0) ?? []) value = reduce(value, fact);
			ctx.state.set(value);
			ctx.down([["DATA", value]]);
		},
		{ name: `${prefix}/request-settlement`, factory: "b121TransportState" },
	);
	const project = (name, fn) =>
		graph.derived(
			[state],
			(value) => {
				try {
					return fn(value);
				} catch (error) {
					return { kind: "fault", error, commandId: value.commandId, revision: value.revision };
				}
			},
			{ name: `${prefix}/${name}` },
		);
	const budget = project("budget-admission", (value) =>
		value.phase === "admit" ? admit(value) : null,
	);
	const attemptJournal = graph.derived([budget], (value) => value, {
		name: `${prefix}/write-ahead-request`,
	});
	const http = project("exact-http-admission", (value) =>
		value.phase === "http"
			? {
					kind: "http",
					commandId: value.commandId,
					revision: value.revision,
					admission: value.admission,
					request: value.request,
					signal: value.signal,
				}
			: null,
	);
	const settlementJournal = project("settlement-persistence", (value) =>
		value.phase === "record"
			? {
					kind: "settlement",
					commandId: value.commandId,
					revision: value.revision,
					record: value.record,
				}
			: null,
	);
	const recovery = project("retry-admission", (value) =>
		value.phase === "recover" ? recover(value) : null,
	);
	const retryJournal = graph.derived([recovery], (value) => value, {
		name: `${prefix}/retry-write-ahead`,
	});
	const time = project("exact-delay-admission", (value) =>
		value.phase === "wait"
			? {
					kind: "delay",
					commandId: value.commandId,
					revision: value.revision,
					admission: value.delay,
					signal: value.signal,
				}
			: null,
	);
	const terminal = project("command-result", (value) => value.reply ?? null);
	const edges = [
		[state, input],
		[budget, state],
		[attemptJournal, budget],
		[http, state],
		[settlementJournal, state],
		[recovery, state],
		[retryJournal, recovery],
		[time, state],
		[terminal, state],
	];
	requireEdges(edges);
	const releases = [];
	const send = (fact) => {
		if (!disposed) input.down([["DATA", fact]]);
	};
	// The identity set is mechanical at-most-once dispatch, never retry or phase policy.
	function bind(node, execute, type) {
		releases.push(
			node.subscribe((msg) => {
				if (msg[0] !== "DATA" || !msg[1]) return;
				const action = msg[1];
				const key = `${type}:${action.commandId}:${action.revision}`;
				if (executed.has(key)) return;
				executed.add(key);
				const pending = Promise.resolve()
					.then(async () => {
						requireEdges(edges);
						if (action.kind === "fault") throw action.error;
						return execute(action);
					})
					.then(
						(result) =>
							send({ type, commandId: action.commandId, revision: action.revision, result }),
						(error) =>
							send({
								type: "fault",
								commandId: action.commandId,
								revision: action.revision,
								error,
							}),
					);
				active.add(pending);
				pending.finally(() => active.delete(pending));
			}),
		);
	}
	releases.push(
		state.subscribe((msg) => {
			if (msg[0] === "DATA") snapshot = msg[1];
		}),
	);
	bind(
		attemptJournal,
		async (action) => {
			await persist(action.record);
			return action;
		},
		"admitted",
	);
	bind(http, executeAttempt, "outcome");
	bind(
		settlementJournal,
		async (action) => {
			await persist(action.record);
			return null;
		},
		"recorded",
	);
	bind(
		retryJournal,
		async (action) => {
			await persist(action.record);
			return action;
		},
		"wait-admitted",
	);
	bind(time, executeDelay, "waited");
	releases.push(
		terminal.subscribe((msg) => {
			if (msg[0] !== "DATA" || !msg[1]) return;
			const reply = msg[1],
				deferred = waiting.get(reply.commandId);
			if (!deferred) return;
			waiting.delete(reply.commandId);
			if (reply.error) deferred.reject(reply.error);
			else deferred.resolve(reply.value);
		}),
	);
	observeNodes(
		graph,
		[
			"facts",
			"request-settlement",
			"budget-admission",
			"write-ahead-request",
			"exact-http-admission",
			"settlement-persistence",
			"retry-admission",
			"retry-write-ahead",
			"exact-delay-admission",
			"command-result",
		].map((name) => `${prefix}/${name}`),
		observe,
		releases,
	);
	return Object.freeze({
		graphContext: context,
		graph,
		command(type, data) {
			if (disposed) return Promise.reject(new Error("transport disposed"));
			const commandId = randomUUID();
			return new Promise((resolve, reject) => {
				waiting.set(commandId, { resolve, reject });
				send({ type, commandId, ...data });
			});
		},
		snapshot: () => snapshot,
		async dispose() {
			if (snapshot.phase !== "idle") throw new Error("transport must drain before disposal");
			await Promise.all(active);
			disposed = true;
			for (const release of releases) release();
			if (owned) context.dispose();
		},
	});
}

/** Four-turn B121 qualification composition; provider qualification never contains participant material. */
export function createB121QualificationControl({
	graphContext,
	initialState,
	reduce,
	admission,
	executeEstimate,
	executeGeneration,
	observe,
}) {
	const owned = !graphContext;
	const context = graphContext ?? createGraphContext({ name: "b121-qualification" });
	const { graph } = context;
	const prefix = `qualification/${randomUUID()}`;
	const input = graph.node([], null, { name: `${prefix}/facts` });
	const state = graph.node(
		[input],
		(ctx) => {
			let value = ctx.state.get() ?? initialState;
			for (const fact of depBatch(ctx, 0) ?? []) value = reduce(value, fact);
			ctx.state.set(value);
			ctx.down([["DATA", value]]);
		},
		{ name: `${prefix}/conversation-and-identity` },
	);
	const request = graph.derived([state], (value) => admission(value), {
		name: `${prefix}/frozen-request`,
	});
	const estimate = graph.derived(
		[request],
		(value) => (value?.kind === "estimate" ? value : null),
		{ name: `${prefix}/estimate-admission` },
	);
	const generation = graph.derived(
		[request],
		(value) => (value?.kind === "generation" ? value : null),
		{ name: `${prefix}/generation-admission` },
	);
	const terminal = graph.derived([state], (value) => (value.terminal ? value : null), {
		name: `${prefix}/terminal`,
	});
	const edges = [
		[state, input],
		[request, state],
		[estimate, request],
		[generation, request],
		[terminal, state],
	];
	requireEdges(edges);
	const releases = [],
		executed = new Set();
	let resolve, reject;
	const result = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	function bind(node, execute, type) {
		releases.push(
			node.subscribe((msg) => {
				if (msg[0] !== "DATA" || !msg[1]) return;
				const action = msg[1],
					key = `${type}:${action.revision}`;
				if (executed.has(key)) return;
				executed.add(key);
				Promise.resolve()
					.then(() => {
						requireEdges(edges);
						return execute(action);
					})
					.then(
						(value) => input.down([["DATA", { type, revision: action.revision, value }]]),
						(error) => input.down([["DATA", { type: "failed", revision: action.revision, error }]]),
					);
			}),
		);
	}
	bind(estimate, executeEstimate, "estimated");
	bind(generation, executeGeneration, "generated");
	releases.push(
		terminal.subscribe((msg) => {
			if (msg[0] !== "DATA" || !msg[1]) return;
			if (msg[1].error) reject(msg[1].error);
			else resolve(msg[1].receipts);
		}),
	);
	observeNodes(
		graph,
		[
			"facts",
			"conversation-and-identity",
			"frozen-request",
			"estimate-admission",
			"generation-admission",
			"terminal",
		].map((name) => `${prefix}/${name}`),
		observe,
		releases,
	);
	input.down([["DATA", { type: "start" }]]);
	return {
		graph,
		result: result.finally(() => {
			for (const release of releases) release();
			if (owned) context.dispose();
		}),
	};
}
