/**
 * On-device RN/Hermes spike screen for @graphrefly/ts
 * (graphrefly-ts#4). This is the PERIODIC tier: real Hermes VM + RN
 * polyfills, exercised via `expo run:ios` (dev) and
 * `expo run:ios --configuration Release` (Hermes bytecode).
 *
 * The two reactive test blocks are kept equivalent to the canonical
 * scripts/hermes-smoke/spike-core.mjs (which gates per-commit via
 * RN's pinned hermesc + Node). If you change the assertions, change
 * both. Renders a PASS/FAIL banner so a single screenshot confirms
 * the run; mirrors to console for device logs.
 */
import type { Node } from "@graphrefly/ts/core";
import { type Graph, graph } from "@graphrefly/ts/graph";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

const mkState = (g: Graph, initial: unknown) => g.state(initial);

const mkDerived = (
	g: Graph,
	deps: ReadonlyArray<Node<unknown>>,
	compute: (...a: unknown[]) => unknown,
) => g.derived(deps, (...args) => compute(...args));

const onData = (n: Node<unknown>, cb: (v: unknown) => void) =>
	n.subscribe((msg) => {
		if (msg[0] === "DATA") cb(msg[1]);
	});

function runSpike(): { pass: boolean; lines: string[] } {
	const lines: string[] = [];
	const log = (s: string) => {
		lines.push(s);
		console.log(`[spike] ${s}`);
	};
	let pass = true;
	const expect = (label: string, got: unknown, want: unknown) => {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		if (!ok) pass = false;
		log(`${ok ? "OK " : "BAD"} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
	};

	try {
		const g = graph();
		const a = mkState(g, 1);
		const b = mkState(g, 2);
		const sum = mkDerived(g, [a, b], (x, y) => (x as number) + (y as number));
		const sumSeen: unknown[] = [];
		onData(sum, (v) => sumSeen.push(v));
		a.set(10);
		b.set(20);
		expect("block1 sum emissions", sumSeen, [3, 12, 30]);

		const a2 = mkState(g, 1);
		const b2 = mkDerived(g, [a2], (x) => (x as number) * 2);
		const c2 = mkDerived(g, [a2, b2], (x, y) => (x as number) + (y as number));
		const c2Seen: unknown[] = [];
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

	const g = globalThis as Record<string, unknown>;
	const hermes = g.HermesInternal as
		| { getRuntimeProperties?: () => Record<string, string> }
		| undefined;
	log(`engine: ${hermes ? "Hermes" : "non-Hermes (JSC?)"}`);
	if (hermes?.getRuntimeProperties) {
		const rp = hermes.getRuntimeProperties();
		log(`hermes bytecode v: ${rp["Bytecode Version"]} build: ${rp.Build ?? "?"}`);
	}
	const rnv = (
		Platform.constants as unknown as {
			reactNativeVersion?: { major: number; minor: number; patch: number };
		}
	).reactNativeVersion;
	log(
		`RN ${rnv ? `${rnv.major}.${rnv.minor}.${rnv.patch}` : "?"} / ${Platform.OS} ${Platform.Version}`,
	);
	const has = (name: string, present: boolean) =>
		log(`probe ${name}: ${present ? "present" : "MISSING"}`);
	has("globalThis", typeof globalThis !== "undefined");
	has("Symbol", typeof Symbol === "function");
	has("BigInt", typeof BigInt === "function");
	has("Promise", typeof Promise === "function");
	has("queueMicrotask", typeof queueMicrotask === "function");
	has(
		"crypto.randomUUID",
		typeof (g.crypto as { randomUUID?: unknown })?.randomUUID === "function",
	);
	has("structuredClone", typeof structuredClone === "function");

	log(`RESULT: ${pass ? "PASS" : "FAIL"}`);
	return { pass, lines };
}

export default function App() {
	const [r, setR] = useState<{ pass: boolean; lines: string[] } | null>(null);
	useEffect(() => {
		setR(runSpike());
	}, []);
	const pass = r?.pass ?? false;
	return (
		<View style={{ flex: 1, backgroundColor: "#0b0f12" }}>
			<View
				style={{
					paddingTop: 64,
					paddingBottom: 16,
					alignItems: "center",
					backgroundColor: r == null ? "#333" : pass ? "#0a7d28" : "#9b1c1c",
				}}
			>
				<Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>
					{r == null ? "running…" : pass ? "PASS ✅" : "FAIL ❌"}
				</Text>
				<Text style={{ color: "#cde", fontSize: 13, marginTop: 4 }}>
					graphrefly-ts#4 · @graphrefly/ts · Expo SDK 55 / RN 0.83.6
				</Text>
			</View>
			<ScrollView style={{ flex: 1, padding: 12 }}>
				{r?.lines.map((l) => (
					<Text
						key={l}
						style={{
							color: l.startsWith("BAD") || l.startsWith("THREW") ? "#ff8080" : "#bfe",
							fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
							fontSize: 12,
							marginBottom: 3,
						}}
					>
						{l}
					</Text>
				))}
			</ScrollView>
		</View>
	);
}
