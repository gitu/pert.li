import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	DicesIcon,
	FileIcon,
	GraduationCapIcon,
	WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import {
	AttachmentDropZone,
	isReadyAttachment,
	useFileAttachments,
} from "#/components/ai/attachment-input";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useActiveWorkspaceId } from "#/lib/active-workspace";
import type { ExtractedFile } from "#/lib/ai/file-extract";
import { newId } from "#/lib/ai/tool-mutators";
import { useOptionalRepo } from "#/lib/automerge/provider";
import { chatDock } from "#/lib/chat-dock";
import {
	createMonteCarloPertDoc,
	MONTE_CARLO_SAMPLE_TITLE,
} from "#/lib/pert/sample-montecarlo-project";
import { createTutorialPertDoc } from "#/lib/pert/sample-tutorial-project";
import {
	createEmptyPertDoc,
	type PertDoc,
	type ProjectDocument,
} from "#/lib/pert/types";
import { randomId } from "#/lib/random-id";
import { addPending } from "#/lib/sync/pending-projects";
import { requestReconcile } from "#/lib/sync/reconcile-pending";

export type CreateProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

// The four ways to start a plan. `empty` keeps the original blank-doc flow;
// the two samples seed a ready-made graph; `ai` mints an empty doc, attaches
// any uploaded source documents to it, and hands the description (plus the
// documents) to the assistant, which drafts a work plan and the first tasks via
// the normal create_work_plan / propose_changes review gates.
type Choice = "empty" | "montecarlo" | "tutorial" | "ai";

type ChoiceMeta = {
	id: Choice;
	icon: typeof FileIcon;
	label: string;
	desc: string;
	// Default project title pre-filled in step 2 (editable). The AI path
	// derives a title from the description instead, so it starts blank.
	defaultTitle: string;
};

const CHOICES: ReadonlyArray<ChoiceMeta> = [
	{
		id: "empty",
		icon: FileIcon,
		label: "Empty plan",
		desc: "Start from a blank canvas.",
		defaultTitle: "",
	},
	{
		id: "montecarlo",
		icon: DicesIcon,
		label: "Monte Carlo example",
		desc: "Parallel tracks with uncertain estimates — great for exploring the simulation.",
		defaultTitle: MONTE_CARLO_SAMPLE_TITLE,
	},
	{
		id: "tutorial",
		icon: GraduationCapIcon,
		label: "Tutorial plan",
		desc: "A guided website-launch example with a clear critical path.",
		defaultTitle: "Website launch",
	},
	{
		id: "ai",
		icon: WandSparklesIcon,
		label: "Describe with AI",
		desc: "Describe your project (and optionally attach specs/briefs) and the assistant plans it out.",
		defaultTitle: "",
	},
];

const DOC_FACTORIES: Record<
	Exclude<Choice, "ai">,
	(title: string) => PertDoc
> = {
	empty: createEmptyPertDoc,
	montecarlo: createMonteCarloPertDoc,
	tutorial: createTutorialPertDoc,
};

// No-documents path: ask the assistant to draft a first set of tasks for the
// described project, reminding it that edits go through the proposal review gate.
function aiSeedPrompt(description: string): string {
	return `I'm starting a new project: "${description.trim()}". Propose a first set of tasks and dependencies with three-point estimates. I'll review your proposal before anything is applied.`;
}

// With-documents path: the documents are now attached to the project (saved in
// documentsById). Ask the assistant to read the source material, draft a
// review-gated work plan, then build tasks in propose_changes batches. The first
// document is inlined for immediate grounding; the rest are named with their ids
// so the assistant can pull them with read_document on demand.
async function aiSeedPromptWithDocs(
	description: string,
	docs: ProjectDocument[],
): Promise<string> {
	const names = docs.map((d) => d.name).join(", ");
	const plural = docs.length === 1 ? "" : "s";
	const intro = `I'm starting a new project: "${description.trim()}". I've attached ${docs.length} source document${plural} (${names}) — they're saved on the project, so you can re-read any of them with read_document by id.

Please read the source material, then draft a structured work plan with create_work_plan that breaks building this plan into reviewable steps. Stop after creating the plan so I can approve it. Once I approve, build the tasks in batches with propose_changes so I can review each batch before anything is applied. Set metadata.sourceRefs.documentId on tasks you derive from a specific document so their provenance is captured.`;

	// Inline the first document so the assistant has immediate grounding without
	// a mandatory read_document round-trip; the rest stay attached and are read
	// on demand. formatAttachmentBlock lives in file-extract, which is
	// dynamic-imported to keep pdfjs/mammoth out of this chunk.
	const { formatAttachmentBlock } = await import("#/lib/ai/file-extract");
	const firstBlock = formatAttachmentBlock(toExtractedShape(docs[0]));
	const rest = docs.slice(1);
	const restNote =
		rest.length > 0
			? `\n\nAlso attached (read with read_document): ${rest
					.map((d) => `${d.name} (id ${d.id})`)
					.join(", ")}.`
			: "";
	return `${intro}\n\n${firstBlock}${restNote}`;
}

