import type { KeyedRateLimitAuthority } from "@graphrefly/ts/adapters";
import {
	createKeyedRateLimitOutcome,
	type KeyedRateLimitCoordinate,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitRequest,
	keyedRateLimitRequestIdentity,
} from "@graphrefly/ts/rate-limit";

interface CustomReceipt {
	readonly authority: KeyedRateLimitCoordinate;
	readonly requestId: string;
	readonly requestIdentityKey: string;
	readonly outcome: KeyedRateLimitOutcome;
}

function sameCoordinate(left: KeyedRateLimitCoordinate, right: KeyedRateLimitCoordinate): boolean {
	return left.kind === right.kind && left.id === right.id && left.revision === right.revision;
}

/**
 * Example custom host algorithm behind the existing authority capability.
 *
 * This file deliberately imports no reference transition evaluator and creates no registry.
 * A real host would durably persist its receipt material inside its own atomic boundary.
 */
export class ExampleCustomAuthority implements KeyedRateLimitAuthority {
	readonly #receipts: CustomReceipt[] = [];

	consume(
		request: KeyedRateLimitRequest,
		complete: (outcome: KeyedRateLimitOutcome) => void,
	): undefined {
		const requestIdentityKey = keyedRateLimitRequestIdentity(request).key;
		const receipt = this.#receipts.find(
			(candidate) =>
				candidate.requestId === request.requestId &&
				sameCoordinate(candidate.authority, request.authority),
		);
		if (receipt !== undefined) {
			complete(
				receipt.requestIdentityKey === requestIdentityKey
					? receipt.outcome
					: createKeyedRateLimitOutcome(request, {
							outcomeId: `custom-conflict-${request.requestId}`,
							result: "conflict",
						}),
			);
			return undefined;
		}

		// Placeholder custom algorithm: every new request is a valid quota denial.
		const outcome = createKeyedRateLimitOutcome(request, {
			outcomeId: `custom-denied-${request.requestId}`,
			result: "denied",
			remainingUnits: 0,
			resetAtMs: null,
			retryAfterMs: null,
		});
		this.#receipts.push({
			authority: request.authority,
			requestId: request.requestId,
			requestIdentityKey,
			outcome,
		});
		complete(outcome);
		return undefined;
	}
}
