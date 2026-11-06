import { createGraphContext, depBatch, merge, quietDataBoundary } from "./graph-runtime.mjs";

/** One session's decisions compose into the supplied campaign Graph. No host workflow loop. */
export function runSessionGraph({
	graphContext,
	name,
	createPolicy,
	execute,
	onTopology,
	persist,
	observe,
}) {
	if (typeof persist !== "function") throw new TypeError("durable session persistence required");
	const owned = !graphContext;
	const context = graphContext ?? createGraphContext({ name });
	const { graph } = context;
	const prefix = `session/${name}`;
	const edges = [];
	const node = (deps, fn, options) => {
		const value = graph.node(deps, fn, options);
		edges.push([value, [...deps]]);
		return value;
	};
	const init = (factory, deps, options) => {
		const value = graph.initNode(factory, deps, options);
		edges.push([value, [...deps]]);
		return value;
	};
	const assertEdges = () => {
		for (const [value, deps] of edges)
			if (value.deps.length !== deps.length || deps.some((dep, i) => value.deps[i] !== dep))
				throw Error("session topology dependency drift");
	};
	const ingress = node([], null, { name: `${prefix}/facts` });
	const releases = [];
	let resolve, reject;
	const result = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	let finished = false;
	const active = new Set();
	const failHost = (error) => {
		if (finished) return;
		finished = true;
		for (const release of releases) release();
		if (owned) context.dispose();
		reject(error);
	};
	const state = node(
		[ingress],
		(ctx) => {
			let frame = ctx.state.get();
			for (const fact of depBatch(ctx, 0) ?? []) {
				if (!frame) {
					if (fact.kind !== "start") throw Error("session result before start");
					frame = { policy: createPolicy(), pending: null, closed: false, revision: 0 };
					ctx.state.set(frame);
				} else if (fact.kind === "start") throw Error("session start replay");
				else {
					if (frame.closed || fact.admission !== frame.pending || fact.kind !== frame.pending?.kind)
						throw Error("session result lost exact admission");
					frame.pending = null;
				}
				ctx.down([["DATA", { frame, fact, revision: ++frame.revision }]]);
			}
		},
		{ name: `${prefix}/state`, factory: "b121SessionState" },
	);
	const acknowledgements = node([], null, { name: `${prefix}/persistence-facts` });
	const execution = node(
		[acknowledgements],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				if (fact.kind !== "request-persisted") continue;
				assertEdges();
				const { admission, frame } = fact.packet;
				if (frame.closed || frame.pending !== admission)
					throw Error("session persistence ack lost exact admission");
				ctx.down([["DATA", { admission, frame, revision: frame.revision }]]);
			}
		},
		{ name: `${prefix}/persisted-request-admission`, factory: "b121PersistedRequestAdmission" },
	);
	// Every policy callback runs through the dispatcher with the explicit state dependency.
	const stage = (suffix, inputs, select, run) => {
		const deps =
			inputs.length > 1 ? [init(merge(), inputs, { name: `${prefix}/${suffix}-events` })] : inputs;
		const raw = node(
			deps,
			(ctx) => {
				for (let i = 0; i < deps.length; i++)
					for (const input of depBatch(ctx, i) ?? []) {
						if (!select(input)) continue;
						const { frame } = input;
						if (frame.closed) continue;
						try {
							const value = run(input);
							if (value) ctx.down([["DATA", { frame, revision: input.revision, ...value }]]);
						} catch (error) {
							const value = frame.policy.fail(error);
							frame.closed = true;
							ctx.down([["DATA", { frame, revision: input.revision, ...value }]]);
						}
					}
			},
			{ name: `${prefix}/${suffix}`, factory: `b121/${suffix}` },
		);
		const boundary = quietDataBoundary(graph, raw, {
			name: `${prefix}/${suffix}-delivery`,
			factory: "b121ExactStageDelivery",
			maxOccurrences: 512,
			key: (x) => `${x.revision}/${x.kind}`,
			fingerprint: (x) => `${x.revision}/${x.kind}`,
		});
		releases.push(boundary.release);
		return boundary.output;
	};
	const started = stage(
		"phase-start",
		[state],
		(x) => x.fact?.kind === "start",
		({ frame }) => {
			frame.policy.start();
			return { kind: "rebuild" };
		},
	);
	const estimates = stage(
		"input-budget-admission",
		[state],
		(x) => x.fact?.kind === "estimate",
		({ frame, fact }) =>
			fact.error ? frame.policy.fail(fact.error) : frame.policy.estimated(fact.value),
	);
	const responses = stage(
		"response-accounting",
		[state],
		(x) => x.fact?.kind === "create",
		({ frame, fact }) =>
			fact.error
				? frame.policy.fail(fact.error)
				: { kind: "response", ...frame.policy.responded(fact.value) },
	);
	const brokerProposal = stage(
		"broker-phase-admission",
		[responses],
		(x) => x.kind === "response",
		({ frame, message, call }) => ({
			kind: "broker",
			payload: frame.policy.proposeBroker({ message, call }),
		}),
	);
	const broker = stage(
		"broker-execution",
		[execution],
		(x) => x.admission?.kind === "broker",
		({ frame, admission }) => {
			frame.pending = null;
			return { kind: "broker-result", ...frame.policy.broker(admission.payload) };
		},
	);
	const advanced = stage(
		"phase-advance",
		[broker],
		(x) => x.kind === "broker-result",
		({ frame, ...batch }) => frame.policy.advance(batch),
	);
	const requests = stage(
		"request-policy",
		[started, estimates, advanced],
		(x) => x.kind === "rebuild",
		({ frame }) => frame.policy.prepare(),
	);
	const admissionEvents = init(merge(), [requests, estimates, brokerProposal], {
		name: `${prefix}/admission-events`,
	});
	const admissions = node(
		[admissionEvents],
		(ctx) => {
			let ordinal = ctx.state.get() ?? 0;
			for (let i = 0; i < 1; i++)
				for (const command of depBatch(ctx, i) ?? []) {
					if (!["estimate", "create", "broker"].includes(command.kind) || command.frame.closed)
						continue;
					if (command.frame.pending) throw Error("session overlapping execution");
					const admission = Object.freeze({
						id: `${prefix}/${++ordinal}`,
						kind: command.kind,
						payload: structuredClone(command.payload),
						events: command.frame.policy.drainEvents(),
					});
					command.frame.pending = admission;
					ctx.down([["DATA", { admission, frame: command.frame }]]);
				}
			ctx.state.set(ordinal);
		},
		{ name: `${prefix}/request-execution-admission`, factory: "b121ExactRequestAdmission" },
	);
	const terminalEvents = init(
		merge(),
		[started, estimates, responses, brokerProposal, broker, advanced, requests],
		{ name: `${prefix}/terminal-events` },
	);
	const terminal = node(
		[terminalEvents],
		(ctx) => {
			for (let i = 0; i < 1; i++)
				for (const value of depBatch(ctx, i) ?? []) {
					if (value.kind !== "done") continue;
					value.frame.closed = true;
					const packet = {
						result: value.result,
						events: value.frame.policy.drainEvents(),
						frame: value.frame,
					};
					value.frame.terminal = packet;
					ctx.down([["DATA", packet]]);
				}
		},
		{ name: `${prefix}/terminal`, factory: "b121SessionTerminal" },
	);

	const final = node(
		[acknowledgements],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? [])
				if (fact.kind === "terminal-persisted") {
					if (fact.packet !== fact.packet.frame.terminal)
						throw Error("terminal persistence identity drift");
					ctx.down([["DATA", fact.packet.result]]);
				}
		},
		{ name: `${prefix}/persisted-terminal`, factory: "b121PersistedSessionTerminal" },
	);
	const nodes = [
		state,
		started,
		estimates,
		responses,
		brokerProposal,
		broker,
		advanced,
		requests,
		admissions,
		terminal,
		execution,
		final,
	];
	for (const value of nodes)
		releases.push(
			value.subscribe((msg) => {
				if (msg[0] === "ERROR") failHost(msg[1]);
			}),
		);
	const track = (promise) => {
		active.add(promise);
		void promise.then(
			() => active.delete(promise),
			() => active.delete(promise),
		);
	};
	const persisted = new Set();
	const persistPacket = (packet, kind) => {
		if (persisted.has(packet)) {
			failHost(Error("session persistence replay"));
			return;
		}
		persisted.add(packet);
		track(
			Promise.resolve()
				.then(() => persist(packet.admission?.events ?? packet.events))
				.then(() => {
					if (!finished) acknowledgements.down([["DATA", { kind, packet }]]);
				})
				.catch(failHost),
		);
	};
	releases.push(
		admissions.subscribe((msg) => {
			if (msg[0] === "DATA" && !finished) persistPacket(msg[1], "request-persisted");
		}),
	);
	releases.push(
		terminal.subscribe((msg) => {
			if (msg[0] === "DATA" && !finished) persistPacket(msg[1], "terminal-persisted");
		}),
	);
	releases.push(
		final.subscribe((msg) => {
			if (msg[0] !== "DATA" || finished) return;
			finished = true;
			for (const release of releases) release();
			if (owned) context.dispose();
			resolve(msg[1]);
		}),
	);
	const executed = new Set();
	releases.push(
		execution.subscribe((msg) => {
			if (msg[0] !== "DATA" || finished) return;
			const { admission } = msg[1];
			if (admission.kind === "broker") return;
			if (executed.has(admission.id)) {
				failHost(Error("session execution replay"));
				return;
			}
			executed.add(admission.id);
			const work = Promise.resolve()
				.then(() => {
					assertEdges();
					return execute(admission);
				})
				.then(
					(value) => ({ kind: admission.kind, admission, value }),
					(error) => ({ kind: admission.kind, admission, error }),
				)
				.then((fact) => {
					if (!finished) ingress.down([["DATA", fact]]);
				})
				.catch(failHost);
			track(work);
		}),
	);
	if (observe) {
		for (const suffix of [
			"facts",
			"state",
			"input-budget-admission",
			"broker-phase-admission",
			"request-policy",
			"request-execution-admission",
			"persisted-request-admission",
			"persisted-terminal",
		]) {
			releases.push(
				graph.observe(`${prefix}/${suffix}`).subscribe((event) => {
					const data = event.msg[1];
					try {
						Promise.resolve(
							observe({
								type: "graph-observation",
								data: {
									path: event.path,
									tier: event.tier,
									seq: event.seq,
									message: event.msg[0],
									revision: data?.revision ?? null,
									admissionId: data?.admission?.id ?? data?.id ?? null,
								},
							}),
						).catch(() => {});
					} catch {}
				}),
			);
		}
	}
	track(
		Promise.resolve()
			.then(() => onTopology?.(graph.topology()))
			.then(() => {
				assertEdges();
				if (!finished) ingress.down([["DATA", { kind: "start" }]]);
			})
			.catch(failHost),
	);
	return result.finally(async () => {
		await Promise.allSettled([...active]);
	});
}
