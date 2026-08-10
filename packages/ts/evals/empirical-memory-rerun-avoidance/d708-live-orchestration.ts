import { exactKeys, record } from "./canonical.js";

type AwaitedStep<T> = T | Promise<T>;

export interface D708OrderedLiveAdmissionSteps<
	Pricing,
	Credential,
	ZeroByok,
	Claim,
	CurrentKey,
	ProviderResult,
> {
	readFreshPricing(): AwaitedStep<Pricing>;
	loadCredential(input: { readonly pricing: Pricing }): AwaitedStep<Credential>;
	readFreshZeroByok(input: {
		readonly pricing: Pricing;
		readonly credential: Credential;
	}): AwaitedStep<ZeroByok>;
	acquireDispatchClaim(input: {
		readonly pricing: Pricing;
		readonly credential: Credential;
		readonly zeroByok: ZeroByok;
	}): AwaitedStep<Claim>;
	readCurrentKey(input: {
		readonly pricing: Pricing;
		readonly credential: Credential;
		readonly zeroByok: ZeroByok;
		readonly claim: Claim;
	}): AwaitedStep<CurrentKey>;
	runSerialProvider(input: {
		readonly pricing: Pricing;
		readonly credential: Credential;
		readonly zeroByok: ZeroByok;
		readonly claim: Claim;
		readonly currentKey: CurrentKey;
	}): AwaitedStep<ProviderResult>;
	onPostClaimFailure(input: {
		readonly claim: Claim;
		readonly phase: "current-key" | "provider";
		readonly currentKey: CurrentKey | null;
		readonly error: unknown;
	}): Promise<void>;
}

function ownFunction(value: Record<string, unknown>, key: string): (...args: never[]) => unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (
		descriptor === undefined ||
		"get" in descriptor ||
		"set" in descriptor ||
		typeof descriptor.value !== "function"
	) {
		throw new TypeError(`D708 ordered live admission ${key} must be an own function`);
	}
	return descriptor.value as (...args: never[]) => unknown;
}

export async function runD708OrderedLiveAdmissions<
	Pricing,
	Credential,
	ZeroByok,
	Claim,
	CurrentKey,
	ProviderResult,
>(
	input: D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>,
): Promise<{
	readonly pricing: Pricing;
	readonly credential: Credential;
	readonly zeroByok: ZeroByok;
	readonly claim: Claim;
	readonly currentKey: CurrentKey;
	readonly providerResult: ProviderResult;
}> {
	const candidate = record(input, "d708.orderedLiveAdmissions");
	exactKeys(
		candidate,
		[
			"acquireDispatchClaim",
			"loadCredential",
			"onPostClaimFailure",
			"readCurrentKey",
			"readFreshPricing",
			"readFreshZeroByok",
			"runSerialProvider",
		],
		"d708.orderedLiveAdmissions",
	);
	const readFreshPricing = ownFunction(candidate, "readFreshPricing") as () => AwaitedStep<Pricing>;
	const loadCredential = ownFunction(candidate, "loadCredential") as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["loadCredential"];
	const readFreshZeroByok = ownFunction(
		candidate,
		"readFreshZeroByok",
	) as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["readFreshZeroByok"];
	const acquireDispatchClaim = ownFunction(
		candidate,
		"acquireDispatchClaim",
	) as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["acquireDispatchClaim"];
	const readCurrentKey = ownFunction(candidate, "readCurrentKey") as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["readCurrentKey"];
	const runSerialProvider = ownFunction(
		candidate,
		"runSerialProvider",
	) as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["runSerialProvider"];
	const onPostClaimFailure = ownFunction(
		candidate,
		"onPostClaimFailure",
	) as D708OrderedLiveAdmissionSteps<
		Pricing,
		Credential,
		ZeroByok,
		Claim,
		CurrentKey,
		ProviderResult
	>["onPostClaimFailure"];

	const pricing = await readFreshPricing();
	const credential = await loadCredential({ pricing });
	const zeroByok = await readFreshZeroByok({ pricing, credential });
	const claim = await acquireDispatchClaim({ pricing, credential, zeroByok });
	let currentKey: CurrentKey;
	try {
		currentKey = await readCurrentKey({ pricing, credential, zeroByok, claim });
	} catch (error) {
		await onPostClaimFailure({ claim, phase: "current-key", currentKey: null, error });
		throw error;
	}
	let providerResult: ProviderResult;
	try {
		providerResult = await runSerialProvider({ pricing, credential, zeroByok, claim, currentKey });
	} catch (error) {
		await onPostClaimFailure({ claim, phase: "provider", currentKey, error });
		throw error;
	}
	return Object.freeze({ pricing, credential, zeroByok, claim, currentKey, providerResult });
}
