/**
 * Cron-based reactive sources and schedule types.
 *
 * Merged from extra/cron.ts + extra/sources/event.ts (fromCron) during cleave A2.
 */

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

/**
 * Parses a standard 5-field cron expression into a {@link CronSchedule}.
 *
 * Supports `*`, ranges (`1-5`), steps (`*\/5`, `0-30/10`), and comma-separated
 * lists. Fields are: minute (0–59), hour (0–23), day-of-month (1–31),
 * month (1–12), day-of-week (0–6, Sunday = 0).
 *
 * @param expr - Five-field whitespace-separated cron string (e.g. `"0 9 * * 1-5"`).
 * @returns Parsed {@link CronSchedule} with one `Set<number>` per field.
 * @throws Error when the expression does not have exactly 5 fields, contains
 *   out-of-range values, or uses an invalid step.
 *
 * @example
 * ```ts
 * import { parseCron } from "@graphrefly/graphrefly-ts";
 *
 * const sched = parseCron("0 9 * * 1-5"); // weekdays at 09:00
 * sched.hours;      // Set { 9 }
 * sched.daysOfWeek; // Set { 1, 2, 3, 4, 5 }
 * ```
 */
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

/**
 * Returns `true` if `date` satisfies every field of `schedule`.
 *
 * @param schedule - Parsed schedule from {@link parseCron}.
 * @param date - Moment to test (local time via `getMinutes`, `getHours`, etc.).
 * @returns `true` when all five cron fields match the given date.
 *
 * @example
 * ```ts
 * import { parseCron, matchesCron } from "@graphrefly/graphrefly-ts";
 *
 * const sched = parseCron("30 8 * * 1"); // Mondays at 08:30
 * const monday = new Date("2026-03-30T08:30:00"); // a Monday
 * matchesCron(sched, monday); // true
 * ```
 */
export function matchesCron(schedule: CronSchedule, date: Date): boolean {
	return (
		schedule.minutes.has(date.getMinutes()) &&
		schedule.hours.has(date.getHours()) &&
		schedule.daysOfMonth.has(date.getDate()) &&
		schedule.months.has(date.getMonth() + 1) &&
		schedule.daysOfWeek.has(date.getDay())
	);
}
