import { exactKeys, record } from "./canonical.js";
import type { D716GraphNativeSixArmCoordinatorV1 } from "./d716-graph-native-live-coordinator.js";
import { isConstructedD716GraphNativeSixArmCoordinator } from "./d716-graph-native-live-coordinator.js";
import type { D716GraphNativeLiveQualificationV1 } from "./d716-graph-native-live-qualification.js";
import { isBrandedD716GraphNativeLiveQualification } from "./d716-graph-native-live-qualification-brand.js";

export const D717_GRAPH_NATIVE_LIVE_CAPABILITY_REVISION =
	"d717.graph-native-live-provider-capability.v1" as const;

export interface D717GraphNativeLiveProviderCapabilityV1 {
	readonly capabilityRevision: typeof D717_GRAPH_NATIVE_LIVE_CAPABILITY_REVISION;
}

interface CapabilityState {
	readonly coordinator: D716GraphNativeSixArmCoordinatorV1;
	readonly d716QualificationDigest: string;
}

const constructedCapabilities = new WeakMap<object, CapabilityState>();

export function createD717GraphNativeLiveProviderCapability(inputValue: {
	readonly coordinator: D716GraphNativeSixArmCoordinatorV1;
	readonly d716Qualification: D716GraphNativeLiveQualificationV1;
}): D717GraphNativeLiveProviderCapabilityV1 {
	const input = record(inputValue, "d717.liveCapability");
	exactKeys(input, ["coordinator", "d716Qualification"], "d717.liveCapability");
	if (!isConstructedD716GraphNativeSixArmCoordinator(input.coordinator)) {
		throw new TypeError("D717 live capability requires the constructed D716 coordinator");
	}
	if (!isBrandedD716GraphNativeLiveQualification(input.d716Qualification)) {
		throw new TypeError("D717 live capability requires a same-process D716 qualification");
	}
	const d716Qualification = input.d716Qualification as D716GraphNativeLiveQualificationV1;
	if (!/^sha256:[0-9a-f]{64}$/.test(d716Qualification.evidenceDigest)) {
		throw new TypeError("D717 live capability requires the exact D716 qualification digest");
	}
	const capability = Object.freeze({
		capabilityRevision: D717_GRAPH_NATIVE_LIVE_CAPABILITY_REVISION,
	});
	constructedCapabilities.set(capability, {
		coordinator: input.coordinator as D716GraphNativeSixArmCoordinatorV1,
		d716QualificationDigest: d716Qualification.evidenceDigest,
	});
	return capability;
}

export function consumeD717GraphNativeLiveProviderCapability(
	value: unknown,
	coordinator: D716GraphNativeSixArmCoordinatorV1,
): { readonly d716QualificationDigest: string } {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("D717 live capability is not constructed");
	}
	const state = constructedCapabilities.get(value);
	if (state === undefined || state.coordinator !== coordinator) {
		throw new TypeError("D717 live capability does not bind the exact D716 coordinator");
	}
	constructedCapabilities.delete(value);
	return Object.freeze({ d716QualificationDigest: state.d716QualificationDigest });
}
