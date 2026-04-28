import { describe, expect, it } from "vitest";
import {
	catchError,
	combine,
	combineLatest,
	core,
	DEFAULT_ACTOR,
	debounce,
	debounceTime,
	extra,
	flatMap,
	GuardDenied,
	graph,
	map,
	mergeMap,
	patterns,
	policy,
	replay,
	rescue,
	shareReplay,
	throttle,
	throttleTime,
	version,
} from "../index.js";

describe("graphrefly", () => {
	it("exports version", () => {
		expect(version).toBe("0.0.0");
	});

	it("exports layer namespaces", () => {
		expect(typeof core).toBe("object");
		expect(typeof graph).toBe("object");
		expect(typeof extra).toBe("object");
		expect(typeof patterns).toBe("object");
		expect(typeof graph.Graph).toBe("function");
		expect(typeof map).toBe("function");
	});

	it("exports orchestration patterns namespace", () => {
		expect(typeof patterns.orchestration).toBe("object");
		expect(typeof patterns.orchestration.pipelineGraph).toBe("function");
		expect(typeof patterns.orchestration.PipelineGraph).toBe("function");
		expect(typeof patterns.orchestration.decisionKeyOf).toBe("function");
	});

	it("exports cqrs patterns namespace with keyOf helpers", () => {
		expect(typeof patterns.cqrs).toBe("object");
		expect(typeof patterns.cqrs.cqrs).toBe("function");
		expect(typeof patterns.cqrs.CqrsGraph).toBe("function");
		expect(typeof patterns.cqrs.cqrsEventKeyOf).toBe("function");
		expect(typeof patterns.cqrs.dispatchKeyOf).toBe("function");
		expect(typeof patterns.cqrs.sagaInvocationKeyOf).toBe("function");
	});

	it("exports memory patterns namespace", () => {
		expect(typeof patterns.memory).toBe("object");
		expect(typeof patterns.memory.collection).toBe("function");
		expect(typeof patterns.memory.vectorIndex).toBe("function");
		expect(typeof patterns.memory.knowledgeGraph).toBe("function");
		// `decay` was promoted to `extra/utils/decay.ts` per Tier 2.2 — it now
		// lives on the extra barrel, not the memory namespace.
		// `lightCollection` was folded into `collection({ranked:false})` per
		// Tier 2.3 and is no longer exported.
	});

	it("exports messaging patterns namespace", () => {
		expect(typeof patterns.messaging).toBe("object");
		expect(typeof patterns.messaging.topic).toBe("function");
		expect(typeof patterns.messaging.subscription).toBe("function");
		expect(typeof patterns.messaging.topicBridge).toBe("function");
	});

	it("exports jobQueue patterns namespace", () => {
		expect(typeof patterns.jobQueue).toBe("object");
		expect(typeof patterns.jobQueue.jobQueue).toBe("function");
		expect(typeof patterns.jobQueue.jobFlow).toBe("function");
		expect(typeof patterns.jobQueue.jobEventKeyOf).toBe("function");
	});

	it("exports process patterns namespace", () => {
		expect(typeof patterns.process).toBe("object");
		expect(typeof patterns.process.processManager).toBe("function");
		expect(typeof patterns.process.processInstanceKeyOf).toBe("function");
	});

	it("exports core sugar helpers", () => {
		expect(typeof core.state).toBe("function");
		expect(typeof core.producer).toBe("function");
		expect(typeof core.derived).toBe("function");
		expect(typeof core.effect).toBe("function");
		expect(typeof core.pipe).toBe("function");
	});

	it("exports reactive-log helpers from extra (Audit 1)", () => {
		expect(typeof extra.reactiveLog).toBe("function");
		expect(typeof extra.mergeReactiveLogs).toBe("function");
		expect(typeof extra.NativeLogBackend).toBe("function");
	});

	it("exports storage three-layer surface from extra (Audit 4)", () => {
		expect(typeof extra.memoryBackend).toBe("function");
		expect(typeof extra.snapshotStorage).toBe("function");
		expect(typeof extra.appendLogStorage).toBe("function");
		expect(typeof extra.kvStorage).toBe("function");
		expect(typeof extra.memorySnapshot).toBe("function");
		expect(typeof extra.memoryAppendLog).toBe("function");
		expect(typeof extra.memoryKv).toBe("function");
		expect(typeof extra.jsonCodec).toBe("object");
	});

	it("RxJS alias identity", () => {
		expect(shareReplay).toBe(replay);
		expect(combineLatest).toBe(combine);
		expect(debounceTime).toBe(debounce);
		expect(throttleTime).toBe(throttle);
		expect(catchError).toBe(rescue);
		expect(flatMap).toBe(mergeMap);
	});

	it("exports actor and guard primitives", () => {
		expect(DEFAULT_ACTOR.type).toBe("system");
		expect(typeof policy).toBe("function");
		expect(GuardDenied.name).toBe("GuardDenied");
		const err = new GuardDenied({
			actor: DEFAULT_ACTOR,
			action: "write",
			nodeName: "n::x",
		});
		expect(err.node).toBe("n::x");
		expect(err.nodeName).toBe("n::x");
	});
});
