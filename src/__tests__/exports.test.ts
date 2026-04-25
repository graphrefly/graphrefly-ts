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

	it("exports memory patterns namespace", () => {
		expect(typeof patterns.memory).toBe("object");
		expect(typeof patterns.memory.collection).toBe("function");
		expect(typeof patterns.memory.lightCollection).toBe("function");
		expect(typeof patterns.memory.vectorIndex).toBe("function");
		expect(typeof patterns.memory.knowledgeGraph).toBe("function");
		expect(typeof patterns.memory.decay).toBe("function");
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
	});

	it("exports core sugar helpers", () => {
		expect(typeof core.state).toBe("function");
		expect(typeof core.producer).toBe("function");
		expect(typeof core.derived).toBe("function");
		expect(typeof core.effect).toBe("function");
		expect(typeof core.pipe).toBe("function");
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
