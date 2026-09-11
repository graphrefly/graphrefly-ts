/** Private, conservative event association. No consumer/runtime imports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const names = new Set(["MinorGC", "MajorGC", "V8.DeoptimizeCode"]);
const finite = (x) => assert.ok(Number.isFinite(x), "non-finite clock");
const ns = (x) => {
	assert.match(x, /^\d+$/, "integer nanoseconds");
	const n = BigInt(x);
	assert.ok(n <= BigInt(Number.MAX_SAFE_INTEGER) * 1000n, "hrtime range");
	return [Number(n / 1000n), Number((n + 999n) / 1000n)];
};
export function calibrate(anchors, windows) {
	assert.equal(anchors.length, 3, "three anchors required");
	let low = -Infinity,
		high = Infinity,
		lastP = -Infinity,
		lastH = -1n;
	for (const a of anchors) {
		finite(a.p0);
		finite(a.p1);
		assert.ok(a.p0 <= a.p1 && a.p0 > lastP && BigInt(a.h) > lastH, "anchor order");
		const [h0, h1] = ns(a.h);
		low = Math.max(low, h0 - Math.ceil(a.p1 * 1000));
		high = Math.min(high, h1 - Math.floor(a.p0 * 1000));
		lastP = a.p1;
		lastH = BigInt(a.h);
	}
	assert.ok(low <= high, "empty calibration intersection");
	let previousEnd = -Infinity;
	for (const w of windows) {
		finite(w.start);
		finite(w.end);
		assert.ok(w.start <= w.end && w.start > previousEnd, "window order");
		assert.ok(w.start > anchors[0].p1 && w.end < anchors[2].p0, "anchor coverage");
		assert.ok(
			anchors.every((a) => a.p1 < w.start || a.p0 > w.end),
			"anchor inside window",
		);
		previousEnd = w.end;
	}
	return [low, high];
}
export function relation(event, window, delta) {
	const [a, b] = event,
		[dL, dU] = delta;
	for (const x of [...event, ...delta, window.start, window.end]) finite(x);
	assert.ok(a <= b && dL <= dU && window.start <= window.end, "interval order");
	const start = [a - 1 - dU, a + 1 - dL];
	const end = [b - 1 - dU, b + 1 - dL];
	const ws = [Math.floor(window.start * 1000), Math.ceil(window.start * 1000)];
	const we = [Math.floor(window.end * 1000), Math.ceil(window.end * 1000)];
	const status =
		end[1] < ws[0] || start[0] > we[1]
			? "disjoint"
			: a < b && window.start < window.end && start[1] < we[0] && end[0] > ws[1]
				? "overlap"
				: "possible";
	return { status, start, end };
}

/** Native text timestamps deliberately remain in their distinct, uncalibrated clock domains. */
export function legacyCorrelation(samples, gcLog, v8Log) {
	return {
		status: "unknown",
		reason: "native-clock-origins-not-calibrated",
		sources: {
			gc: { digest: hash(gcLog), clock: "V8 isolate GC log / ms" },
			deopt: { digest: hash(v8Log), clock: "V8 logger / us" },
		},
		gcEvents: [...gcLog.matchAll(/\]\s+(\d+) ms:.*?,\s*([\d.]+)\s*\/\s*[\d.]+ ms/g)].map((m) => ({
			nativeEndMs: Number(m[1]),
			reportedDurationMs: Number(m[2]),
			line: m[0],
		})),
		deoptEvents: v8Log
			.split("\n")
			.flatMap((line, index) =>
				line.startsWith("code-deopt,")
					? [{ nativeAtUs: Number(line.split(",")[1]), line, index }]
					: [],
			),
		samples: samples
			.filter((s) => s.phase === "measured")
			.map(({ arm, batch, index }) => ({
				arm,
				batch,
				index,
				status: "unknown",
				gc: null,
				deopt: null,
			})),
	};
}

/** manifest is the supervisor's evidence binding, not permission supplied by a reporter. */
export function correlateTrace(traceText, evidenceText, manifest) {
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
			["empty", "gc", "deopt"],
			"fixture windows",
		);
		const delta = calibrate(evidence.anchors, evidence.windows);
		const raw = JSON.parse(traceText).traceEvents;
		assert.ok(Array.isArray(raw), "trace events");
		const pid = evidence.identity.pid;
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
		const stack = [],
			spans = [],
			background = [],
			seen = new Set();
		let last = -Infinity;
		for (let i = 0; i < raw.length; i++) {
			const e = raw[i];
			if (e.ph === "M") continue;
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
		for (const w of evidence.windows) {
			const matches = spans.filter(
				(e) =>
					e.name === `${evidence.identity.run}:${w.name}` &&
					e.cat.split(",").includes("node.console"),
			);
			assert.equal(matches.length, 1, "unique fixture marker");
			assert.ok(BigInt(w.begin[1]) <= BigInt(w.finish[0]), "marker lifecycle order");
			for (const a of evidence.anchors) {
				if (a.p1 < w.start) assert.ok(BigInt(a.h) < BigInt(w.begin[0]), "cross-clock anchor order");
				if (a.p0 > w.end) assert.ok(BigInt(a.h) > BigInt(w.finish[1]), "cross-clock anchor order");
			}
			assert.notEqual(
				relation([matches[0].start, matches[0].end], w, delta).status,
				"disjoint",
				"marker/window clock contradiction",
			);
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
		assert.ok(
			events.some((e) => e.name === "MajorGC" || e.name === "MinorGC"),
			"missing GC coverage",
		);
		assert.ok(
			events.some((e) => e.name === "V8.DeoptimizeCode"),
			"missing deopt coverage",
		);
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
			events,
			backgroundRefs: background,
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
