import * as Automerge from "@automerge/automerge";
import type { PertDoc } from "./types";

// Browse Automerge change history as user-meaningful "entries". Per change we
// keep:
//
//  - `heads` (the doc state right after the change applied),
//  - `actor` short id (for the colour swatch / "you" tag),
//  - `time` (ms epoch — Automerge stores 0 on changes that pre-date the
//    sync-protocol time field; we coerce those to null),
//  - `message` if set by the writer.
//
// Bursty edits (e.g. typing in an inline field) explode the raw change log
// into hundreds of microsecond-apart commits. `coalesceEntries` groups
// adjacent entries from the same actor inside `windowMs` so the drawer shows
// a reasonable list — the *last* heads in a group represents the group.

export type HistoryEntry = {
	heads: string[];
	actor: string;
	time: number | null;
	message: string | null;
	// Index in the raw history list. Useful for stable React keys and for
	// resolving "which change am I looking at" when the user clicks.
	index: number;
};

export type HistoryGroup = {
	heads: string[];
	actor: string;
	startTime: number | null;
	endTime: number | null;
	count: number;
	message: string | null;
	firstIndex: number;
	lastIndex: number;
};

export function readHistory(doc: PertDoc): HistoryEntry[] {
	// `getHistory` returns oldest → newest. Each `State.snapshot` is a doc
	// view we don't need (we'd rather use Automerge.view on the live doc),
	// so we just keep metadata. Automerge stores `change.time` in seconds
	// since epoch — convert to milliseconds here so every downstream caller
	// (formatters, gap math) can treat it as a regular JS timestamp.
	const raw = Automerge.getHistory(doc);
	const entries: HistoryEntry[] = [];
	for (let i = 0; i < raw.length; i++) {
		const c = raw[i].change;
		entries.push({
			heads: [c.hash],
			actor: c.actor,
			time: c.time && c.time > 0 ? c.time * 1000 : null,
			message: c.message ?? null,
			index: i,
		});
	}
	return entries;
}

export function coalesceEntries(
	entries: HistoryEntry[],
	windowMs = 30_000,
): HistoryGroup[] {
	if (entries.length === 0) return [];
	const groups: HistoryGroup[] = [];
	for (const entry of entries) {
		const tail = groups.at(-1);
		const canFold =
			tail &&
			tail.actor === entry.actor &&
			tail.message === entry.message &&
			(tail.endTime === null ||
				entry.time === null ||
				entry.time - tail.endTime <= windowMs);
		if (canFold && tail) {
			tail.heads = entry.heads;
			tail.endTime = entry.time ?? tail.endTime;
			tail.count += 1;
			tail.lastIndex = entry.index;
			continue;
		}
		groups.push({
			heads: entry.heads,
			actor: entry.actor,
			startTime: entry.time,
			endTime: entry.time,
			count: 1,
			message: entry.message,
			firstIndex: entry.index,
			lastIndex: entry.index,
		});
	}
	return groups;
}

// Snapshot of a PertDoc at the given heads. Returns the same object identity
// if `heads` is the doc's current heads (so React skips re-render).
export function snapshotAt(doc: PertDoc, heads: string[]): PertDoc {
	const current = Automerge.getHeads(doc);
	if (
		heads.length === current.length &&
		heads.every((h, i) => h === current[i])
	) {
		return doc;
	}
	return Automerge.view(doc, heads) as PertDoc;
}
