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
import { useOptionalRepo } from "#/lib/automerge/provider";
import { chatDock } from "#/lib/chat-dock";
import {
	createMonteCarloPertDoc,
	MONTE_CARLO_SAMPLE_TITLE,
} from "#/lib/pert/sample-montecarlo-project";
import { createTutorialPertDoc } from "#/lib/pert/sample-tutorial-project";
import { createEmptyPertDoc, type PertDoc } from "#/lib/pert/types";
import { randomId } from "#/lib/random-id";
import { addPending } from "#/lib/sync/pending-projects";
import { requestReconcile } from "#/lib/sync/reconcile-pending";

export type CreateProjectDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

// The four ways to start a plan. `empty` keeps the original blank-doc flow;
// the two samples seed a ready-made graph; `ai` mints an empty doc and hands
// the description to the assistant, which drafts the first tasks via the
// normal propose_changes review gate.
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
		desc: "Tell the assistant about your project and it drafts the first tasks.",
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

// Mirror the ACTION_SEEDS voice: ask the assistant to draft a first set of
// tasks for the described project, explicitly reminding it that edits go
// through the proposal review gate.
function aiSeedPrompt(description: string): string {
	return `I'm starting a new project: "${description.trim()}". Propose a first set of tasks and dependencies with three-point estimates. I'll review your proposal before anything is applied.`;
}

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
		}) => {
			if (!repo) throw new Error("Local sync repo isn't ready yet");
			const handle = repo.create(data.makeDoc(data.title));
			const localId = randomId();
			await addPending({
				localId,
				title: data.title,
				automergeDocUrl: handle.url,
				createdAt: new Date().toISOString(),
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
	};

	const pick = (next: ChoiceMeta) => {
		setChoice(next.id);
		setTitle(next.defaultTitle);
		setDescription("");
		setError(null);
	};

	const back = () => {
		setChoice(null);
		setError(null);
	};

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		if (!choice) return;

		if (choice === "ai") {
			const desc = description.trim();
			if (!desc) {
				setError(
					"Describe your project so the assistant has something to plan.",
				);
				return;
			}
			const finalTitle = title.trim() || deriveTitle(desc);
			mutation.mutate({
				title: finalTitle,
				makeDoc: createEmptyPertDoc,
				seedPrompt: aiSeedPrompt(desc),
			});
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
							<Button type="submit" disabled={mutation.isPending}>
								{mutation.isPending
									? "Creating…"
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
