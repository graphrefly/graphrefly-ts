/** Separate consumer/observer trace profiles; original fixture validator unchanged. */
import assert from "node:assert/strict";
import { calibrate, hash, relation } from "./causal-event-correlation.mjs";

const names = new Set(["MinorGC", "MajorGC", "V8.DeoptimizeCode"]);
const finite = (x) => assert.ok(Number.isFinite(x));
const ns = (x) => {
	assert.match(x, /^\d+$/);
	const n = BigInt(x);
	assert.ok(n <= BigInt(Number.MAX_SAFE_INTEGER) * 1000n);
	return [Number(n / 1000n), Number((n + 999n) / 1000n)];
};
function expectedNames(e) {
	assert.ok(["fixture", "consumer"].includes(e.profile));
	return e.profile === "fixture"
		? ["empty", "cpu", "yield"]
		: Array.from({ length: 6 }, (_, b) =>
				["warmup", "measured"].map((p) => `b${Math.floor(b / 2)}s${b % 2}-${p}`),
			).flat();
}
export function correlateCpuTrace(traceText, evidenceText, manifest) {
	try {
		assert.ok(Buffer.byteLength(traceText) <= 16 * 1024 * 1024, "trace exceeds parser limit");
		assert.equal(manifest.exitCode, 0, "abnormal exit");
		assert.equal(manifest.timedOut, false, "timeout");
		assert.deepEqual(manifest.traceFiles, ["trace-1.json"], "trace rotation coverage");
		assert.equal(hash(traceText), manifest.traceDigest, "trace digest");
		assert.equal(hash(evidenceText), manifest.evidenceDigest, "evidence digest");
		const evidence = JSON.parse(evidenceText);
		assert.deepEqual(evidence.identity, manifest.identity, "run identity");
		assert.equal(evidence.identity.node, "v24.18.0", "unsupported Node version");
		assert.equal(evidence.identity.v8, "13.6.233.17-node.50", "unsupported V8 version");
		assert.match(evidence.identity.run, /^[a-z0-9-]+$/i, "run id");
		assert.match(evidence.identity.sourceDigest, /^[a-f0-9]{64}$/, "source binding");
		assert.equal(evidence.units, "performance-ms/hrtime-ns/trace-us", "units");
		assert.deepEqual(
			evidence.windows.map((w) => w.name),
			expectedNames(evidence),
			"fixture windows",
		);
		const delta = calibrate(evidence.anchors, evidence.windows);
		const middle = evidence.profile === "fixture" ? 2 : 6;
		assert.ok(
			evidence.anchors[1].p0 > evidence.windows[middle - 1].end &&
				evidence.anchors[1].p1 < evidence.windows[middle].start,
			"fixed middle anchor gap",
		);
		const raw = JSON.parse(traceText).traceEvents;
		assert.ok(Array.isArray(raw), "trace events");
		const pid = evidence.identity.pid;
		assert.ok(Number.isSafeInteger(pid) && pid > 0, "PID integer");
		const threads = new Set(
			raw
				.filter(
					(e) =>
						e.ph === "M" &&
						e.pid === pid &&
						e.name === "thread_name" &&
						e.args?.name === "JavaScriptMainThread",
				)
				.map((e) => e.tid),
		);
		assert.equal(threads.size, 1, "unique main thread");
		const tid = [...threads][0];
		assert.ok(Number.isSafeInteger(tid) && tid > 0, "TID integer");
		const markerNames = new Set(
			evidence.windows.map((w) => `time::${evidence.identity.run}:${w.name}`),
		);
		const pendingMarkers = new Map(),
			markers = [];
		const stack = [],
			spans = [],
			background = [],
			seen = new Set();
		let last = -Infinity;
		for (let i = 0; i < raw.length; i++) {
			const e = raw[i];
			if (e.ph === "M") continue;
			// Node v24.18 console timers are asynchronous identities, never synchronous stack frames.
			if (e.cat?.split(",").includes("node.console") || e.name?.startsWith("time::")) {
				assert.ok(e.pid === pid && e.tid === tid, "console marker process/thread");
				assert.ok(markerNames.has(e.name), "console marker run/name");
				assert.equal(e.cat, "node,node.console", "console marker category");
				assert.match(e.id, /^0x[0-9a-f]+$/, "console marker id");
				assert.ok(e.id2 === undefined && e.scope === undefined, "unsupported console id scope");
				assert.ok(e.ph === "b" || e.ph === "e", "console marker phase");
				finite(e.ts);
				assert.ok(e.ts >= last, "trace clock order");
				last = e.ts;
				const markerKey = JSON.stringify([e.name, e.cat, e.pid, e.tid, e.id]);
				if (e.ph === "b") {
					assert.ok(!pendingMarkers.has(markerKey), "duplicate console begin");
					pendingMarkers.set(markerKey, { ...e, ref: i });
				} else {
					const begin = pendingMarkers.get(markerKey);
					assert.ok(begin, "orphan console end");
					pendingMarkers.delete(markerKey);
					markers.push({
						name: e.name,
						cat: e.cat,
						pid: e.pid,
						tid: e.tid,
						id: e.id,
						start: begin.ts,
						end: e.ts,
						refs: [begin.ref, i],
					});
				}
				continue;
			}
			if (e.pid !== pid) {
				assert.ok(!names.has(e.name), "foreign PID event");
				continue;
			}
			if (e.tid !== tid) {
				if (names.has(e.name)) background.push(i);
				continue;
			}
			finite(e.ts);
			assert.ok(e.ts >= last, "trace clock order");
			last = e.ts;
			if (!["B", "E", "X"].includes(e.ph)) {
				assert.ok(!names.has(e.name), "unsupported event phase");
				continue;
			}
			const key = JSON.stringify(e);
			assert.ok(!seen.has(key), "duplicate event");
			seen.add(key);
			if (e.ph === "B") stack.push({ ...e, ref: i });
			else if (e.ph === "E") {
				const begin = stack.pop();
				assert.ok(
					begin && (!e.name || e.name === begin.name) && e.cat === begin.cat,
					"unmatched trace span",
				);
				spans.push({
					name: begin.name,
					cat: begin.cat,
					start: begin.ts,
					end: e.ts,
					refs: [begin.ref, i],
				});
			} else {
				finite(e.dur);
				assert.ok(e.dur >= 0, "negative duration");
				spans.push({ name: e.name, cat: e.cat, start: e.ts, end: e.ts + e.dur, refs: [i] });
			}
		}
		assert.equal(stack.length, 0, "unclosed trace span");
		assert.equal(pendingMarkers.size, 0, "unclosed console marker");
		let enclosureLow = delta[0],
			enclosureHigh = delta[1];
		for (const w of evidence.windows) {
			const matches = markers.filter(
				(e) =>
					e.name === `time::${evidence.identity.run}:${w.name}` &&
					e.cat.split(",").includes("node.console"),
			);
			assert.equal(matches.length, 1, "unique fixture marker");
			assert.ok(BigInt(w.begin[1]) <= BigInt(w.finish[0]), "marker lifecycle order");
			for (const a of evidence.anchors) {
				if (a.p1 < w.start) assert.ok(BigInt(a.h) < BigInt(w.begin[0]), "cross-clock anchor order");
				if (a.p0 > w.end) assert.ok(BigInt(a.h) > BigInt(w.finish[1]), "cross-clock anchor order");
			}
			enclosureLow = Math.max(enclosureLow, matches[0].start - 1 - Math.ceil(w.start * 1000));
			enclosureHigh = Math.min(enclosureHigh, matches[0].end + 1 - Math.floor(w.end * 1000));
			assert.ok(enclosureLow <= enclosureHigh, "marker/window enclosure contradiction");

			for (const [endpoint, bracket] of [
				[matches[0].start, w.begin],
				[matches[0].end, w.finish],
			]) {
				assert.ok(BigInt(bracket[0]) <= BigInt(bracket[1]), "marker bracket order");
				assert.ok(
					endpoint >= ns(bracket[0])[0] - 1 && endpoint <= ns(bracket[1])[1] + 1,
					"trace/hrtime marker mismatch",
				);
			}
		}
		const events = spans.filter((e) => names.has(e.name) && e.cat.split(",").includes("v8"));
		const samples = evidence.windows.map((w) => ({
			name: w.name,
			events: events.map((e) => ({
				refs: e.refs,
				name: e.name,
				...(e.start < ns(evidence.anchors[0].h)[0] || e.end > ns(evidence.anchors[2].h)[1]
					? { status: "unknown", reason: "outside calibration coverage", start: null, end: null }
					: relation([e.start, e.end], w, delta)),
			})),
		}));
		return {
			status: "calibrated",
			deltaUs: delta,
			identity: evidence.identity,
			tid,
			traceDigest: manifest.traceDigest,
			evidenceDigest: manifest.evidenceDigest,
			coverage: "recorded supported main-thread spans only; no causal attribution",
			categories: Object.fromEntries(
				["MinorGC", "MajorGC", "V8.DeoptimizeCode"].map((name) => [
					name,
					events.some((e) => e.name === name) ? "observed" : "not-observed",
				]),
			),
			events,
			backgroundRefs: background,
			unclassifiedRefs: raw
				.map((_, i) => i)
				.filter(
					(i) =>
						!events.some((e) => e.refs.includes(i)) &&
						!markers.some((e) => e.refs.includes(i)) &&
						!background.includes(i),
				),
			markers,
			samples,
		};
	} catch (error) {
		return {
			status: "unknown",
			reason: String(error.message),
			traceDigest: manifest?.traceDigest ?? null,
			samples: null,
		};
	}
}
