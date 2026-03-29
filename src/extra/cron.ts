/**
 * Minimal 5-field cron parser and matcher (minute hour day-of-month month day-of-week).
 * Ported from callbag-recharge `extra/cron.ts` for `fromCron` (roadmap §2.3).
 */
export interface CronSchedule {
	minutes: Set<number>;
	hours: Set<number>;
	daysOfMonth: Set<number>;
	months: Set<number>;
	daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
	const result = new Set<number>();
	for (const part of field.split(",")) {
		const [range, stepStr] = part.split("/");
		const step = stepStr ? Number.parseInt(stepStr, 10) : 1;
		if (Number.isNaN(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);
		let start: number;
		let end: number;
		if (range === "*") {
			start = min;
			end = max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-");
			start = Number.parseInt(a, 10);
			end = Number.parseInt(b, 10);
		} else {
			start = Number.parseInt(range, 10);
			end = start;
		}
		if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Invalid cron field: ${field}`);
		if (start < min || end > max)
			throw new Error(`Cron field out of range: ${field} (${min}-${max})`);
		if (start > end) throw new Error(`Invalid cron range: ${start}-${end} in ${field}`);
		for (let i = start; i <= end; i += step) result.add(i);
	}
	return result;
}

/** Parses a standard 5-field cron expression. */
export function parseCron(expr: string): CronSchedule {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) throw new Error(`Invalid cron: expected 5 fields, got ${parts.length}`);
	return {
		minutes: parseField(parts[0], 0, 59),
		hours: parseField(parts[1], 0, 23),
		daysOfMonth: parseField(parts[2], 1, 31),
		months: parseField(parts[3], 1, 12),
		daysOfWeek: parseField(parts[4], 0, 6),
	};
}

/** True if `date` matches every field of `schedule`. */
export function matchesCron(schedule: CronSchedule, date: Date): boolean {
	return (
		schedule.minutes.has(date.getMinutes()) &&
		schedule.hours.has(date.getHours()) &&
		schedule.daysOfMonth.has(date.getDate()) &&
		schedule.months.has(date.getMonth() + 1) &&
		schedule.daysOfWeek.has(date.getDay())
	);
}
