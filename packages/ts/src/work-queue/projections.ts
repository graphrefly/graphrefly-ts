import type { RuntimeState } from "./runtime-types.js";
import type {
	WorkQueueAvailablePage,
	WorkQueueAvailableParams,
	WorkQueueDeadLetterPage,
	WorkQueueDeadLetterParams,
	WorkQueueWorkSnapshot,
} from "./types.js";
import { isReadyForProjection, positiveLimit } from "./utils.js";

export function availablePage<T>(
	state: RuntimeState<T>,
	params: WorkQueueAvailableParams,
): WorkQueueAvailablePage<T> {
	const limit = positiveLimit(params.limit ?? 100);
	const orderByWorkId = params.afterWorkId !== undefined && params.afterAdmissionSeq === undefined;
	const all = [...state.works.values()]
		.filter((work) => isReadyForProjection(work, params.nowMs))
		.filter((work) => params.afterWorkId === undefined || work.workId > params.afterWorkId)
		.filter(
			(work) =>
				params.afterAdmissionSeq === undefined || work.admissionSeq > params.afterAdmissionSeq,
		)
		.sort((a, b) =>
			orderByWorkId
				? a.workId.localeCompare(b.workId)
				: a.admissionSeq - b.admissionSeq || a.workId.localeCompare(b.workId),
		);
	const items = all.map((work) => ({
		workId: work.workId,
		state: work.state,
		payload: work.payload,
		admissionSeq: work.admissionSeq,
		priority: work.priority,
		tags: work.tags,
		requirements: work.requirements,
		notBeforeMs: work.notBeforeMs,
		retryAtMs: work.retryAtMs,
		deadlineMs: work.deadlineMs,
	}));
	const page = items.slice(0, limit);
	return {
		items: page,
		...(items.length > limit && page.length > 0
			? { nextAfterWorkId: page[page.length - 1]?.workId }
			: {}),
		...(items.length > limit && page.length > 0
			? { nextAfterAdmissionSeq: page[page.length - 1]?.admissionSeq }
			: {}),
		hasMore: items.length > limit,
		asOfRecordSeq: state.recordSeq,
	};
}

export function workSnapshot<T>(state: RuntimeState<T>, workId: string): WorkQueueWorkSnapshot<T> {
	const work = state.works.get(workId);
	return {
		workId,
		state: work?.state,
		payload: work?.payload,
		...(work?.state !== "leased" || work.leaseId === undefined
			? {}
			: {
					activeLease: {
						leaseId: work.leaseId,
						attempt: work.attempt,
						workerId: work.workerId as string,
						leaseExpiresAtMs: work.leaseExpiresAtMs as number,
					},
				}),
		records: state.records.filter((record) => record.workId === workId),
		asOfRecordSeq: state.recordSeq,
	};
}

export function deadLetterPage<T>(
	state: RuntimeState<T>,
	params: WorkQueueDeadLetterParams,
): WorkQueueDeadLetterPage<T> {
	const limit = positiveLimit(params.limit ?? 100);
	const entries = state.deadLetters.filter((record) => {
		if (params.afterDeadLetterSeq !== undefined && record.recordSeq <= params.afterDeadLetterSeq)
			return false;
		if (params.afterWorkId !== undefined && (record.workId ?? "") <= params.afterWorkId)
			return false;
		return true;
	});
	const page = entries.slice(0, limit);
	return {
		entries: page,
		...(entries.length > limit && page.length > 0
			? { nextAfterDeadLetterSeq: page[page.length - 1]?.recordSeq }
			: {}),
		hasMore: entries.length > limit,
		asOfRecordSeq: state.recordSeq,
	};
}
