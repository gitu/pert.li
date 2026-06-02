import * as Automerge from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import { useEffect } from "react";
import type { PertDoc } from "./types";

// On doc load (and whenever the local actor id rolls over), make sure
// `doc.meta.actors[currentActorId]` carries this session's user identity. The
// History drawer reads this back to show "Florian renamed Phase 2" instead of
// "actor 3f0a renamed Phase 2".
//
// We write at most once per actor — concurrent writes only ever set new keys,
// so the CRDT merge behaviour is the trivial "everyone agrees" case. If the
// user isn't signed in (no userId), we skip; viewers shouldn't pollute the
// registry with anonymous entries.
export function useActorRegistration(
	handle: DocHandle<PertDoc> | undefined,
	user: { id: string; name: string } | null,
): void {
	useEffect(() => {
		if (!handle || !user) return;
		const tryRegister = () => {
			const doc = handle.doc();
			if (!doc) return;
			const actorId = Automerge.getActorId(doc);
			const existing = doc.meta?.actors?.[actorId];
			if (
				existing &&
				existing.userId === user.id &&
				existing.name === user.name
			) {
				return;
			}
			handle.change(
				(d) => {
					if (!d.meta) d.meta = {};
					if (!d.meta.actors) d.meta.actors = {};
					d.meta.actors[actorId] = {
						userId: user.id,
						name: user.name,
						firstSeenAt: Date.now(),
					};
				},
				{
					message: JSON.stringify({
						source: "system",
						kind: "actor-registered",
					}),
					time: Math.floor(Date.now() / 1000),
				},
			);
		};
		tryRegister();
		// Re-check on every change event in case the actor id rolled or another
		// peer's actor needs us to re-self-register after a remote merge.
		handle.on("change", tryRegister);
		return () => {
			handle.off("change", tryRegister);
		};
	}, [handle, user]);
}
