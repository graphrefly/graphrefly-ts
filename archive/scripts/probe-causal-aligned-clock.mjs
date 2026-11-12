/** Bounded known-function clock probe. No Graph imports or consumer execution. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";

const [kind, output] = process.argv.slice(2);
assert.ok(["CPU", "GC"].includes(kind));
const put = (name, value) =>
	writeFileSync(`${output}/${name}`, JSON.stringify(value) + "\n", { flag: "wx" });
put("process.json", {
	pid: process.pid,
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	timeOrigin: performance.timeOrigin,
});
if (kind === "CPU") {
	const session = new Session();
	let profile, failure, disconnectFailure;
	const bounds = {};
	const windows = [];
	let sink = 0;
	const post = (name, args = {}) =>
		new Promise((resolve, reject) =>
			session.post(name, args, (e, v) => (e ? reject(e) : resolve(v))),
		);
	function knownArithmeticPhase() {
		const start = performance.now();
		let n = 1;
		do {
			for (let i = 0; i < 512; i++) n = (Math.imul(n ^ i, 1664525) + 1013904223) | 0;
		} while (performance.now() - start < 75);
		sink ^= n;
		windows.push({ name: "knownArithmeticPhase", start, end: performance.now() });
	}
	function knownStringPhase() {
		const start = performance.now();
		let n = 0;
		do {
			for (let i = 0; i < 128; i++) n += String(i + sink).length;
		} while (performance.now() - start < 75);
		sink ^= n;
		windows.push({ name: "knownStringPhase", start, end: performance.now() });
	}
	try {
		session.connect();
		await post("Profiler.enable");
		await post("Profiler.setSamplingInterval", { interval: 250 });
		bounds.startBefore = performance.now();
		await post("Profiler.start");
		bounds.startAfter = performance.now();
		knownArithmeticPhase();
		knownStringPhase();
		bounds.stopBefore = performance.now();
		({ profile } = await post("Profiler.stop"));
		bounds.stopAfter = performance.now();
	} catch (e) {
		failure = { name: e.name, message: e.message, stack: e.stack };
	} finally {
		try {
			session.disconnect();
		} catch (e) {
			disconnectFailure = { name: e.name, message: e.message };
		}
	}
	put("probe.json", { kind, bounds, windows, sink, failure, disconnectFailure });
	if (profile) put("profile.json", profile);
	if (failure || disconnectFailure) process.exitCode = 1;
} else {
	assert.equal(typeof globalThis.gc, "function");
	const events = [];
	let fault;
	const observer = new PerformanceObserver((list) => {
		try {
			for (const e of list.getEntries()) {
				assert.ok(events.length < 100000);
				events.push({
					startTime: e.startTime,
					duration: e.duration,
					detail: e.detail,
					receivedAt: performance.now(),
				});
			}
		} catch (e) {
			fault = { message: e.message };
		}
	});
	observer.observe({ entryTypes: ["gc"] });
	const windows = [];
	for (let i = 0; i < 2; i++) {
		const start = performance.now();
		globalThis.gc();
		windows.push({ start, end: performance.now() });
	}
	await setImmediate();
	await setImmediate();
	for (const e of observer.takeRecords())
		events.push({
			startTime: e.startTime,
			duration: e.duration,
			detail: e.detail,
			receivedAt: performance.now(),
		});
	observer.disconnect();
	put("probe.json", { kind, events, windows, fault });
	if (fault || events.length === 0) process.exitCode = 1;
}
