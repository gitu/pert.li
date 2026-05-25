import { useStore } from "@tanstack/react-store";
import { TaskInspector } from "#/components/pert/inspector/task-inspector";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { selectionStore, selectTask } from "#/lib/pert/store";

// Mobile selection-driven inspector. Opens whenever the selection store
// has a task id for the active project; closing dismisses the selection so
// the user lands back on the underlying view without a stuck overlay.
// The body is the same TaskInspector that the desktop bottom panel uses —
// its read-only behaviour already follows `!changeDoc`, so when Phase 5
// flips the read-only flag the form fields gray out without any change
// inside this file.

type Props = {
	projectId: string;
};

export function MobileInspectorSheet({ projectId }: Props) {
	const selectedTaskId = useStore(selectionStore, (s) =>
		s.projectId === projectId ? s.taskId : null,
	);
	const open = selectedTaskId !== null;
	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) selectTask(projectId, null);
			}}
		>
			<SheetContent
				side="bottom"
				className="flex h-[90svh] flex-col gap-0 p-0"
				data-testid="mobile-inspector-sheet"
			>
				<SheetHeader className="shrink-0 border-b px-3 py-2 text-left">
					<SheetTitle className="text-sm">Task details</SheetTitle>
					<SheetDescription className="sr-only">
						Inspect and edit the selected task.
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-hidden">
					<TaskInspector />
				</div>
			</SheetContent>
		</Sheet>
	);
}
