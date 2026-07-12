import { defineConfig } from 'vitest/config'
import path from 'path'

// Minimal, hermetic Vitest config for the Vue-native control-hierarchy contract
// tests (frontend/src/form/controls). It deliberately does NOT load the app's Vite
// plugins (frappe-ui / frameworkUI / vue-SFC):
//
//   • the control classes import only *types* from `@framework/ui` (erased at
//     transform time), and
//   • the tests import the pure layout helpers (buildLayoutFromMeta /
//     applyMetaScript / resolveLayout) directly from their `@framework/ui/*`
//     submodule paths — all pure TS.
//
// So no `.vue` file is ever evaluated and no browser-only frappe-ui module loads,
// which keeps the suite fast and independent of the app build. The app build itself
// (`vite build`) must never run here.
export default defineConfig({
	resolve: {
		alias: [
			// Bare barrel is type-only in the controls; map it so an accidental
			// runtime import fails loudly at the index rather than silently.
			{ find: /^@framework\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
			// `@framework/ui/components/FormLayout/buildLayoutFromMeta` → ui/src/…
			{ find: /^@framework\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
			{ find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
		],
	},
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.{test,spec}.ts'],
		setupFiles: [path.resolve(__dirname, 'src/form/controls/__tests__/setup.ts')],
	},
})
