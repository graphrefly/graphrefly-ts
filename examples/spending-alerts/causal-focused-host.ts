/** D170 consumer-private offline execution boundary; no public export or real inbox I/O. */
import { depBatch, depLatest } from "../../packages/ts/src/ctx/types.js";
import {
	type ConstructionScope,
	type OwnedConstruction,
	prepareConstruction,
	type StartupFact,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type {
	CausalEffectOutcome,
	CausalQuiescence,
	CommittedEffectsView,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	type Checked,
	type CurrentFrame,
	checkInput,
	type EvaluationPack,
	frozen,
	hash,
	type InboxObservationFrame,
	type LocalAuthorityFrame,
	materialProfile,
	NUMERIC_DOMAIN,
	type SpendingBinding,
	type SpendingInputs,
	same,
	VERIFIER_REVISION,
	type VerificationFrame,
	validateBinding,
} from "./causal-inputs.js";
import { buildSpendingPresetNodes, spendingNodeNames } from "./causal-preset.js";
import {
	canonicalMaterial,
	type MaterialSnapshot,
	proposalForMaterial,
	type RequestMaterial,
} from "./causal-publication.js";

/** Test-resource result means only simulated bytes; never a real-host attestation. */
export class OfflineAlertResource {
	readonly kind = "offline-alert-resource";
	readonly binding: SpendingBinding;
	#claimed = false;
	constructor(
		binding: SpendingBinding,
		private readonly writeBytes: (payload: string) => Promise<{ readonly bytesWritten: number }>,
	) {
		this.binding = validateBinding(binding);
		Object.freeze(this);
	}
	claim(): {
		write: (payload: string) => Promise<{ readonly bytesWritten: number }>;
		abort: () => void;
		transfer: () => void;
	} {
		if (this.#claimed) throw new TypeError("offline host epoch already claimed");
		this.#claimed = true;
		let phase: "cold" | "transferred" | "aborted" = "cold";
		return {
			write: (payload) => {
				if (phase !== "transferred") throw new TypeError("offline lease is not transferred");
				return this.writeBytes(payload);
			},
			abort: () => {
				if (phase === "cold") {
					phase = "aborted";
					this.#claimed = false;
				}
			},
			transfer: () => {
				if (phase !== "cold") throw new TypeError("offline lease is not cold");
				phase = "transferred";
			},
		};
	}
}
type Record = {
	readonly request: RequestMaterial;
	readonly admission: NonNullable<CommittedEffectsView["effects"][number]["admission"]>;
	outcome?: CausalEffectOutcome;
};

/** One private cold assembly. The owned source cannot be supplied by the caller. */
export function composeOfflineSpending(
	graph: Graph,
	inputs: Omit<SpendingInputs, "inbox">,
	rawBinding: SpendingBinding,
	resource: OfflineAlertResource,
	options: { name: string; diagnostics?: "off" | "summary" },
) {
	const binding = validateBinding(rawBinding),
		name = options.name;
	if (
		!(resource instanceof OfflineAlertResource) ||
		resource.kind !== "offline-alert-resource" ||
		!same(resource.binding, binding)
	)
		throw new TypeError("offline resource binding");
	const scope = prepareConstruction(graph, {
		name,
		epoch: binding.compositionEpoch,
		names: [
			...spendingNodeNames(name, options.diagnostics),
			`${name}/hostFacts`,
			`${name}/hostGuard`,
			`${name}/runEndReady`,
			`${name}/hostPackFacts`,
		],
		inputs: [
			inputs.evaluations.pack,
			inputs.evaluations.arrivals,
			inputs.evaluations.current,
			inputs.verification.receipts,
			inputs.localAuthority.facts,
		],
	});
	const lease = resource.claim();
	try {
		const startup = scope.startupSource();
		const builtHost = buildOfflineSpendingHost(
			graph,
			scope,
			startup,
			inputs,
			binding,
			lease,
			options,
		);
		const owner = scope.seal(startup, builtHost.roots);
		scope.transferToGraph(owner);
		lease.transfer();
		startConstruction(graph, owner);
		builtHost.afterStart(owner);
		return Object.freeze({
			consume: builtHost.consume,
			owner,
			guard: builtHost.guard,
			source: builtHost.source,
			runEndReady: builtHost.runEndReady,
			built: builtHost.built,
			inspect: builtHost.inspect,
		});
	} catch (error) {
		lease.abort();
		return scope.abort(error);
	}
}

/** Package-private cold builder shared by automatic and explicit assembly. No activation here. */
export function buildOfflineSpendingHost(
	graph: Graph,
	scope: ConstructionScope,
	startup: Node<StartupFact>,
	inputs: Omit<SpendingInputs, "inbox">,
	binding: SpendingBinding,
	lease: ReturnType<OfflineAlertResource["claim"]>,
	options: { name: string; diagnostics?: "off" | "summary" },
) {
	scope.assertContext(graph, startup, binding.compositionEpoch);
	const name = options.name;
	const records = new Map<string, Record>();
	let inFlight = 0,
		writes = 0,
		scheduled = false,
		delivering = false,
		revision = 0,
		notifications = 0;
	let fault: string | undefined;
	let notified = false;
	let maxFrameBytes = 0;
	const source = scope.node<InboxObservationFrame>([], null, {
		name: `${name}/hostFacts`,
		factory: "offlineSpendingHostFacts",
	});
	const frame = (): InboxObservationFrame =>
		frozen({
			binding,
			issuerRef: { kind: "fixture", id: "owned-offline-host" },
			artifactRef: { kind: "fixture-artifact", id: "simulated-writes" },
			artifactDigest: hash("offline-host-not-real-io"),
			readiness: {
				ready: !fault && inFlight === 0 && records.size < 64,
				observedAt: 0,
				validThrough: Number.MAX_SAFE_INTEGER,
				availableSlots: !fault && inFlight === 0 && records.size < 64 ? 1 : 0,
			},
			outcomes: [...records.values()].flatMap((r) => (r.outcome ? [r.outcome] : [])),
		});
	const schedule = () => {
		if (scheduled || delivering || fault) return;
		scheduled = true;
		try {
			queueMicrotask(() => {
				scheduled = false;
				delivering = true;
				const captured = revision;
				try {
					const snapshot = frame();
					maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(canonicalMaterial(snapshot)));
					notifications++;
					source.down([["DATA", snapshot]]);
				} catch {
					fault = "delivery-failed";
				} finally {
					delivering = false;
				}
				if (!fault && captured !== revision) schedule();
			});
		} catch {
			scheduled = false;
			fault = "schedule-failed";
		}
	};
	const complete = (r: Record, state: CausalEffectOutcome["state"], code: string) => {
		if (r.outcome) return;
		const result =
			state === "succeeded"
				? { kind: "ok" as const, value: { source: "offline-host", io: false } }
				: {
						kind: "error" as const,
						error: { kind: "issue" as const, code: `spending-host/${code}`, message: code },
					};
		canonicalMaterial(result, 4096);
		r.outcome = frozen({
			...proposalForMaterial(r.request),
			admissionRef: r.admission.admissionRef,
			state,
			result,
		});
		revision++;
		schedule();
	};
	const built = buildSpendingPresetNodes(
		graph,
		scope,
		startup,
		{ ...inputs, inbox: { facts: source } },
		binding,
		name,
		options.diagnostics,
	);
	const packFacts = scope.node<Checked<EvaluationPack>>(
		[inputs.evaluations.pack],
		(ctx) => {
			if (
				packFacts.deps.length !== 1 ||
				packFacts.deps[0] !== inputs.evaluations.pack ||
				depLatest(ctx, 0) === undefined
			) {
				ctx.down([
					[
						"DATA",
						{
							valid: false,
							issue: {
								kind: "issue",
								code: "host-pack-unavailable",
								message: "host pack unavailable",
							},
						},
					],
				]);
				return;
			}
			let original = ctx.state.get<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = checkInput<EvaluationPack>("pack", raw, binding);
				if (value.valid) {
					const digest = hash(value.value);
					if (original !== undefined && original !== digest) {
						ctx.down([
							[
								"DATA",
								{
									valid: false,
									issue: {
										kind: "issue",
										code: "host-pack-conflict",
										message: "host pack conflict",
									},
								},
							],
						]);
						continue;
					}
					original = digest;
					ctx.state.set(original);
				}
				ctx.down([["DATA", value]]);
			}
		},
		{ name: `${name}/hostPackFacts`, factory: "offlineSpendingHostPackFacts" },
	);

	const deps = [
		built.publication.causal.committedEffects,
		built.materials.materialSnapshot,
		built.admission.currentFacts,
		built.admission.verificationFacts,
		built.admission.localFacts,
		built.admission.inboxFacts,
		packFacts,
	] as const;
	const guard = scope.node(
		deps,
		(ctx) => {
			if (guard.deps.length !== deps.length || guard.deps.some((node, i) => node !== deps[i])) {
				fault = "guard-dependency-mismatch";
				return;
			}
			const view = depLatest(ctx, 0) as CommittedEffectsView | undefined;
			const material = depLatest(ctx, 1) as MaterialSnapshot | undefined;
			if (!view || !material) return;
			if (
				view.authorityId !== `${name}/causal/authority` ||
				view.binding.epoch !== binding.compositionEpoch ||
				!same(material.body.packRef, binding.packRef)
			) {
				fault = "authority-binding";
				return;
			}
			const checked = <T>(index: number): T | undefined => {
				const value = depLatest(ctx, index) as Checked<T> | undefined;
				return value?.valid ? value.value : undefined;
			};
			const pack = depLatest(ctx, 6) as Checked<EvaluationPack> | undefined;
			const current = checked<CurrentFrame>(2),
				verification = checked<VerificationFrame>(3),
				local = checked<LocalAuthorityFrame>(4),
				inbox = checked<InboxObservationFrame>(5);
			for (const effect of view.effects) {
				const admission = effect.admission;
				if (!admission || admission.state !== "admitted" || effect.outcome) continue;
				const request = material.body.materials.find((m) =>
					same(proposalForMaterial(m), effect.proposal),
				);
				if (
					!request ||
					!same(
						{
							...proposalForMaterial(request),
							admissionRef: admission.admissionRef,
							state: admission.state,
						},
						admission,
					)
				)
					continue;
				const body = request.body;
				if (
					!same(
						{
							...materialProfile(binding),
							schema: material.body.schema,
							materials: material.body.materials,
						},
						material.body,
					) ||
					body.hostEpoch !== binding.hostEpoch ||
					body.compositionEpoch !== binding.compositionEpoch ||
					body.sourceDigest !== binding.sourceDigest ||
					body.runtimeDigest !== binding.runtimeDigest ||
					!same(body.destinationRef, binding.destinationRef)
				)
					continue;
				const key = canonicalMaterial(effect.proposal);
				const prior = records.get(key);
				if (prior) {
					if (!same(prior.admission, admission)) fault = "admission-conflict";
					continue;
				}
				if (fault) continue;
				if (records.size >= 64) {
					fault = "record-capacity-proof-failed";
					continue;
				}
				const record: Record = { request, admission };
				records.set(key, record);
				const currents =
					current?.current.filter((c) => same(c.occurrence, effect.proposal.occurrence)) ?? [];
				const receipts =
					verification?.receipts.filter(
						(v) =>
							same(v.occurrence, body.occurrence) &&
							v.inputDigest === body.inputDigest &&
							v.policyDigest === body.policyDigest &&
							v.sourceDigest === body.sourceDigest &&
							v.runtimeDigest === body.runtimeDigest &&
							v.requestDigest === body.payloadDigest &&
							v.verifierRevision === VERIFIER_REVISION &&
							v.numericDomainRef === NUMERIC_DOMAIN,
					) ?? [];
				const grants =
					local?.grants.filter(
						(g) =>
							same(g.occurrence, body.occurrence) &&
							g.requestDigest === body.payloadDigest &&
							same(g.destinationRef, body.destinationRef) &&
							g.hostEpoch === body.hostEpoch &&
							g.replayScope.compositionEpoch === body.compositionEpoch &&
							g.replayScope.hostEpoch === body.hostEpoch,
					) ?? [];
				const evaluation = pack?.valid
					? pack.value.evaluations.find((e) => same(e.occurrence, body.occurrence))
					: undefined;
				const grant = grants[0],
					receipt = receipts[0],
					now = local?.tick;
				const denied =
					!local ||
					local.stop ||
					now === undefined ||
					currents.length !== 1 ||
					currents[0].policyDigest !== body.policyDigest ||
					currents[0].watermark < body.occurrence.revision ||
					!evaluation ||
					!same(currents[0].policyRef, evaluation.policyRef) ||
					receipts.length !== 1 ||
					receipt.verdict !== "pass" ||
					grants.length !== 1 ||
					grant.revoked ||
					admission.admissionRef.kind !== "spending-admission" ||
					admission.admissionRef.id !==
						hash({
							proposal: effect.proposal,
							receiptRef: receipt.receiptRef,
							grantRef: grant.grantRef,
							binding,
						}) ||
					now < grant.validFrom ||
					now > grant.validThrough ||
					!inbox ||
					!inbox.readiness.ready ||
					inbox.readiness.availableSlots !== 1 ||
					now < inbox.readiness.observedAt ||
					now > inbox.readiness.validThrough;
				if (denied) {
					complete(record, "cancelled", "final-guard");
					continue;
				}
				if (inFlight !== 0 || writes >= Math.min(64, grant.maxWrites)) {
					complete(record, "cancelled", "busy-or-write-budget");
					continue;
				}
				const payload = `${body.payloadText}\n`;
				if (Buffer.byteLength(payload) > 4096) {
					complete(record, "cancelled", "payload-capacity");
					continue;
				}
				inFlight++;
				revision++;
				schedule();
				if (fault) {
					inFlight--;
					complete(record, "cancelled", "notification-unavailable");
					continue;
				}
				writes++;
				try {
					Promise.resolve(lease.write(payload)).then(
						(result) => {
							inFlight--;
							let state: CausalEffectOutcome["state"] = "unknown";
							try {
								const descriptor = Object.getOwnPropertyDescriptor(result, "bytesWritten");
								if (
									descriptor &&
									"value" in descriptor &&
									descriptor.value === Buffer.byteLength(payload)
								)
									state = "succeeded";
							} catch {
								/* Malformed host returns cannot establish success. */
							}
							complete(record, state, "short-or-unknown-write");
						},
						() => {
							inFlight--;
							complete(record, "unknown", "write-rejected");
						},
					);
				} catch {
					inFlight--;
					complete(record, "unknown", "write-threw");
				}
			}
		},
		{ name: `${name}/hostGuard`, factory: "offlineSpendingHostGuard" },
	);
	const endDeps = [
		built.publication.causal.ports.quiescence,
		built.publication.causal.committedEffects,
		built.admission.localFacts,
		packFacts,
	] as const;
	const runEndReady = scope.node<boolean>(
		endDeps,
		(ctx) => {
			if (
				runEndReady.deps.length !== endDeps.length ||
				runEndReady.deps.some((n, i) => n !== endDeps[i])
			) {
				ctx.down([["DATA", false]]);
				return;
			}
			let domains = ctx.state.get<Map<string, CausalQuiescence>>();
			if (!domains) domains = new Map();
			if (depLatest(ctx, 0) === undefined) domains.clear();
			for (const q of (depBatch(ctx, 0) ?? []) as CausalQuiescence[]) {
				if (domains.has(q.revisionDomain) || domains.size < 64) domains.set(q.revisionDomain, q);
			}
			ctx.state.set(domains);
			const view = depLatest(ctx, 1) as CommittedEffectsView | undefined;
			const local = depLatest(ctx, 2) as Checked<LocalAuthorityFrame> | undefined;
			const pack = depLatest(ctx, 3) as Checked<EvaluationPack> | undefined;
			const frontierCovered =
				!!pack?.valid &&
				pack.value.evaluations.every((e) => {
					const q = domains?.get(e.occurrence.revisionDomain);
					return q !== undefined && q.evaluatedThroughRevision >= e.occurrence.revision;
				});
			const ready =
				frontierCovered &&
				!!local?.valid &&
				local.value.stop &&
				!!view &&
				domains.size > 0 &&
				[...domains.values()].every(
					(q) =>
						q.lifecycle &&
						q.retainedEvidence &&
						q.pendingOccurrenceRefs.length === 0 &&
						q.pendingEffectIds.length === 0,
				) &&
				view.effects.every(
					(e) =>
						e.admission?.state === "rejected" ||
						(e.outcome !== undefined &&
							!["unknown", "reconcile-required"].includes(e.outcome.state)),
				);
			ctx.down([["DATA", ready]]);
		},
		{ name: `${name}/runEndReady`, factory: "offlineSpendingRunEndReady" },
	);

	return Object.freeze({
		consume: built.consume,
		// Private runtime owner diagnostics: no arbitrary request/outcome injection method.
		roots: Object.freeze([...built.roots, guard, runEndReady]),
		afterStart: (owner: OwnedConstruction) => {
			if (owner.startup !== startup || owner.epoch !== binding.compositionEpoch)
				throw new TypeError("host startup owner mismatch");
			if (notified) throw new TypeError("host startup already notified");
			notified = true;
			if (owner.phase !== "started") fault = "startup-failed";
			revision++;
			schedule();
		},
		guard,
		source,
		runEndReady,
		built,
		inspect: () =>
			Object.freeze({
				fault,
				normalEndReady:
					!fault && inFlight === 0 && !scheduled && !delivering && runEndReady.cache === true,
				writes,
				inFlight,
				scheduled,
				delivering,
				notifications,
				maxFrameBytes,
				records: Object.freeze(
					[...records.values()].map((r) =>
						frozen({ request: r.request, admission: r.admission, outcome: r.outcome }),
					),
				),
			}),
	});
}
