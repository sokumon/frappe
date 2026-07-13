export {}

declare global {
	// The legacy desk exposes a huge, dynamically-built `frappe` namespace.
	// It is intentionally untyped here – this declaration only exists so the
	// router can reference globals (frappe, locals, system_timezone) under
	// `strict` without per-file `// @ts-ignore`.
	var frappe: any
	var locals: any
	interface Window {
		frappe: any
		system_timezone?: string
		// Framework formatting defaults consumed by @framework/ui FormLayout fields.
		sysdefaults?: any
		_router?: import('vue-router').Router
		// Translation alias seeded by boot/translate.ts (ported from translate.js).
		__?: (txt: string, replace?: any, context?: string | null) => string
		// Desk globals seeded by boot/provide.ts (ported from provide.js).
		NEWLINE?: string
		TAB?: number
		UP_ARROW?: number
		DOWN_ARROW?: number
		cur_frm?: any
		// Page context spilled onto window by the built newdesk.html (frappe-ui's
		// jinjaBootData plugin renders window["<key>"] = ... for every key of
		// www/newdesk.py's context.boot). Read by initFrappe in main.ts.
		frappe_boot?: any
		csrf_token?: string
		app_include_js?: string[]
		app_include_css?: string[]
		app_include_icons?: string[]
		build_version?: string
		desk_theme?: string
		app_name?: string
		lang?: string
		layout_direction?: string
		favicon?: string
		sounds?: { name: string; src: string; volume?: number }[]
	}
}
