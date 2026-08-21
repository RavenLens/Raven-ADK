import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		agents: "src/agent/public.ts",
		models: "src/models/index.ts",
		"models/server": "src/models/server.ts",
		tools: "src/agent/tools/public.ts",
		browser: "src/browser.ts"
	},
	format: ["esm", "cjs"],
	dts: true,
	splitting: true,
	sourcemap: true,
	clean: true,
	outDir: "dist",
	target: "es2022",
	platform: "neutral",
	treeshake: true,
	external: [
		"node:*",
		"fs/promises",
		"fs",
		"path",
		"http",
		"https",
		"url",
		"util",
		"stream",
		"events",
		"buffer",
		"child_process",
		"module",
		"os",
		"crypto",
		"obsidian",
		"openai",
		"runpod-sdk",
		"@anthropic-ai/sdk",
		"@google/genai",
		"@modelcontextprotocol/sdk",
		"@e2b/code-interpreter",
		"zod"
	]
});