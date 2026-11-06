import { createGraphContext, depBatch } from "./graph-runtime.mjs";

/** B121-private serial campaign. Decisions are Graph state; sinks execute exact admitted effects. */
export function runCampaignGraph({
	graphContext,
	name,
	samples,
	budgetAdmitted = true,
	effects,
	classify,
	journal,
}) {
	if (typeof journal !== "function") throw new TypeError("durable campaign journal required");
	if (typeof effects?.["final-persistence"] !== "function")
		throw new TypeError("campaign final persistence effect required");
	const context = graphContext ?? createGraphContext({ name }),
		owned = !graphContext,
		{ graph } = context;
	const prefix = `campaign/${name}`,
		releases = [],
		active = new Set(),
		executed = new Set();
	const ingress = graph.node([], null, { name: `${prefix}/facts` });
	let latest,
		resolve,
		reject,
		closed = false;
	const completed = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const collection = (s, error) => {
		const failure = error ? String(error.message ?? error) : (s?.failure ?? null);
		const rows = structuredClone(
			s?.rows ??
				samples.map((x) => ({
					...x,
					status: "not-run",
					reason: "not-started",
					assessmentSHA256: null,
				})),
		);
		for (const row of rows) {
			if (row.status === "started") {
				row.status = "interrupted";
				row.reason = failure;
			} else if (row.status === "not-run" && failure) row.reason = failure;
		}
		return { rows, failure, qualification: s?.qualification ?? null };
	};
	const stop = () => {
		for (const release of releases) release();
		if (owned) context.dispose();
	};
	const rejectHost = (error) => {
		if (closed) return;
		closed = true;
		const failure = error instanceof Error ? error : new Error(String(error));
		failure.campaignSnapshot = collection(latest, failure);
		stop();
		reject(failure);
	};
	const state = graph.node(
		[ingress],
		(ctx) => {
			let s = ctx.state.get();
			for (const fact of depBatch(ctx, 0) ?? []) {
				if (fact.kind === "start") {
					if (s) throw Error("campaign start replay");
					s = {
						index: 0,
						revision: 0,
						phase: budgetAdmitted ? "qualification" : "final-persistence",
						failure: budgetAdmitted ? null : "budget-not-admitted",
						qualification: null,
						rows: samples.map((x) => ({
							...structuredClone(x),
							status: "not-run",
							reason: "not-started",
							assessmentSHA256: null,
						})),
						pending: null,
						ready: false,
						result: null,
						outcome: null,
					};
					latest = s;
				} else {
					if (!s || s.phase === "terminal" || s.pending !== fact.admission)
						throw Error("campaign outcome lost exact admission");
					if (fact.kind === "write-ack") {
						if (s.ready) throw Error("campaign write-ahead replay");
						s.ready = true;
					} else {
						if (fact.kind !== "outcome" || !s.ready)
							throw Error("campaign outcome before write-ahead acknowledgement");
						s.pending = null;
						s.ready = false;
						if (fact.error) {
							s.failure = String(fact.error.message ?? fact.error);
							if (fact.admission.kind === "final-persistence") throw fact.error;
							s.phase = "final-persistence";
						} else
							switch (fact.admission.kind) {
								case "qualification":
									s.qualification = fact.value;
									s.phase = s.rows.length ? "session" : "final-persistence";
									break;
								case "session":
									s.result = fact.value;
									s.phase = "result-persistence";
									break;
								case "result-persistence":
									s.phase = effects.assessment ? "assessment" : "next";
									break;
								case "assessment":
									s.outcome = fact.value;
									s.phase = "assessment-persistence";
									break;
								case "assessment-persistence":
									s.phase = "next";
									break;
								case "final-persistence":
									s.phase = "terminal";
									break;
								default:
									throw Error("unknown campaign outcome");
							}
						if (s.phase === "next") {
							const disposition = classify(s.result, s.outcome);
							Object.assign(s.rows[s.index], disposition.row);
							s.failure = disposition.failure ?? null;
							s.index++;
							s.result = null;
							s.outcome = null;
							s.phase = s.failure || s.index === s.rows.length ? "final-persistence" : "session";
						}
					}
				}
				s.revision++;
				if (!s.pending && s.phase !== "terminal") {
					if (s.phase === "session") {
						s.rows[s.index].status = "started";
						s.rows[s.index].reason = null;
					}
					s.pending = Object.freeze({
						id: `${prefix}/${s.revision}/${s.phase}`,
						kind: s.phase,
						index: s.index,
						sample: structuredClone(s.rows[s.index] ?? null),
						result: structuredClone(s.result),
						outcome: structuredClone(s.outcome),
						...(s.phase === "final-persistence" ? { collection: collection(s) } : {}),
					});
				}
				ctx.state.set(s);
				latest = s;
				ctx.down([["DATA", { state: s }]]);
			}
		},
		{ name: `${prefix}/state`, factory: "b121CampaignState" },
	);
	const kinds = [
		"qualification",
		"session",
		"result-persistence",
		"assessment",
		"assessment-persistence",
		"final-persistence",
	];
	const edges = [[state, ingress]];
	const stage = (kind, ready) => {
		const node = graph.node(
			[state],
			(ctx) => {
				for (const { state: s } of depBatch(ctx, 0) ?? [])
					if (s.phase === kind && s.pending && s.ready === ready) ctx.down([["DATA", s.pending]]);
			},
			{
				name: `${prefix}/${kind}-${ready ? "execution-admission" : "write-ahead"}`,
				factory: `b121Campaign/${kind}`,
			},
		);
		edges.push([node, state]);
		return node;
	};
	const intents = kinds.map((kind) => stage(kind, false)),
		admissions = kinds.map((kind) => stage(kind, true));
	const terminal = graph.node(
		[state],
		(ctx) => {
			for (const { state: s } of depBatch(ctx, 0) ?? [])
				if (s.phase === "terminal") ctx.down([["DATA", collection(s)]]);
		},
		{ name: `${prefix}/terminal`, factory: "b121CampaignTerminal" },
	);
	edges.push([terminal, state]);
	const verifyEdges = () => {
		for (const [node, dependency] of edges)
			if (!node.deps.includes(dependency))
				throw Error("B121 required campaign control dependency missing");
	};
	verifyEdges();
	for (const node of [state, ...intents, ...admissions, terminal])
		releases.push(
			node.subscribe((msg) => {
				if (msg[0] === "ERROR") rejectHost(msg[1]);
			}),
		);
	releases.push(
		terminal.subscribe((msg) => {
			if (msg[0] !== "DATA" || closed) return;
			closed = true;
			stop();
			resolve(msg[1]);
		}),
	);
	function bind(node, phase, execute) {
		releases.push(
			node.subscribe((msg) => {
				if (msg[0] !== "DATA" || closed) return;
				const admission = msg[1],
					identity = `${phase}/${admission.id}`;
				if (executed.has(identity)) return;
				executed.add(identity);
				const task = Promise.resolve()
					.then(() => {
						verifyEdges();
						return execute(admission);
					})
					.then(
						(value) => ({ kind: phase === "write" ? "write-ack" : "outcome", admission, value }),
						(error) => {
							if (phase === "write") {
								rejectHost(error);
								return null;
							}
							return { kind: "outcome", admission, error };
						},
					)
					.then((fact) => {
						if (fact && !closed) ingress.down([["DATA", fact]]);
					})
					.catch(rejectHost);
				active.add(task);
				void task.finally(() => active.delete(task));
			}),
		);
	}
	for (const node of intents)
		bind(node, "write", (admission) =>
			journal({
				type: "campaign-effect-admitted",
				data: {
					id: admission.id,
					kind: admission.kind,
					index: admission.index,
					sampleId: admission.sample?.sampleId ?? null,
				},
			}),
		);
	for (const node of admissions)
		bind(node, "effect", (admission) => effects[admission.kind](admission));
	for (const path of [
		"facts",
		"state",
		"terminal",
		...kinds.flatMap((kind) => [`${kind}-write-ahead`, `${kind}-execution-admission`]),
	])
		releases.push(
			graph.observe(`${prefix}/${path}`).subscribe((event) => {
				try {
					Promise.resolve(
						journal({
							type: "graph-observation",
							data: { path: event.path, tier: event.tier, seq: event.seq, message: event.msg[0] },
						}),
					).catch(() => {});
				} catch {}
			}),
		);
	try {
		ingress.down([["DATA", { kind: "start" }]]);
	} catch (error) {
		rejectHost(error);
	}
	return completed.finally(async () => {
		await Promise.allSettled([...active]);
	});
}
