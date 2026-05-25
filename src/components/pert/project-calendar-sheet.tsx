import { CalendarDaysIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "#/components/ui/sheet";
import { DEFAULT_WORKING_DAYS, todayIsoDate } from "#/lib/pert/calendar";
import type { PertDoc, ProjectCalendar } from "#/lib/pert/types";
import { ProjectCalendarForm } from "./project-calendar-form";

// Trigger button + sheet shell around the calendar form. The form lives in its
// own file with a `key` reset on every open so its local state seeds from the
// freshest doc value without needing a useEffect (a collaborator may have
// edited the calendar while the sheet was closed).

export function ProjectCalendarSheet({
	doc,
	changeDoc,
}: {
	doc: PertDoc;
	changeDoc: (mutate: (d: PertDoc) => void) => void;
}) {
	const [open, setOpen] = useState(false);
	const current: ProjectCalendar = doc.calendar ?? {
		startDate: todayIsoDate(),
		workingDays: DEFAULT_WORKING_DAYS,
	};
	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-8 gap-1.5 text-xs"
					data-testid="project-calendar-button"
					title="Project calendar"
				>
					<CalendarDaysIcon className="size-3.5" />
					Calendar
				</Button>
			</SheetTrigger>
			<SheetContent
				side="right"
				className="w-[360px] sm:max-w-[360px]"
				data-testid="project-calendar-sheet"
			>
				<SheetHeader>
					<SheetTitle>Project calendar</SheetTitle>
					<SheetDescription>
						Used to convert schedule offsets into real dates and to skip
						non-working days when computing finish dates.
					</SheetDescription>
				</SheetHeader>
				{open && (
					<ProjectCalendarForm
						initial={current}
						doc={doc}
						onCancel={() => setOpen(false)}
						onSave={(next) => {
							changeDoc((d) => {
								// Automerge rejects `undefined` assignments — only include
								// `holidays` when the previous value actually carried one.
								const previousHolidays = d.calendar?.holidays;
								const calendar: ProjectCalendar = {
									startDate: next.startDate,
									workingDays:
										next.workingDays.length > 0
											? next.workingDays
											: DEFAULT_WORKING_DAYS,
									allocationMode: next.allocationMode,
									team: {
										peopleCount: next.team.peopleCount,
										availabilityPct: next.team.availabilityPct,
										...(next.team.useHistoric ? { useHistoric: true } : {}),
									},
								};
								if (previousHolidays) calendar.holidays = previousHolidays;
								d.calendar = calendar;
							});
							setOpen(false);
						}}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}
