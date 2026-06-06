import { resetRunsFile } from "./report";

// Vitest global setup for the eval suite: clear the JSONL results sink once
// before any scenario runs, so scores from a previous `pnpm eval` don't bleed
// into this run's aggregate. Scenario files (across workers) then append.
export default function setup(): void {
	resetRunsFile();
}
