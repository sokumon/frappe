// boot/provide.ts
//
// Native port of the legacy `frappe/provide.js` (formerly the first file in the
// removed `desk.bundle.js` "framework bundle"). It seeds `window.frappe`, defines
// `frappe.provide` (the namespace-builder), and pre-creates the namespaces +
// window globals that the rest of the desk expects to already exist.
//
// TIMING (critical): must run BEFORE any desk bundle is appended. In particular
// controls.bundle.js's control.js and every erpnext/india_compliance client
// script call `frappe.provide(...)` at module-eval, so this has to be installed
// at the very top of initFrappe(), before appendScripts().

// provide a namespace
export function installProvide() {
	if (!window.frappe) window.frappe = {}

	frappe.provide = function (namespace: string) {
		// docs: create a namespace //
		const nsl = namespace.split(".")
		let parent: any = window
		for (let i = 0; i < nsl.length; i++) {
			const n = nsl[i]
			if (!parent[n]) {
				parent[n] = {}
			}
			parent = parent[n]
		}
		return parent
	}

	frappe.provide("locals")
	frappe.provide("frappe.flags")
	frappe.provide("frappe.settings")
	frappe.provide("frappe.utils")
	frappe.provide("frappe.ui.form")
	frappe.provide("frappe.modules")
	frappe.provide("frappe.templates")
	frappe.provide("frappe.test_data")
	frappe.provide("frappe.utils")
	frappe.provide("frappe.model")
	frappe.provide("frappe.user")
	frappe.provide("frappe.session")
	frappe.provide("frappe._messages")
	frappe.provide("locals.DocType")

	// for listviews
	frappe.provide("frappe.listview_settings")
	frappe.provide("frappe.tour")
	frappe.provide("frappe.listview_parent_route")
	frappe.provide("frappe.treeview_settings")

	// constants
	window.NEWLINE = "\n"
	window.TAB = 9
	window.UP_ARROW = 38
	window.DOWN_ARROW = 40

	// API globals
	window.cur_frm = null
}
