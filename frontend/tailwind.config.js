import frappeUIPreset from 'frappe-ui/tailwind'
import { scopedPreflightStyles, isolateOutsideOfContainer } from 'tailwindcss-scoped-preflight'

export default {
	presets: [frappeUIPreset],
	content: [
		'./index.html',
		'./src/**/*.{vue,js,ts,jsx,tsx}',
		'./node_modules/frappe-ui/src/**/*.{vue,js,ts,jsx,tsx}',
		// @framework/ui ships raw source compiled in place (linked at ../ui). Its
		// components use classes — arbitrary values like
		// `grid-cols-[30px_minmax(auto,_1fr)]` and `after:start-[50%]` — that appear
		// nowhere else, so Tailwind must scan the source to generate them, else those
		// components' layout collapses. Real path (not the node_modules symlink) so
		// fast-glob traverses it.
		'../ui/src/**/*.{vue,js,ts,jsx,tsx}',
		// INFO: uncomment the line below if you have workspaces set up
		// '../node_modules/frappe-ui/src/**/*.{vue,js,ts,jsx,tsx}',
	],
	theme: {
		extend: {},
	},
	plugins: [
		// Tailwind's preflight reset clobbers the legacy desk styles rendered
		// inside `.old-desk-view`. Scope preflight so it only applies to the new
		// Vue shell *outside* that container, leaving the old desk untouched.
		// `plus: '.tw'` re-applies preflight inside `.tw` islands — Tailwind
		// components embedded deep within the old desk that DO need the reset
		// (mirrors the desk SCSS `@scope (.old-desk-view, .modal) to (.tw)`).
		scopedPreflightStyles({
			isolationStrategy: isolateOutsideOfContainer('.old-desk-view', {
				plus: '.tw',
			}),
			// The plugin re-injects preflight *after* the frappe-ui preset's
			// `addBase`, so preflight's `html { font-family: <system sans> }` would
			// otherwise override frappe-ui's `html { font-family: InterVar }` and
			// leave the whole shell on the system font. Drop font-family from the
			// preflight root rule so frappe-ui's Inter default wins (and inherits).
			modifyPreflightStyles: {
				html: { 'font-family': null },
			},
		}),
	],
}
