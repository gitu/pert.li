import type { Repo } from "@automerge/automerge-repo";
import type { PertDoc } from "#/lib/pert/types";
import { randomId } from "#/lib/random-id";
import { addPending } from "./pending-projects";
import { requestReconcile } from "./reconcile-pending";

// Mint a client-side Automerge doc for a sample plan, queue it in the local
// pending registry (so it shows up in the project list immediately and survives
// a reload), and nudge reconcile to register it server-side. Returns the
// localId, which is a valid route projectId right away.
//
// Shared by the tutorial CTA (`startTutorial`) and the empty-workspace
// auto-seed hook so both create projects exactly the same way.
export async function seedSampleProject(
	repo: Repo,
	doc: PertDoc,
	title: string,
	workspaceId?: string,
): Promise<string> {
	const handle = repo.create(doc);
	const localId = randomId();
	await addPending({
		localId,
		title,
		automergeDocUrl: handle.url,
		createdAt: new Date().toISOString(),
		...(workspaceId ? { workspaceId } : {}),
	});
	void requestReconcile();
	return localId;
}
