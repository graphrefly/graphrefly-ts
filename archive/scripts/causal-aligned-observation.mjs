/** Private observer lifecycle. Default real adapters only run at explicit create(). */
import assert from "node:assert/strict";
import { Session } from "node:inspector";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { createObservation } from "./causal-workload-observation.mjs";

function safeBase(condition, orientation) {
	let observer;
	function TrackingObserver(callback) {
		observer = new PerformanceObserver(callback);
		return observer;
	}
	TrackingObserver.supportedEntryTypes = PerformanceObserver.supportedEntryTypes;
	try {
		return createObservation(condition, orientation, {
			now: () => performance.now(),
			cpu: () => process.cpuUsage(),
			Observer: TrackingObserver,
			tick: () => setImmediate(),
		});
	} catch (error) {
		try {
			observer?.disconnect();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], "base setup cleanup");
		}
		throw error;
	}
}
export async function create(
	condition,
	orientation,
	io = {
		now: () => performance.now(),
		hr: () => process.hrtime.bigint(),
		pid: process.pid,
		session: () => new Session(),
		base: safeBase,
		tick: () => setImmediate(),
	},
) {
	assert.ok(["CONTROL", "GC", "GC_CPU"].includes(condition));
	const data = { condition, anchors: [], bounds: {}, pid: io.pid };
	let base,
		session,
		profile,
		finished = false;
	const errors = [];
	const attempt = async (fn) => {
		try {
			return await fn();
		} catch (e) {
			errors.push(e);
		}
	};
	const post = (name, args = {}) =>
		new Promise((resolve, reject) =>
			session.post(name, args, (e, v) => (e ? reject(e) : resolve(v))),
		);
	const anchor = () => {
		const before = io.now(),
			h = io.hr(),
			after = io.now();
		data.anchors.push({ before, h: h.toString(), after, pid: io.pid });
	};
	const finish = async () => {
		assert.ok(!finished);
		finished = true;
		await attempt(() => anchor());
		if (session)
			await attempt(async () => {
				data.bounds.stopBefore = io.now();
				({ profile } = await post("Profiler.stop"));
				data.bounds.stopAfter = io.now();
			});
		if (condition === "CONTROL")
			await attempt(async () => {
				await io.tick();
				await io.tick();
			});
		let observed;
		if (base) observed = await attempt(() => base.finish());
		if (observed?.fault) errors.push(observed.fault);
		if (session) await attempt(() => session.disconnect());
		if (profile)
			await attempt(() => {
				assert.ok(profile.samples.length <= 200000 && profile.nodes.length <= 100000);
			});
		return { data, diagnostic: observed?.data, profile, errors };
	};
	try {
		base = io.base(condition === "CONTROL" ? "CPU" : "CPU_GC", orientation);
		if (condition === "GC_CPU") {
			session = io.session();
			session.connect();
			await post("Profiler.enable");
			await post("Profiler.setSamplingInterval", { interval: 250 });
			data.bounds.startBefore = io.now();
			await post("Profiler.start");
			data.bounds.startAfter = io.now();
		}
		anchor();
	} catch (e) {
		errors.push(e);
		const stopped = await finish();
		const error = new AggregateError(stopped.errors, "aligned observer setup");
		error.observation = stopped;
		throw error;
	}
	return { checkpoint: (...args) => base.checkpoint(...args), check: () => base.check(), finish };
}

/** Own observation before any consumer import; all failures retain cleanup/write errors. */
export async function execute(condition, orientation, load, put, make = create) {
	let obs, result, count;
	const errors = [];
	try {
		obs = await make(condition, orientation);
		count = await load(obs);
	} catch (e) {
		errors.push(e);
		result = e.observation;
	}
	if (obs) {
		try {
			result = await obs.finish();
			errors.push(...result.errors);
		} catch (e) {
			errors.push(e);
		}
	}
	if (result) {
		for (const [name, value] of [
			["diagnostic.json", result.diagnostic],
			["alignment.json", result.data],
			["profile.json", result.profile],
		]) {
			if (value !== undefined)
				try {
					put(name, value);
				} catch (e) {
					errors.push(e);
				}
		}
	}
	if (errors.length) {
		try {
			put(
				"observation-failure.json",
				errors.map((e) => ({
					name: e.name,
					message: e.message,
					errors: e.errors?.map((x) => ({ name: x.name, message: x.message })),
				})),
			);
		} catch (e) {
			errors.push(e);
		}
		throw new AggregateError(errors, "workload/observation/write failures");
	}
	assert.equal(count, 2400);
	put("completion.json", { completed: true, samples: count });
}
