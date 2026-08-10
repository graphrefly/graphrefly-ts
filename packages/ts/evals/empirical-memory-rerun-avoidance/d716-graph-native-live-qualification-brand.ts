const constructedD716Qualifications = new WeakSet<object>();

export function brandD716GraphNativeLiveQualification(value: object): void {
	constructedD716Qualifications.add(value);
}

export function isBrandedD716GraphNativeLiveQualification(value: unknown): value is object {
	return typeof value === "object" && value !== null && constructedD716Qualifications.has(value);
}

export function deleteD716GraphNativeLiveQualificationBrand(value: object): void {
	constructedD716Qualifications.delete(value);
}
