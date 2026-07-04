/**
 * Public testing assertions for clean-slate GraphReFly message streams.
 *
 * These helpers validate captured protocol output; they do not participate in propagation.
 */

import { isValueTier, type Message, type Wave } from "../protocol/messages.js";

/** Captured subscriber messages grouped by wave. START/replay handshake messages occupy one wave. */
export type MessageSequence = readonly Wave[];

/**
 * Assert that observed tier-3 settlements (DATA/RESOLVED) are preceded by DIRTY.
 *
 * This encodes R-dirty-before-data for wave-framed subscriber traces. The leading
 * START push-on-subscribe/replay handshake wave is exempt because cached/replay DATA is
 * advertised to a new subscriber without opening a propagation wave.
 * @param messages - messages value used by the helper.
 * @returns The narrowed, validated value.
 * @category testing
 * @example
 * ```ts
 * import { assertDirtyPrecedesTerminalData } from "@graphrefly/ts/testing";
 * ```
 */
export function assertDirtyPrecedesTerminalData(messages: MessageSequence): void {
	for (let waveIndex = 0; waveIndex < messages.length; waveIndex += 1) {
		const wave = messages[waveIndex];
		let handshake = false;
		let openedByDirty = false;

		for (let msgIndex = 0; msgIndex < wave.length; msgIndex += 1) {
			const msg = wave[msgIndex] as Message;
			const type = msg[0];

			if (msgIndex === 0 && type === "START") {
				handshake = true;
				continue;
			}

			if (handshake && type === "DATA") {
				continue;
			}
			handshake = false;

			if (type === "DIRTY") {
				openedByDirty = true;
				continue;
			}

			if (isValueTier(type)) {
				if (!openedByDirty) {
					throw new Error(
						`assertDirtyPrecedesTerminalData: ${type} at wave ${waveIndex}, index ${msgIndex} arrived without a preceding DIRTY in the same wave (R-dirty-before-data). Wave: ${describeWave(wave, msgIndex)}`,
					);
				}
				continue;
			}

			openedByDirty = false;
		}
	}
}

function describeWave(wave: Wave, around: number): string {
	const parts: string[] = [];
	for (let i = 0; i < wave.length; i += 1) {
		parts.push(`${i === around ? "-> " : "   "}[${wave[i]?.[0] ?? "?"}]`);
	}
	return parts.join(", ");
}
