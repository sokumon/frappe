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
	}
}
