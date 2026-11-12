/** Pure offline reporting. Never executes consumer or observer. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { correlateCpuTrace } from "./causal-cpu-trace.mjs";
import { relation } from "./causal-event-correlation.mjs";
export function phases(e, samples = []) {
	assert.equal(e.units, "performance-ms/hrtime-ns/trace-us");
	assert.equal(e.cpuUnits, "microseconds");
	assert.deepEqual(e.thread, { isMainThread: true, threadId: 0 });
	assert.equal(e.complete, true);
	assert.equal(e.active, null);
	assert.equal(e.error, null);
	assert.ok(["Q", "T"].includes(e.mode));
	assert.ok(["fixture", "consumer"].includes(e.profile));
	const expected =
		e.profile === "fixture"
			? ["empty", "cpu", "yield"]
			: Array.from({ length: 6 }, (_, b) =>
					["warmup", "measured"].map((p) => `b${Math.floor(b / 2)}s${b % 2}-${p}`),
				).flat();
	assert.deepEqual(
		e.windows.map((w) => w.name),
		expected,
	);
	let last = -1,
		previous = null;
	const rows = e.windows.map((w, number) => {
		const a = w.before,
			b = w.after;
		for (const snap of [a, b]) {
			assert.ok(
				Number.isFinite(snap.p0) && snap.p0 >= 0 && snap.p0 <= snap.p1 && Number.isFinite(snap.p1),
			);
			assert.deepEqual(Object.keys(snap.thread).sort(), ["system", "user"]);
			for (const value of [...Object.values(snap.thread), ...Object.values(snap.process)])
				assert.ok(Number.isSafeInteger(value) && value >= 0);
			for (const key of [
				"userCPUTime",
				"systemCPUTime",
				"voluntaryContextSwitches",
				"involuntaryContextSwitches",
				"minorPageFault",
				"majorPageFault",
			])
				assert.ok(Object.hasOwn(snap.process, key));
		}
		assert.ok(a.p0 > last && a.p1 <= b.p0);
		last = b.p1;
		assert.equal(w.start, a.p1);
		assert.equal(w.end, b.p0);
		assert.deepEqual(Object.keys(a.process).sort(), Object.keys(b.process).sort());
		if (previous)
			for (const group of ["thread", "process"]) {
				assert.deepEqual(Object.keys(a[group]).sort(), Object.keys(previous[group]).sort());
				for (const key of Object.keys(a[group])) assert.ok(a[group][key] >= previous[group][key]);
			}
		previous = b;
		for (const key of ["user", "system"]) assert.ok(b.thread[key] >= a.thread[key]);
		for (const key of Object.keys(a.process)) assert.ok(b.process[key] >= a.process[key]);
		const T = (b.thread.user + b.thread.system - a.thread.user - a.thread.system) / 1000;
		const P =
			(b.process.userCPUTime +
				b.process.systemCPUTime -
				a.process.userCPUTime -
				a.process.systemCPUTime) /
			1000;
		const Wlo = b.p0 - a.p1,
			Whi = b.p1 - a.p0,
			Wpoint = (Wlo + Whi) / 2;
		const data =
			e.profile === "consumer"
				? samples.slice(
						Math.floor(number / 2) * 400 + (number % 2 ? 100 : 0),
						Math.floor(number / 2) * 400 + (number % 2 ? 400 : 100),
					)
				: [];
		if (e.profile === "consumer") {
			assert.ok(["U", "V"].includes(e.orientation));
			assert.equal(data.length, number % 2 ? 300 : 100);
			const batch = Math.floor(number / 4),
				slot = Math.floor(number / 2) % 2;
			const first = (batch !== 1) === (e.orientation === "U") ? "candidate" : "reference";
			const arm = slot === 0 ? first : first === "candidate" ? "reference" : "candidate";
			data.forEach((x, i) => {
				assert.equal(x.batch, batch);
				assert.equal(x.arm, arm);
				assert.equal(x.index, i + (number % 2 ? 100 : 0));
				assert.equal(x.phase, number % 2 ? "measured" : "warmup");
				assert.ok(
					Number.isFinite(x.start) &&
						Number.isFinite(x.end) &&
						x.start >= w.start &&
						x.start <= x.end &&
						x.end <= w.end,
				);
				assert.equal(x.ms, x.end - x.start);
				if (i) assert.ok(x.start >= data[i - 1].end);
			});
		}
		const sorted = data.map((x) => x.ms).sort((a, b) => a - b),
			n = sorted.length;
		return {
			name: w.name,
			T,
			P,
			Wlo,
			Whi,
			Wpoint,
			unaccountedElapsed: Wpoint - T,
			processMinusThread: P - T,
			snapshotWidths: [a.p1 - a.p0, b.p1 - b.p0],
			resourceDeltas: Object.fromEntries(
				[
					"voluntaryContextSwitches",
					"involuntaryContextSwitches",
					"minorPageFault",
					"majorPageFault",
				].map((k) => [k, b.process[k] - a.process[k]]),
			),
			samples: n,
			constructionMs: data.reduce((s, x) => s + x.ms, 0),
			p50: n ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null,
			p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
		};
	});
	if (e.profile === "consumer") assert.equal(samples.length, 2400);
	else assert.equal(samples.length, 0);
	if (e.mode === "Q") {
		assert.deepEqual(e.anchors, []);
		for (const w of e.windows) assert.ok(!("begin" in w) && !("finish" in w));
	}
	return rows;
}
export function report(root) {
	const load = (name) => JSON.parse(readFileSync(`${root}/${name}`, "utf8"));
	const e = load("evidence.json");
	const samples =
		e.profile === "consumer"
			? readFileSync(`${root}/samples.jsonl`, "utf8").trim().split("\n").map(JSON.parse)
			: [];
	const cpu = phases(e, samples);
	let trace = { status: "not-enabled" };
	if (e.mode === "T") {
		try {
			const manifest = load("trace-manifest.json");
			trace = correlateCpuTrace(
				readFileSync(`${root}/trace-1.json`, "utf8"),
				readFileSync(`${root}/evidence.json`, "utf8"),
				manifest,
			);
			if (trace.status === "calibrated")
				trace.sampleRelations = samples.map((x) =>
					trace.events.map((ev) =>
						ev.start < Number(BigInt(e.anchors[0].h) / 1000n) ||
						ev.end > Number((BigInt(e.anchors[2].h) + 999n) / 1000n)
							? "unknown"
							: relation([ev.start, ev.end], x, trace.deltaUs).status,
					),
				);
		} catch (error) {
			trace = { status: "unknown", reason: String(error.message), samples: null };
		}
	}
	return { cpu, trace, performanceQualification: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assert.equal(process.argv.length, 3);
	console.log(JSON.stringify(report(process.argv[2])));
}
