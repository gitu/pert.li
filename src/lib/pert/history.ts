import * as Automerge from "@automerge/automerge";
import { parseChangeMessage } from "./change-meta";
import type { DocMeta, PertDoc } from "./types";

// Browse Automerge change history as user-meaningful "entries". Per change we
// keep:
//
//  - `heads` (the doc state right after the change applied),
//  - `actor` short id (for the colour swatch / "you" tag),
//  - `time` (ms epoch — Automerge stores 0 on changes that pre-date the
//    sync-protocol time field; we coerce those to null),
//  - structured `source/systemKind/payload` parsed from the change message,
//  - `userId` / `userName` resolved via the doc-level actor registry
//    (`doc.meta.actors`) so the drawer can show friendly names.
//
// Bursty edits (e.g. typing in an inline field) explode the raw change log
// into hundreds of microsecond-apart commits. `coalesceEntries` groups
// adjacent entries from the same (user, source) pair inside `windowMs` so
// the drawer shows a reasonable list — the *last* heads in a group
// represents the group.

export type HistorySource = "user" | "ai" | "system";

export type HistoryEntry = {
	heads: string[];
	actor: string;
	time: number | null;
	rawMessage: string | null;
	source: HistorySource;
	systemKind: string | null;
	payload: Record<string, unknown> | null;
	userId: string | null;
	userName: string | null;
	// Index in the raw history list. Useful for stable React keys and for
	// resolving "which change am I looking at" when the user clicks.
	index: number;
};

export type HistoryGroup = {
	heads: string[];
	actor: string;
	source: HistorySource;
	systemKind: string | null;
	payload: Record<string, unknown> | null;
	userId: string | null;
	userName: string | null;
	startTime: number | null;
	endTime: number | null;
	count: number;
	firstIndex: number;
	lastIndex: number;
	// Last raw change message on the group — kept so adjacent groups can be
	// compared on "same message?" without re-walking the entries array.
	rawMessage: string | null;
};

export function readHistory(doc: PertDoc): HistoryEntry[] {
	// `getHistory` returns oldest → newest. Each `State.snapshot` is a doc
	// view we don't need (we'd rather use Automerge.view on the live doc),
	// so we just keep metadata. Automerge stores `change.time` in seconds
	// since epoch — convert to milliseconds here so every downstream caller
	// (formatters, gap math) can treat it as a regular JS timestamp.
	const raw = Automerge.getHistory(doc);
	const actors: NonNullable<DocMeta["actors"]> = doc.meta?.actors ?? {};
	const entries: HistoryEntry[] = [];
	for (let i = 0; i < raw.length; i++) {
		const c = raw[i].change;
		const msg = parseChangeMessage(c.message);
		const actorInfo = actors[c.actor] ?? null;
		entries.push({
			heads: [c.hash],
			actor: c.actor,
			time: c.time && c.time > 0 ? c.time * 1000 : null,
			rawMessage: c.message ?? null,
			source: msg.source,
			systemKind: msg.kind ?? null,
			payload: msg.payload ?? null,
			userId: actorInfo?.userId ?? null,
			userName: actorInfo?.name ?? null,
			index: i,
		});
	}
	return entries;
}

export type HistoryFilter = {
	// When set, only entries whose `source` is in this set are returned.
	sources?: HistorySource[];
};

export function filterEntries(
	entries: HistoryEntry[],
	filter: HistoryFilter | undefined,
): HistoryEntry[] {
	if (!filter?.sources || filter.sources.length === 0) return entries;
	const allow = new Set(filter.sources);
	return entries.filter((e) => allow.has(e.source));
}

export function coalesceEntries(
	entries: HistoryEntry[],
	windowMs = 30_000,
): HistoryGroup[] {
	if (entries.length === 0) return [];
	const groups: HistoryGroup[] = [];
	for (const entry of entries) {
		const tail = groups.at(-1);
		// Group by user identity (falling back to actor when unknown) PLUS
		// source — an AI burst sandwiched between two user edits stays its
		// own group, and system markers never fold into adjacent edits.
		const entryKey = entry.userId ?? entry.actor;
		const tailKey = tail ? (tail.userId ?? tail.actor) : null;
		// Preserve the original message-boundary semantics: an Automerge
		// `change(doc, "msg", fn)` is the writer flagging a logical unit, so
		// different `msg` values shouldn't collapse into a single row.
		const canFold =
			tail &&
			entry.source !== "system" &&
			tail.source !== "system" &&
			tailKey === entryKey &&
			tail.source === entry.source &&
			tail.rawMessage === entry.rawMessage &&
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
			source: entry.source,
			systemKind: entry.systemKind,
			payload: entry.payload,
			userId: entry.userId,
			userName: entry.userName,
			startTime: entry.time,
			endTime: entry.time,
			count: 1,
			firstIndex: entry.index,
			lastIndex: entry.index,
			rawMessage: entry.rawMessage,
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
