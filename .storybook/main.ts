import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const here = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [],
	framework: {
		name: "@storybook/react-vite",
		options: {
			builder: {
				viteConfigPath: resolve(here, "vite.config.ts"),
			},
		},
	},
};

export default config;