// ProjectDocument carries every field formatAttachmentBlock needs; narrow it to
// the ExtractedFile shape the formatter expects.
function toExtractedShape(doc: ProjectDocument): ExtractedFile {
	return {
		name: doc.name,
		kind: doc.kind,
		text: doc.text,
		truncated: doc.truncated,
		...(typeof doc.pages === "number" ? { pages: doc.pages } : {}),
	};
}

function toProjectDocument(extracted: ExtractedFile): ProjectDocument {
	const doc: ProjectDocument = {
		id: newId("doc"),
		name: extracted.name,
		kind: extracted.kind,
		text: extracted.text,
		truncated: extracted.truncated,
		addedAt: Date.now(),
	};
	if (typeof extracted.pages === "number") doc.pages = extracted.pages;
	return doc;
}

// The project row's `description` column is capped at 500 chars server-side
// (registerProjectInput / updateProjectMetaInput). The dialog's description box
// is intentionally NOT capped — it doubles as the AI seed prompt, where a longer
// brief is useful — so we truncate only the value we persist onto the row,
// keeping the full text for the assistant. Without this, a long description
// would fail validation during reconcile and the project would never register.
const MAX_PERSISTED_DESCRIPTION = 500;

// Fall back to a readable title when the AI-path user only typed a
// description: the first few words, capped, else a generic default.
function deriveTitle(description: string): string {
	const words = description.trim().split(/\s+/).filter(Boolean).slice(0, 6);
	const joined = words.join(" ");
	return joined.length > 0 ? joined.slice(0, 60) : "New project";
}

