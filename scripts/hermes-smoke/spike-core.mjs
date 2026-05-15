/**
 * Portable RN/Hermes spike for @graphrefly/pure-ts (graphrefly-ts#4).
 *
 * Pure, runtime-agnostic. No `node:*`, no DOM, no RN imports. Consumed
 * by THREE runners so the same reactive assertions gate every target:
 *   - scripts/hermes-smoke/run-node.mjs  — sanity under Node (dev loop)
 *   - scripts/hermes-smoke/run-hermes.*  — real Hermes engine (CI gate)
 *   - apps/rn-hermes-fixture (Expo)      — periodic on-device RN build
 *
 * Issue #4's snippet uses `state()` / `derived()` / `.set()` as
 * illustrative pseudo-API. pure-ts's real public primitive is `node()`
 * (`state`/`derived` are Graph methods, not standalone exports). This
 * is the faithful translation: manual source = `node([], undefined,
 * {initial})`; derived = `node(deps, fn)` emitting via `actions.emit`.
 */
import { DATA, node } from "@graphrefly/pure-ts";

function mkState(initial) {
	return node([], undefined, { initial });
}

function mkDerived(deps, compute) {
	return node(deps, (data, actions, ctx) => {
		const args = deps.map((_, i) => {
			const batch = data[i];
			return batch?.length ? batch[batch.length - 1] : ctx.prevData[i];
		});
		actions.emit(compute(...args));
	});
}

function onData(n, cb) {
	return n.subscribe((msgs) => {
		for (const m of msgs) if (m[0] === DATA) cb(m[1]);
	});
}

/** Runs the two issue-#4 test blocks. Returns { pass, lines }. */
export function runSpike() {
	const lines = [];
	const log = (s) => lines.push(s);
	let pass = true;
	const expect = (label, got, want) => {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		if (!ok) pass = false;
		log(`${ok ? "OK " : "BAD"} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
	};

	try {
		// ---- Block 1: basic propagation ------------------------------
		const a = mkState(1);
		const b = mkState(2);
		const sum = mkDerived([a, b], (x, y) => x + y);
		const sumSeen = [];
		onData(sum, (v) => sumSeen.push(v));
		a.emit(10);
		b.emit(20);
		expect("block1 sum emissions", sumSeen, [3, 12, 30]);

		// ---- Block 2: diamond fan-in (cascade dedupe) ----------------
		const a2 = mkState(1);
		const b2 = mkDerived([a2], (x) => x * 2);
		const c2 = mkDerived([a2, b2], (x, y) => x + y);
		const c2Seen = [];
		onData(c2, (v) => c2Seen.push(v));
		const before = c2Seen.length;
		a2.emit(5);
		expect("block2 c2 initial", c2Seen.slice(0, before), [3]);
		expect("block2 c2 after set==5 (ONCE, not twice)", c2Seen.slice(before), [15]);
	} catch (err) {
		pass = false;
		const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		log(`THREW: ${e}`);
		if (err instanceof Error && err.stack) {
			log(err.stack.split("\n").slice(0, 4).join(" | "));
		}
	}

	return { pass, lines };
}

/** Engine / polyfill probes. Pure; safe on every runtime. */
export function probes() {
	const g = typeof globalThis !== "undefined" ? globalThis : {};
	const hermes = g.HermesInternal;
	const out = [];
	out.push(`engine: ${hermes ? "Hermes" : "non-Hermes (Node/JSC?)"}`);
	if (hermes && typeof hermes.getRuntimeProperties === "function") {
		const rp = hermes.getRuntimeProperties();
		out.push(`hermes bytecode v: ${rp["Bytecode Version"]} build: ${rp.Build ?? "?"}`);
	}
	const has = (name, present) => out.push(`probe ${name}: ${present ? "present" : "MISSING"}`);
	has("globalThis", typeof globalThis !== "undefined");
	has("Symbol", typeof Symbol === "function");
	has("BigInt", typeof BigInt === "function");
	has("Promise", typeof Promise === "function");
	has("queueMicrotask", typeof queueMicrotask === "function");
	has("crypto.randomUUID", typeof g.crypto?.randomUUID === "function");
	has("structuredClone", typeof structuredClone === "function");
	return out;
}
