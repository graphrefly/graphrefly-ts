import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	calibrate,
	correlateTrace,
	hash,
	legacyCorrelation,
	relation,
} from "./causal-event-correlation.mjs";

function fixture() {
	const identity = {
		run: "synthetic",
		pid: 42,
		node: "v24.18.0",
		v8: "13.6.233.17-node.50",
		sourceDigest: "a".repeat(64),
	};
	const specs = [
		["empty", 110, 120, 213, 217],
		["gc", 250, 260, 352, 358],
		["deopt", 300, 310, 402, 408],
	];
	const evidence = {
		identity,
		units: "performance-ms/hrtime-ns/trace-us",
		anchors: [
			[100, 102, 201],
			[200, 202, 301],
			[400, 402, 501],
		].map(([p0, p1, h]) => ({ p0: p0 / 1000, p1: p1 / 1000, h: String(h * 1000) })),
		windows: specs.map(([name, start, end, a, b]) => ({
			name,
			start: start / 1000,
			end: end / 1000,
			begin: [String((a - 1) * 1000), String((a + 1) * 1000)],
			finish: [String((b - 1) * 1000), String((b + 1) * 1000)],
		})),
	};
	const e = (name, ts, ph, cat, extra = {}) => ({ name, ts, ph, cat, pid: 42, tid: 7, ...extra });
	const trace = {
		traceEvents: [
			e("thread_name", 0, "M", "__metadata", { args: { name: "JavaScriptMainThread" } }),
			...specs.flatMap(([name, , , a, b]) => [
				e(`synthetic:${name}`, a, "B", "node,node.console"),
				e(`synthetic:${name}`, b, "E", "node,node.console"),
			]),
			e("MajorGC", 354, "X", "v8", { dur: 2 }),
			e("V8.DeoptimizeCode", 404, "X", "v8", { dur: 2 }),
		].sort((a, b) => a.ts - b.ts),
	};
	return { evidence, trace, identity };
}
function bound(f) {
	const t = JSON.stringify(f.trace),
		e = JSON.stringify(f.evidence);
	return [
		t,
		e,
		{
			identity: structuredClone(f.identity),
			traceDigest: hash(t),
			evidenceDigest: hash(e),
			traceFiles: ["trace-1.json"],
			exitCode: 0,
			timedOut: false,
		},
	];
}
test("approved diagnostic design vectors propagate interval uncertainty", () => {
	const v = JSON.parse(readFileSync("docs/design/causal-event-clock-repair-v1/vectors.json"));
	for (const c of v.cases.filter((c) => c.event))
		assert.equal(
			relation(c.event, { start: 0.25, end: 0.26 }, c.delta_override ?? v.expected_delta).status,
			c.expected,
			c.id,
		);
});
test("X and nested B/E positive paths plus observed-event negative control", () => {
	const f = fixture(),
		r = correlateTrace(...bound(f));
	assert.equal(r.status, "calibrated", r.reason);
	assert.deepEqual(r.deltaUs, [99, 101]);
	assert.equal(r.samples[0].events[0].status, "disjoint");
	assert.equal(r.samples[1].events[0].status, "overlap");
	const e = f.trace.traceEvents.find((e) => e.name === "MajorGC");
	e.ph = "B";
	delete e.dur;
	f.trace.traceEvents.push({ ...e, ph: "E", ts: 356 });
	f.trace.traceEvents.sort((a, b) => a.ts - b.ts);
	assert.equal(correlateTrace(...bound(f)).status, "calibrated");
});
const corruptions = {
	"missing anchor": (f) => f.evidence.anchors.pop(),
	"empty intersection": (f) => {
		f.evidence.anchors[1].h = "330000";
	},
	"anchor order": (f) => {
		f.evidence.anchors[1].p0 = 0.09;
	},
	units: (f) => {
		f.evidence.units = "ns";
	},
	"anchor inside window": (f) => {
		f.evidence.windows[1].start = 0.19;
	},
	"source identity": (f) => {
		f.evidence.identity = { ...f.identity, sourceDigest: "b".repeat(64) };
	},
	version: (f) => {
		f.identity.node = "v25.0.0";
	},
	phase: (f) => {
		f.trace.traceEvents.find((e) => e.name === "MajorGC").ph = "b";
	},
	"negative duration": (f) => {
		f.trace.traceEvents.find((e) => e.name === "MajorGC").dur = -1;
	},
	duplicate: (f) => {
		f.trace.traceEvents.splice(4, 0, { ...f.trace.traceEvents[4] });
	},
	"missing E": (f) => {
		f.trace.traceEvents = f.trace.traceEvents.filter((e) => !(e.ph === "E" && e.ts === 358));
	},
	"marker thread": (f) => {
		f.trace.traceEvents.find((e) => e.ph === "B").tid = 9;
	},
	"marker clock": (f) => {
		f.evidence.windows[0].begin = ["999000", "999010"];
	},
};
for (const [name, change] of Object.entries(corruptions))
	test(`invalid evidence unknown: ${name}`, () => {
		const f = fixture();
		change(f);
		assert.equal(correlateTrace(...bound(f)).status, "unknown");
	});
test("manifest bindings, timeout, rotation and truncation reject", () => {
	for (const change of [
		(m) => {
			m.identity.run = "other";
		},
		(m) => {
			m.identity.pid++;
		},
		(m) => {
			m.traceDigest = "bad";
		},
		(m) => {
			m.evidenceDigest = "bad";
		},
		(m) => {
			m.timedOut = true;
		},
		(m) => {
			m.exitCode = 1;
		},
		(m) => {
			m.traceFiles.push("trace-2.json");
		},
	]) {
		const a = bound(fixture());
		change(a[2]);
		assert.equal(correlateTrace(...a).status, "unknown");
	}
	const a = bound(fixture());
	a[0] = a[0].slice(0, -2);
	a[2].traceDigest = hash(a[0]);
	assert.equal(correlateTrace(...a).status, "unknown");
});
test("legacy empty logs and numeric offsets cannot claim no events", () => {
	for (const logs of [
		["", ""],
		["[1:x] 123 ms: Scavenge, 2.00 / 0.00 ms", "code-deopt,124000,more"],
	]) {
		const r = legacyCorrelation([{ phase: "measured", start: 20, end: 25 }], ...logs, 100);
		assert.equal(r.status, "unknown");
		assert.equal(r.samples[0].gc, null);
	}
});
test("wide uncertainty and precision are load-bearing", () => {
	assert.equal(relation([354, 356], { start: 0.25, end: 0.26 }, [90, 110]).status, "possible");
	assert.equal(relation([349, 350], { start: 0.25, end: 0.26 }, [99, 101]).status, "possible");
	assert.throws(() => calibrate([], []), /three anchors/);
});

test("cross-clock contradictions, missing categories, rotation loss and zero windows", () => {
	for (const mutate of [
		(f) => {
			for (const a of f.evidence.anchors) a.h = String(BigInt(a.h) - 200000n);
		},
		(f) => {
			f.trace.traceEvents = f.trace.traceEvents.filter((e) => e.name !== "V8.DeoptimizeCode");
		},
		(f) => {
			f.trace.traceEvents = f.trace.traceEvents.filter((e) => e.name !== "MajorGC");
		},
	]) {
		const f = fixture();
		mutate(f);
		assert.equal(correlateTrace(...bound(f)).status, "unknown");
	}
	const args = bound(fixture());
	args[2].traceFiles = ["trace-2.json"];
	assert.equal(correlateTrace(...args).status, "unknown");
	assert.equal(relation([354, 356], { start: 0.255, end: 0.255 }, [99, 101]).status, "possible");
});
