import { createFileRoute, Link } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";
import { VersionFooter } from "#/components/legal/version-footer";
import { BUILD_TIME, BUILD_VERSION } from "#/lib/build-info";

export const Route = createFileRoute("/about")({
	component: AboutPage,
});

const REPO_URL = "https://github.com/gitu/pert.li";

// Curated highlights of the open-source projects pert.li is built on. License
// labels were taken from each package's `license` field in node_modules; the
// full dependency list lives in the repo's package.json (linked at the bottom).
const OPEN_SOURCE: Array<{
	name: string;
	href: string;
	license: string;
	note: string;
}> = [
	{
		name: "TanStack",
		href: "https://tanstack.com",
		license: "MIT",
		note: "Start, Router, Query, Store, React DB, Table, and the AI SDK.",
	},
	{
		name: "React",
		href: "https://react.dev",
		license: "MIT",
		note: "UI library, with the React Compiler.",
	},
	{
		name: "Drizzle ORM",
		href: "https://orm.drizzle.team",
		license: "Apache-2.0",
		note: "Type-safe SQL and migrations.",
	},
	{
		name: "Neon serverless · PGLite",
		href: "https://neon.tech",
		license: "MIT · Apache-2.0",
		note: "Postgres in prod (Neon) and an in-process Postgres in dev (PGLite).",
	},
	{
		name: "Automerge",
		href: "https://automerge.org",
		license: "MIT",
		note: "CRDT engine behind real-time collaboration.",
	},
	{
		name: "Better Auth",
		href: "https://better-auth.com",
		license: "MIT",
		note: "Email, magic-link, and OIDC authentication.",
	},
	{
		name: "Tailwind CSS · shadcn/ui · Radix UI",
		href: "https://tailwindcss.com",
		license: "MIT",
		note: "Styling and accessible component primitives.",
	},
	{
		name: "React Flow · elkjs",
		href: "https://reactflow.dev",
		license: "MIT · EPL-2.0",
		note: "Canvas graph rendering and automatic layout.",
	},
	{
		name: "Zod",
		href: "https://zod.dev",
		license: "MIT",
		note: "Schema validation across the app.",
	},
	{
		name: "Lucide",
		href: "https://lucide.dev",
		license: "ISC",
		note: "Icon set.",
	},
	{
		name: "Vite · Nitro",
		href: "https://vite.dev",
		license: "MIT",
		note: "Build tooling and the Node-compatible server output.",
	},
	{
		name: "Biome",
		href: "https://biomejs.dev",
		license: "MIT OR Apache-2.0",
		note: "Linting and formatting.",
	},
];

function formatBuildTime(iso: string | null): string | null {
	if (!iso) return null;
	// Format deterministically straight from the ISO string — no locale or
	// timezone lookup. The server and client must render the byte-identical
	// string or React reports a hydration mismatch (and `toLocaleString`
	// resolves differently under the server's locale/TZ than the browser's).
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
	if (!match) return null;
	const [, year, month, day, hour, minute] = match;
	return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function AboutPage() {
	const buildTime = formatBuildTime(BUILD_TIME);

	return (
		<div className="min-h-svh bg-background">
			<header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
				<Link to="/" className="flex items-center gap-2">
					<div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
						<LayersIcon className="size-4" />
					</div>
					<span className="text-base font-semibold tracking-tight">
						pert.li
					</span>
				</Link>
				<Link
					to="/signin"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					Sign in
				</Link>
			</header>

			<main className="mx-auto max-w-3xl px-6 pb-24">
				<article className="prose prose-zinc dark:prose-invert max-w-none">
					<h1 className="text-3xl font-semibold tracking-tight">
						About pert.li
					</h1>
					<p className="text-sm text-muted-foreground">
						pert.li is a collaborative project-planning app — task graphs,
						dependencies, and a built-in AI assistant — built on TanStack Start
						and powered by Claude.
					</p>

					<h2 className="mt-10 text-xl font-semibold tracking-tight">
						Open source
					</h2>
					<p>
						pert.li is{" "}
						<strong>
							free and open source software, released under the MIT license
						</strong>
						. The complete source code is public — read it, fork it, self-host
						it, or contribute back.
					</p>
					<ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm">
						<li>
							Source code:{" "}
							<a href={REPO_URL} target="_blank" rel="noreferrer">
								github.com/gitu/pert.li
							</a>
						</li>
						<li>
							License:{" "}
							<a
								href={`${REPO_URL}/blob/main/LICENSE`}
								target="_blank"
								rel="noreferrer"
							>
								MIT
							</a>
						</li>
						<li>
							Self-hosting guide:{" "}
							<a
								href={`${REPO_URL}/blob/main/SELF_HOSTING.md`}
								target="_blank"
								rel="noreferrer"
							>
								SELF_HOSTING.md
							</a>{" "}
							— ships as a Docker image you can run yourself.
						</li>
					</ul>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">Build</h2>
					<p className="text-sm">
						The exact build you're running. The version string comes from{" "}
						<code>git describe</code>, so it embeds the commit it was built from
						(for example <code>v0.3.2-4-gabc1234</code>).
					</p>
					<dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
						<dt className="text-muted-foreground">Version</dt>
						<dd
							className="font-mono tabular-nums"
							data-testid="about-build-version"
						>
							{BUILD_VERSION}
						</dd>
						{buildTime ? (
							<>
								<dt className="text-muted-foreground">Built</dt>
								<dd className="tabular-nums">{buildTime}</dd>
							</>
						) : null}
					</dl>

					<h2 className="mt-8 text-xl font-semibold tracking-tight">
						Open-source software we build on
					</h2>
					<p className="text-sm">
						pert.li stands on the work of many open-source projects. A few of
						the load-bearing ones:
					</p>
					<ul className="mt-3 list-none space-y-2.5 pl-0 text-sm">
						{OPEN_SOURCE.map((dep) => (
							<li key={dep.name} className="pl-0">
								<a href={dep.href} target="_blank" rel="noreferrer">
									{dep.name}
								</a>{" "}
								<span className="text-xs text-muted-foreground">
									({dep.license})
								</span>
								<span className="block text-muted-foreground">{dep.note}</span>
							</li>
						))}
					</ul>
					<p className="mt-4 text-sm">
						This is a curated highlight, not the full list — see the{" "}
						<a
							href={`${REPO_URL}/blob/main/package.json`}
							target="_blank"
							rel="noreferrer"
						>
							complete set of dependencies
						</a>{" "}
						in <code>package.json</code>. Each project is governed by its own
						license; the labels above are a quick reference, not legal advice.
					</p>
				</article>

				<div className="mt-10 flex items-center justify-between gap-3 text-xs text-muted-foreground">
					<Link to="/" className="hover:text-foreground">
						← back to home
					</Link>
					<VersionFooter className="text-xs text-muted-foreground/70 tabular-nums" />
				</div>
			</main>
		</div>
	);
}
