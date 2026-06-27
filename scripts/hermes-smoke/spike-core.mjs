/**
 * Portable RN/Hermes spike for @graphrefly/ts (graphrefly-ts#4).
 *
 * Pure, runtime-agnostic. No `node:*`, no DOM, no RN imports. Consumed
 * by THREE runners so the same reactive assertions gate every target:
 *   - scripts/hermes-smoke/run-node.mjs  — sanity under Node (dev loop)
 *   - scripts/hermes-smoke/run-hermes.*  — real Hermes engine (CI gate)
 *   - apps/rn-hermes-fixture (Expo)      — periodic on-device RN build
 *
 * The spike uses the clean-slate graph layer: manual source = `g.state(initial)`;
 * derived = `g.derived(deps, fn)`; updates go through `.set()`.
 */
import { graph } from "@graphrefly/ts/graph";

function mkState(g, initial) {
	return g.state(initial);
}

function mkDerived(g, deps, compute) {
	return g.derived(deps, compute);
}

function onData(n, cb) {
	return n.subscribe((msg) => {
		if (msg[0] === "DATA") cb(msg[1]);
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
		const g = graph();
		// ---- Block 1: basic propagation ------------------------------
		const a = mkState(g, 1);
		const b = mkState(g, 2);
		const sum = mkDerived(g, [a, b], (x, y) => x + y);
		const sumSeen = [];
		onData(sum, (v) => sumSeen.push(v));
		a.set(10);
		b.set(20);
		expect("block1 sum emissions", sumSeen, [3, 12, 30]);

		// ---- Block 2: diamond fan-in (cascade dedupe) ----------------
		const a2 = mkState(g, 1);
		const b2 = mkDerived(g, [a2], (x) => x * 2);
		const c2 = mkDerived(g, [a2, b2], (x, y) => x + y);
		const c2Seen = [];
		onData(c2, (v) => c2Seen.push(v));
		const before = c2Seen.length;
		a2.set(5);
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
