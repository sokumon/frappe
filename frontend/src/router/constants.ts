// Shared, pure helpers and lookup tables ported from the legacy
// `frappe/public/js/frappe/router.js`. Kept dependency-free so both the
// route table, the guards and the backward-compat shim can import them.

// Views that have a dedicated factory/component (route[0] values).
export const FACTORY_VIEWS = ["form", "list", "report", "tree", "print", "dashboard"]

// Maps a list `view` url segment -> the standard-route label used by the
// legacy desk (["List", doctype, <label>]).
export const LIST_VIEWS_ROUTE: Record<string, string> = {
	list: "List",
	kanban: "Kanban",
	report: "Report",
	calendar: "Calendar",
	tree: "Tree",
	gantt: "Gantt",
	dashboard: "Dashboard",
	image: "Image",
	inbox: "Inbox",
	file: "Home",
	map: "Map",
}

export function slug(name: string): string {
	return name.toLowerCase().replace(/ /g, "-")
}

// Best-effort inverse of `slug`. Lossy – only used as a fallback when the
// slug -> doctype map (built from boot) does not contain an entry.
export function unslug(slugged: string): string {
	return slugged
		.replace(/_/g, "-")
		.replace(/--/g, "-")
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ")
}

export function isPlainObject(value: unknown): value is Record<string, any> {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.prototype.toString.call(value) === "[object Object]"
	)
}

export function decodeComponent(part: string): string {
	try {
		return decodeURIComponent(part)
	} catch (e) {
		// legacy behaviour: ignore malformed URI components
		if (e instanceof URIError) return part
		throw e
	}
}
