// Navigation guards – the "brain" that replaces the legacy router's
// parse() / set_doctype_route() / re_route() logic.

import type { RouteLocationNormalized } from "vue-router"
import { ensureRouterReady, getDoctypeRoute, isAllowedPage } from "./compat"

// Global gate, runs on every navigation (beforeEach):
//  - runs frappe.router.setup() (slug->doctype map + workspaces) once boot is up
//  - forces the setup wizard until setup is complete
//  - applies the rename map (frappe.re_route)
export function gate(to: RouteLocationNormalized) {
	const boot = frappe?.boot
	if (!boot) return // boot not loaded yet, nothing to enforce

	// build the slug->doctype map and workspaces (legacy frappe.router.setup)
	ensureRouterReady()

	// setup wizard gating
	if (boot.setup_complete === 0 || boot.setup_complete === false) {
		if (!to.path.startsWith("/setup-wizard")) {
			return { path: "/setup-wizard" }
		}
	} else if (to.path.startsWith("/setup-wizard")) {
		// already set up – don't allow the wizard route
		return { path: "/" }
	}

	// rename map: { "old-sub-path": "new-sub-path" }
	const subPath = to.path.replace(/^\//, "")
	const renamed = frappe.re_route?.[subPath]
	if (renamed) {
		// replace history so the stale entry is not navigable via back button
		return { path: "/" + String(renamed).replace(/^\//, ""), replace: true }
	}
}

// Per-route guard for the ambiguous single-segment route `/:slug`.
// Decides whether the slug is a workspace (rendered by the dispatcher) or a
// doctype, and for doctypes resolves the correct landing view (form for single
// doctypes, the configured default_view / tree, otherwise the list).
export async function resolveSlug(to: RouteLocationNormalized) {
	const s = String(to.params.slug)
	// workspace -> let the DoctypeOrWorkspace dispatcher render it
	if (frappe.workspaces?.[s]) return

	const entry = getDoctypeRoute(s)
	if (!entry) {
		// not a doctype – it may be a Frappe Page, otherwise 404
		if (isAllowedPage(s)) return // dispatcher renders <Page>
		return { name: "not-found", params: { pathMatch: s.split("/") } }
	}

	const doctype = entry.doctype
	// load meta before deciding the view (legacy frappe.model.with_doctype)
	await new Promise<void>((resolve) => frappe.model.with_doctype(doctype, resolve))
	const meta = frappe.get_meta(doctype)

	// single doctype: rendered as a form by the dispatcher. This keeps the
	// single-segment url (e.g. /system-settings); the dispatcher uses the real
	// doctype as the document name (legacy ["Form", doctype, doctype]).
	if (frappe.model.is_single(doctype)) return

	const defaultView = meta?.default_view
	if (defaultView) {
		const view = defaultView === "Tree" ? "tree" : String(defaultView).toLowerCase()
		return { name: "list-view", params: { doctype: doctype, view } }
	}
	
	// plain list -> dispatcher renders <List>
}
