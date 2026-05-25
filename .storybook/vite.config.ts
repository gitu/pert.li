import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Storybook-only vite config. The project's root vite.config.ts wires up
// nitro + tanstack-start, which assume a server runtime Storybook doesn't
// provide, so Storybook needs its own minimal plugin chain.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [viteReact(), tailwindcss()],
});
