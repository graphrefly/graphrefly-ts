/**
 * Smoke-test the substrate barrel exports (@graphrefly/pure-ts).
 *
 * Post-cleave A2: pure-ts exports core, graph, extra (substrate only).
 * Presentation exports (patterns, compat) moved to @graphrefly/graphrefly.
 * Presentation export tests moved to root src/__tests__/base/exports.test.ts.
 */
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
	policy,
	rescue,
	throttle,
	throttleTime,
	version,
} from "../index.js";

describe("graphrefly substrate (pure-ts)", () => {
	it("exports version", () => {
		expect(version).toBe("0.0.0");
	});

	it("exports layer namespaces", () => {
		expect(typeof core).toBe("object");
		expect(typeof graph).toBe("object");
		expect(typeof extra).toBe("object");
		expect(typeof graph.Graph).toBe("function");
		expect(typeof map).toBe("function");
	});

	it("exports core sugar helpers", () => {
		expect(typeof core.pipe).toBe("function");
		expect(typeof core.dynamicNode).toBe("function");
		expect(typeof core.autoTrackNode).toBe("function");
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

	it("RxJS alias identity (substrate operators)", () => {
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
