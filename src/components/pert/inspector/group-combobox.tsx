import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "#/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

export type GroupComboboxOption = { id: string; label: string };

// Searchable group picker with inline "create new group" support. Replaces the
// plain <Select> in the task inspector so a task can be filed into a brand-new
// group without leaving the editor. Purely presentational: the parent owns the
// option list and both mutations (assign via `onChange`, create+assign via
// `onCreate`). cmdk's built-in filter is disabled (`shouldFilter={false}`) so we
// control the "Create …" row ourselves — it must survive filtering even when no
// existing group matches the query.
export function GroupCombobox({
	value,
	options,
	onChange,
	onCreate,
	disabled = false,
	id,
}: {
	value: string | null;
	options: GroupComboboxOption[];
	onChange: (groupId: string | null) => void;
	onCreate: (name: string) => void;
	disabled?: boolean;
	id?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");

	const selectedLabel = value
		? (options.find((o) => o.id === value)?.label ?? "Untitled")
		: "(none)";

	const trimmed = query.trim();
	const filtered = useMemo(() => {
		if (!trimmed) return options;
		const needle = trimmed.toLowerCase();
		return options.filter((o) => o.label.toLowerCase().includes(needle));
	}, [options, trimmed]);

	// Offer "Create" only when the typed name doesn't already name an existing
	// group (case-insensitive, comparing against the bare name, not the numbered
	// label) — otherwise the user is just searching for the group that exists.
	const exactExists = useMemo(
		() =>
			trimmed.length > 0 &&
			options.some(
				(o) => stripNumber(o.label).toLowerCase() === trimmed.toLowerCase(),
			),
		[options, trimmed],
	);
	const canCreate = trimmed.length > 0 && !exactExists;

	const close = () => {
		setOpen(false);
		setQuery("");
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setQuery("");
			}}
		>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					data-testid="inspector-group"
					className="w-full justify-between font-normal"
				>
					<span className="truncate">{selectedLabel}</span>
					<ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-(--radix-popover-trigger-width) p-0"
				align="start"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or create a group…"
						value={query}
						onValueChange={setQuery}
						data-testid="group-combobox-input"
					/>
					<CommandList>
						{filtered.length === 0 && !canCreate && (
							<CommandEmpty>No groups found.</CommandEmpty>
						)}
						<CommandGroup>
							<CommandItem
								value="__none__"
								data-testid="group-combobox-none"
								onSelect={() => {
									onChange(null);
									close();
								}}
							>
								<CheckIcon
									className={cn(
										"size-4",
										value === null ? "opacity-100" : "opacity-0",
									)}
								/>
								<span className="text-muted-foreground">(none)</span>
							</CommandItem>
							{filtered.map((o) => (
								<CommandItem
									key={o.id}
									value={o.id}
									data-testid={`group-combobox-option-${o.id}`}
									onSelect={() => {
										onChange(o.id);
										close();
									}}
								>
									<CheckIcon
										className={cn(
											"size-4",
											value === o.id ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="truncate">{o.label}</span>
								</CommandItem>
							))}
						</CommandGroup>
						{canCreate && (
							<>
								<CommandSeparator />
								<CommandGroup>
									<CommandItem
										value={`__create__${trimmed}`}
										data-testid="group-combobox-create"
										onSelect={() => {
											onCreate(trimmed);
											close();
										}}
									>
										<PlusIcon className="size-4" />
										<span className="truncate">
											Create{" "}
											<span className="font-medium text-foreground">
												“{trimmed}”
											</span>
										</span>
									</CommandItem>
								</CommandGroup>
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

// Group labels are rendered as "<wbs-number> <name>" (e.g. "1.2 Design phase").
// Strip a leading dotted-number token so the "create" dedupe compares against
// the human name the user actually typed.
function stripNumber(label: string): string {
	return label.replace(/^[\d.]+\s+/, "").trim();
}