export function CreateProjectDialog({
	open,
	onOpenChange,
}: CreateProjectDialogProps) {
	const navigate = useNavigate();
	const repo = useOptionalRepo();
	const activeWorkspaceId = useActiveWorkspaceId();
	const [choice, setChoice] = useState<Choice | null>(null);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [error, setError] = useState<string | null>(null);
	// True only during the brief async window where the doc-aware seed prompt is
	// being composed (a dynamic import) before `mutation.mutate` takes over. It
	// keeps the submit button disabled across that gap so a double-click can't
	// mint two local projects.
	const [composingSeed, setComposingSeed] = useState(false);
	const {
		attachments,
		attachmentsBusy,
		ingestFiles,
		removeAttachment,
		clearAttachments,
	} = useFileAttachments();

	// Local-first creation: mint the Automerge doc in the browser repo right
	// away so the project is instantly usable (and offline-durable), queue it in
	// the pending store, optionally seed the assistant, and navigate to it.
	// Registration with the server (and the route remap to the canonical id) is
	// handled by the reconcile loop — which we nudge immediately so an online
	// create still registers within a tick. No network is on this path, so it
	// can't fail when offline.
	const mutation = useMutation({
		// "always": this mutation does no network (doc is created in the local
		// repo, metadata queued in IndexedDB), so it must run even when offline.
		networkMode: "always",
		mutationFn: async (data: {
			title: string;
			makeDoc: (t: string) => PertDoc;
			seedPrompt?: string;
			description?: string;
			documents?: ProjectDocument[];
		}) => {
			if (!repo) throw new Error("Local sync repo isn't ready yet");
			const handle = repo.create(data.makeDoc(data.title));
			// Attach uploaded source documents to the freshly-minted doc in one
			// change, after create() so makeDoc stays pure.
			if (data.documents && data.documents.length > 0) {
				const docs = data.documents;
				handle.change((d: PertDoc) => {
					if (!d.documentsById) d.documentsById = {};
					for (const doc of docs) d.documentsById[doc.id] = doc;
				});
			}
			const localId = randomId();
			await addPending({
				localId,
				title: data.title,
				automergeDocUrl: handle.url,
				createdAt: new Date().toISOString(),
				...(data.description ? { description: data.description } : {}),
				...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
			});
			return { localId, seedPrompt: data.seedPrompt };
		},
		onSuccess: ({ localId, seedPrompt }) => {
			// Queue the seed first so the chat (which binds to the project on the
			// next route) auto-sends it once mounted.
			if (seedPrompt) chatDock.startWith(seedPrompt, { autoSend: true });
			close();
			navigate({ to: "/p/$projectId", params: { projectId: localId } });
			// Fire-and-forget: register now if we're online + authed.
			void requestReconcile();
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unknown error"),
	});

	// Reset the whole wizard when the dialog closes so the next open starts at
	// the choice step with empty inputs.
	const close = () => {
		onOpenChange(false);
		setChoice(null);
		setTitle("");
		setDescription("");
		setError(null);
		clearAttachments();
	};

	const pick = (next: ChoiceMeta) => {
		setChoice(next.id);
		setTitle(next.defaultTitle);
		setDescription("");
		setError(null);
		clearAttachments();
	};

	const back = () => {
		setChoice(null);
		setError(null);
		clearAttachments();
	};

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		if (!choice) return;
		// Re-entrancy guard: Enter can fire submit even while a create is in
		// flight (the button is disabled, the keyboard isn't).
		if (mutation.isPending || composingSeed) return;

		if (choice === "ai") {
			const desc = description.trim();
			if (!desc) {
				setError(
					"Describe your project so the assistant has something to plan.",
				);
				return;
			}
			if (attachmentsBusy) return;
			const finalTitle = title.trim() || deriveTitle(desc);
			// Full text drives the AI seed; only the persisted row summary is capped.
			const persistedDescription = desc.slice(0, MAX_PERSISTED_DESCRIPTION);
			const documents = attachments
				.filter(isReadyAttachment)
				.map((a) => toProjectDocument(a.extracted));

			if (documents.length === 0) {
				mutation.mutate({
					title: finalTitle,
					makeDoc: createEmptyPertDoc,
					seedPrompt: aiSeedPrompt(desc),
					description: persistedDescription,
				});
				return;
			}
			// Composing the doc-aware seed needs file-extract's formatter, so
			// resolve it before kicking off the mutation. Hold the button disabled
			// across that async gap (see `composingSeed`).
			setComposingSeed(true);
			void (async () => {
				try {
					const seedPrompt = await aiSeedPromptWithDocs(desc, documents);
					mutation.mutate({
						title: finalTitle,
						makeDoc: createEmptyPertDoc,
						seedPrompt,
						description: persistedDescription,
						documents,
					});
				} catch (err) {
					setError(
						err instanceof Error ? err.message : "Could not prepare documents",
					);
				} finally {
					// mutation.isPending now keeps the button disabled on the happy
					// path; on a compose failure this re-enables it for a retry.
					setComposingSeed(false);
				}
			})();
			return;
		}

		const trimmed = title.trim();
		if (!trimmed) {
			setError("Title is required");
			return;
		}
		mutation.mutate({ title: trimmed, makeDoc: DOC_FACTORIES[choice] });
	};

	const selected = choice ? CHOICES.find((c) => c.id === choice) : null;
	const submitDisabled =
		mutation.isPending || composingSeed || (choice === "ai" && attachmentsBusy);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => (o ? onOpenChange(true) : close())}
		>
			<DialogContent className="sm:max-w-md">
				{!choice ? (
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>New project</DialogTitle>
							<DialogDescription>
								Pick a starting point. Each project gets its own Automerge
								document — you'll be its owner.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							{CHOICES.map((c) => {
								const Icon = c.icon;
								return (
									<button
										key={c.id}
										type="button"
										onClick={() => pick(c)}
										data-testid={`create-choice-${c.id}`}
										className="flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
											<Icon className="size-[1.125rem]" />
										</div>
										<div className="min-w-0">
											<div className="font-medium">{c.label}</div>
											<div className="text-sm text-muted-foreground">
												{c.desc}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : (
					<form onSubmit={submit} className="space-y-4">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<button
									type="button"
									onClick={back}
									disabled={mutation.isPending}
									aria-label="Back to starting points"
									className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
								>
									<ArrowLeftIcon className="size-4" />
								</button>
								{selected?.label}
							</DialogTitle>
							<DialogDescription>{selected?.desc}</DialogDescription>
						</DialogHeader>

						{choice === "ai" && (
							<>
								<div className="space-y-2">
									<Label htmlFor="project-description">
										Describe your project
									</Label>
									<Textarea
										id="project-description"
										autoFocus
										rows={3}
										value={description}
										onChange={(e) => setDescription(e.target.value)}
										placeholder="e.g. Launch a mobile app — design, build, QA, and a marketing push."
										disabled={mutation.isPending}
									/>
								</div>
								<div className="space-y-2">
									<Label>Source documents (optional)</Label>
									<AttachmentDropZone
										attachments={attachments}
										onIngest={ingestFiles}
										onRemove={removeAttachment}
										disabled={mutation.isPending}
									/>
									<p className="text-xs text-muted-foreground">
										Specs, briefs, or notes the assistant should plan from. They
										stay attached to the project.
									</p>
								</div>
							</>
						)}

						<div className="space-y-2">
							<Label htmlFor="project-title">
								Title{choice === "ai" ? " (optional)" : ""}
							</Label>
							<Input
								id="project-title"
								autoFocus={choice !== "ai"}
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder={
									choice === "ai"
										? "Derived from your description if left blank"
										: "e.g. Q3 launch plan"
								}
								disabled={mutation.isPending}
							/>
							{error && (
								<p className="text-sm text-destructive" role="alert">
									{error}
								</p>
							)}
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="ghost"
								onClick={close}
								disabled={mutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={submitDisabled}>
								{mutation.isPending || composingSeed
									? "Creating…"
									: choice === "ai" && attachmentsBusy
										? "Reading files…"
										: choice === "ai"
											? "Create & draft"
											: "Create"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
