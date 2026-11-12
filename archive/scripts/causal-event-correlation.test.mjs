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
				e(`time::synthetic:${name}`, a, "b", "node,node.console", { id: "0x0" }),
				e(`time::synthetic:${name}`, b, "e", "node,node.console", { id: "0x0" }),
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
		f.trace.traceEvents = f.trace.traceEvents.filter((e) => !(e.ph === "e" && e.ts === 358));
	},
	"marker thread": (f) => {
		f.trace.traceEvents.find((e) => e.ph === "b").tid = 9;
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

test("six loaded helper mutations are detected without another capture process", async () => {
	const source = readFileSync(new URL("./causal-event-correlation.mjs", import.meta.url), "utf8");
	const baseline = readFileSync(
		"archive/evals/causal-event-clock-repair-v1/source/baseline-performance-report.mjs",
		"utf8",
	);
	const old = baseline
		.slice(baseline.indexOf("export function correlate("))
		.replace("export function correlate(", "export function legacyCorrelation(");
	const sample = [{ phase: "measured", start: 20, end: 25 }];
	const mutations = [
		[
			"uptime-only",
			source.slice(0, source.indexOf("export function legacyCorrelation(")) +
				old +
				source.slice(source.indexOf("/** manifest")),
			(m) =>
				assert.equal(
					m.legacyCorrelation(
						sample,
						"[12:0x0] 123 ms: Scavenge 1 -> 2 MB, 2.00 / 0.00 ms",
						"code-deopt,124000,more",
						100,
					).samples[0].gc,
					null,
				),
		],
		[
			"identity-check-removed",
			source.replace('assert.deepEqual(evidence.identity, manifest.identity, "run identity");', ""),
			(m) => {
				const a = bound(fixture());
				a[2].identity.run = "other";
				assert.equal(m.correlateTrace(...a).status, "unknown");
			},
		],
		[
			"offset-sign-reversed",
			source.replaceAll("- dU", "+ dU").replaceAll("- dL", "+ dL"),
			(m) =>
				assert.equal(
					m.relation([354, 356], { start: 0.25, end: 0.26 }, [99, 101]).status,
					"overlap",
				),
		],
		[
			"precision-removed",
			source
				.replace("a - 1 - dU, a + 1 - dL", "a - dU, a - dL")
				.replace("b - 1 - dU, b + 1 - dL", "b - dU, b - dL"),
			(m) =>
				assert.equal(
					m.relation([362, 364], { start: 0.25, end: 0.26 }, [99, 101]).status,
					"possible",
				),
		],
		[
			"missing-as-empty",
			source.replace("gc: null,", "gc: [],"),
			(m) => assert.equal(m.legacyCorrelation(sample, "", "").samples[0].gc, null),
		],
		[
			"uncertainty-midpoint",
			source.replace(
				"[dL, dU] = delta;",
				"[dL, dU] = [ (delta[0]+delta[1])/2, (delta[0]+delta[1])/2 ];",
			),
			(m) =>
				assert.equal(
					m.relation([354, 356], { start: 0.25, end: 0.26 }, [90, 110]).status,
					"possible",
				),
		],
	];
	for (const [name, changed, check] of mutations) {
		assert.notEqual(changed, source, `${name} applied`);
		const loaded = await import(
			`data:text/javascript;base64,${Buffer.from(changed).toString("base64")}#${name}`
		);
		assert.throws(() => check(loaded), assert.AssertionError, `${name} must break behavior`);
	}
	const capture = "archive/evals/causal-event-clock-repair-v1/capture/";
	const manifest = JSON.parse(readFileSync(capture + "manifest.json"));
	const real = correlateTrace(
		readFileSync(capture + manifest.traceFiles[0], "utf8"),
		readFileSync(capture + "evidence.json", "utf8"),
		manifest,
	);
	assert.equal(real.status, "calibrated", real.reason);
	assert.equal(real.markers.length, 3);
	assert.ok(real.samples[1].events.some((e) => e.name === "MajorGC" && e.status === "overlap"));
	assert.ok(
		real.samples[2].events.some((e) => e.name === "V8.DeoptimizeCode" && e.status === "overlap"),
	);
	assert.ok(real.samples[0].events.some((e) => e.status === "disjoint"));
});

test("shifted anchors cannot leave markers outside their enclosing windows", () => {
	const f = fixture();
	for (const a of f.evidence.anchors) a.h = String(BigInt(a.h) + 9000n);
	const r = correlateTrace(...bound(f));
	assert.equal(r.status, "unknown");
	assert.match(r.reason, /enclosure/);
});

function captured() {
	const dir = "archive/evals/causal-event-clock-repair-v1/capture/";
	return {
		trace: JSON.parse(readFileSync(dir + "trace-1.json")),
		evidence: JSON.parse(readFileSync(dir + "evidence.json")),
		identity: JSON.parse(readFileSync(dir + "manifest.json")).identity,
	};
}
function consoleEnd(f) {
	return f.trace.traceEvents.find((e) => e.ph === "e" && e.cat === "node,node.console");
}
const markerCorruptions = {
	"duplicate begin": (f) => {
		const i = f.trace.traceEvents.findIndex((e) => e.ph === "b");
		f.trace.traceEvents.splice(i, 0, { ...f.trace.traceEvents[i] });
	},
	"orphan end": (f) => {
		const i = f.trace.traceEvents.findIndex((e) => e.ph === "b");
		f.trace.traceEvents.splice(i, 1);
	},
	"unclosed begin": (f) => {
		const i = f.trace.traceEvents.findIndex((e) => e.ph === "e");
		f.trace.traceEvents.splice(i, 1);
	},
	"different id": (f) => {
		consoleEnd(f).id = "0x1";
	},
	"missing id": (f) => {
		delete consoleEnd(f).id;
	},
	"different run": (f) => {
		consoleEnd(f).name = "time::other:empty";
	},
	"different window": (f) => {
		consoleEnd(f).name = consoleEnd(f).name.replace(":empty", ":gc");
	},
	"different category": (f) => {
		consoleEnd(f).cat = "node.console";
	},
	"different pid": (f) => {
		consoleEnd(f).pid++;
	},
	"different tid": (f) => {
		consoleEnd(f).tid++;
	},
	"synchronous masquerade": (f) => {
		consoleEnd(f).ph = "E";
	},
	"unsupported async scope": (f) => {
		consoleEnd(f).scope = "foreign";
	},
	"ambiguous id2": (f) => {
		consoleEnd(f).id2 = { global: "0x0" };
	},
	"duplicate completed pair": (f) => {
		const begin = f.trace.traceEvents.find((e) => e.ph === "b"),
			end = consoleEnd(f);
		f.trace.traceEvents.push({ ...begin }, { ...end });
		f.trace.traceEvents.sort((a, b) => a.ts - b.ts);
	},
};
for (const [name, corrupt] of Object.entries(markerCorruptions))
	test(`retained console identity rejects ${name}`, () => {
		const f = captured();
		corrupt(f);
		const r = correlateTrace(...bound(f));
		assert.equal(r.status, "unknown", name);
	});
test("four loaded marker mutations fail on the retained real trace", async () => {
	const source = readFileSync(new URL("./causal-event-correlation.mjs", import.meta.url), "utf8");
	const mutations = [
		[
			"id-coordinate-omitted",
			source.replace("e.pid, e.tid, e.id]", "e.pid, e.tid]"),
			"different id",
		],
		[
			"duplicate-begin-check-removed",
			source.replace('assert.ok(!pendingMarkers.has(markerKey), "duplicate console begin");', ""),
			"duplicate begin",
		],
		[
			"marker-thread-check-removed",
			source
				.replace('assert.ok(e.pid === pid && e.tid === tid, "console marker process/thread");', "")
				.replace("e.pid, e.tid, e.id]", "e.pid, e.id]"),
			"different tid",
		],
		[
			"unsupported-id-scope-accepted",
			source.replace(
				'assert.ok(e.id2 === undefined && e.scope === undefined, "unsupported console id scope");',
				"",
			),
			"ambiguous id2",
		],
	];
	for (const [name, changed, bad] of mutations) {
		assert.notEqual(changed, source, name);
		const m = await import(
			`data:text/javascript;base64,${Buffer.from(changed).toString("base64")}#${name}`
		);
		const f = captured();
		markerCorruptions[bad](f);
		assert.equal(
			m.correlateTrace(...bound(f)).status,
			"calibrated",
			`${name} actually bypassed guard`,
		);
		assert.equal(
			correlateTrace(...bound(f)).status,
			"unknown",
			`${name} intact behavior detects fault`,
		);
	}
});
