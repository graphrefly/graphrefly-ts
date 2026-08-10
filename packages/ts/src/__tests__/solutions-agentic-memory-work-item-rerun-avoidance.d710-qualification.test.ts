import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { D703_PRIVATE_PERSISTENCE_ROOT } from "../../evals/empirical-memory-rerun-avoidance/d703-mutation-first-recovery-live.js";
import {
	D710_GENERATION_ARTIFACT_DIGEST,
	D710_PRIVATE_GENERATION_REF,
	D710_QUALIFICATION_ARTIFACT_DIGEST,
	validateD710QualifiedArtifactBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d710-untyped-http-429-retry-qualification.js";

const root = join(D703_PRIVATE_PERSISTENCE_ROOT, D710_PRIVATE_GENERATION_REF);
const hasQualification = existsSync(join(root, "untyped-http-429-retry-qualification.v1.json"));

function artifacts() {
	return {
		qualificationBytes: new Uint8Array(
			readFileSync(join(root, "untyped-http-429-retry-qualification.v1.json")),
		),
		generationBytes: new Uint8Array(readFileSync(join(root, "generation.v1.json"))),
	};
}

describe.skipIf(!hasQualification)("D710 no-network untyped-429 retry qualification", () => {
	it("replays exact six-arm retry evidence without credentials or provider work", () => {
		expect(validateD710QualifiedArtifactBytes(artifacts())).toEqual({
			qualificationDigest: D710_QUALIFICATION_ARTIFACT_DIGEST,
			generationDigest: D710_GENERATION_ARTIFACT_DIGEST,
		});
		for (const file of ["untyped-http-429-retry-qualification.v1.json", "generation.v1.json"]) {
			expect(statSync(join(root, file)).mode & 0o777).toBe(0o600);
			const text = readFileSync(join(root, file), "utf8");
			expect(text).not.toMatch(/bearer|credential|raw body|raw header/i);
		}
	});

	it("rejects one-byte tamper and accessors before decoding evidence", () => {
		const tampered = artifacts();
		tampered.qualificationBytes = tampered.qualificationBytes.slice();
		tampered.qualificationBytes[0] ^= 1;
		expect(() => validateD710QualifiedArtifactBytes(tampered)).toThrow();
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "qualificationBytes", {
			enumerable: true,
			get() {
				getterHits += 1;
				return artifacts().qualificationBytes;
			},
		});
		expect(() => validateD710QualifiedArtifactBytes(accessor)).toThrow();
		expect(getterHits).toBe(0);
	});
});
