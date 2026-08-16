import type { D17EffectResultInputV1 } from "./d17-current-efficacy-authority.js";
import {
	type D18AdmittedEffectV1,
	type D18AuthorityV1,
	type D18ProviderResultInputV1,
	type D18RuntimeMaterialV1,
	takeD18RuntimeMaterial,
} from "./d18-current-provider-composition-authority.js";

export interface D18AdapterResultV1 {
	readonly result:
		| D18ProviderResultInputV1
		| D17EffectResultInputV1
		| Readonly<{
				effectKind: "retry-wait";
				status: "completed";
				actualElapsedMs: number;
				evidenceDigest: string;
		  }>;
	readonly runtimeMaterial?: unknown;
}

export interface D18OneEffectPortsV1 {
	readonly provider: (
		effect: Extract<D18AdmittedEffectV1, { kind: "provider-attempt" }>,
		material: Extract<D18RuntimeMaterialV1, { kind: "provider-attempt" }>,
	) => Promise<D18ProviderResultInputV1>;
	readonly local: (
		effect: Extract<D18AdmittedEffectV1, { kind: "workflow-local" }>,
		material: Extract<D18RuntimeMaterialV1, { kind: "workflow-local" }>,
	) => Promise<Readonly<{ result: D17EffectResultInputV1; runtimeMaterial?: unknown }>>;
	readonly retryWait: (
		effect: Extract<D18AdmittedEffectV1, { kind: "retry-wait" }>,
	) => Promise<Readonly<{ actualElapsedMs: number; evidenceDigest: string }>>;
}

export function createD18OneEffectAdapter(ports: D18OneEffectPortsV1) {
	let active = 0;
	let maxActive = 0;
	const execute = async (
		authority: D18AuthorityV1,
		effect: D18AdmittedEffectV1,
	): Promise<D18AdapterResultV1> => {
		if (active !== 0) throw new TypeError("D18 adapter received overlapping effects");
		active += 1;
		maxActive = Math.max(maxActive, active);
		try {
			const material = takeD18RuntimeMaterial(authority, effect);
			if (effect.kind === "provider-attempt") {
				if (material.kind !== "provider-attempt")
					throw new TypeError("D18 provider material drifted");
				return Object.freeze({ result: await ports.provider(effect, material) });
			}
			if (effect.kind === "workflow-local") {
				if (material.kind !== "workflow-local") throw new TypeError("D18 local material drifted");
				return Object.freeze(await ports.local(effect, material));
			}
			if (material.kind !== "workflow-local" || material.toolArguments !== null)
				throw new TypeError("D18 retry wait received unexpected runtime material");
			const result = await ports.retryWait(effect);
			return Object.freeze({
				result: Object.freeze({
					effectKind: "retry-wait" as const,
					status: "completed" as const,
					actualElapsedMs: result.actualElapsedMs,
					evidenceDigest: result.evidenceDigest,
				}),
			});
		} finally {
			active -= 1;
		}
	};
	return Object.freeze({
		execute,
		maxActiveEffects: () => maxActive,
	});
}
