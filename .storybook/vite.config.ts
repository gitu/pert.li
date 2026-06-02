import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { getAppVersion } from "../scripts/compute-version.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

// Mirror the root vite.config.ts: surface the build version on
// `import.meta.env.VITE_APP_VERSION` so stories that read it (VersionFooter)
// render the resolved version instead of the bare fallback.
process.env.VITE_APP_VERSION = getAppVersion();

// Storybook-only vite config. The project's root vite.config.ts wires up
// nitro + tanstack-start, which assume a server runtime Storybook doesn't
// provide, so Storybook needs its own minimal plugin chain.
//
// wasm + topLevelAwait are required because some stories transitively pull
// in `@automerge/automerge` (e.g. presence-badge), whose ESM build imports a
// `.wasm` side-file and uses top-level await. Without these plugins vite's
// built-in fallback prints "ESM integration proposal for Wasm is not
// supported currently".
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: [
			// Stories that pull in components which import server fns (e.g.
			// branch-project-dialog → #/server/workspace → @tanstack/react-start)
			// trip Vite on the `#tanstack-start-entry` subpath import. The
			// Storybook env has no Nitro runtime, so we stub it.
			//
			// Subpath aliases (e.g. `@tanstack/react-start/server`) must be
			// listed BEFORE the bare-package alias — vite picks the first match,
			// so `find` strings are checked top to bottom.
			{
				find: /^@tanstack\/react-start\/server$/,
				replacement: resolve(here, "stubs/tanstack-react-start/server.ts"),
			},
			{
				find: /^@tanstack\/react-start$/,
				replacement: resolve(here, "stubs/tanstack-react-start/index.ts"),
			},
		],
	},
	// `vite-plugin-top-level-await` emits modern syntax (destructuring) the
	// default esbuild target (es2020) won't accept; bump to es2022 so the
	// production storybook build doesn't choke transforming its own output.
	build: { target: "es2022" },
	optimizeDeps: { esbuildOptions: { target: "es2022" } },
	plugins: [viteReact(), tailwindcss(), wasm(), topLevelAwait()],
});
