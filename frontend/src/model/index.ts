// model/index.ts
//
// Installs the `frappe.model` / `frappe.meta` / `frappe.perm` / `frappe.workflow`
// namespaces (+ the `locals` doc store they populate) onto the global `frappe`.
// These are verbatim ports of frappe/public/js/frappe/model/*.js, which used to
// ship in the removed `desk.bundle.js` ("framework bundle").
//
// `locals` itself (the client-side doc cache keyed as locals[doctype][name]) is
// created by boot/provide.ts (frappe.provide("locals") / "locals.DocType"); the
// sync module below is what fills it from boot data + server responses.
//
// TIMING (critical): needs only frappe.provide (from boot/provide.ts, run at the
// top of initFrappe) at eval — the merges below use native Object.assign, so no
// jQuery-at-eval dependency. Must run BEFORE the erpnext bundle (client scripts
// read frappe.model) + frappeApp.load_bootinfo (which calls frappe.model.sync).
// main.ts installs it at the first non-libs script in the appendScripts loop.
import { installModelCore } from './model'
import { installMeta } from './meta'
import { installModelSync } from './sync'
import { installCreateNew } from './create_new'
import { installPerm } from './perm'
import { installWorkflow } from './workflow'
import { installUserSettings } from './user_settings'
import { installIndicator } from './indicator'

export function installModel() {
	// model.js first: seeds frappe.model with all_fieldtypes + the core
	// get_doc/get_value/set_value/add_child API the rest extend onto.
	installModelCore()
	// frappe.meta.* (docfield maps, get_docfield, precision helpers)
	installMeta()
	// frappe.model.sync / add_to_locals / docinfo — fills window.locals
	installModelSync()
	// frappe.model.get_new_doc / copy_doc / open_mapped_doc
	installCreateNew()
	// frappe.perm + READ/WRITE/... window constants
	installPerm()
	// frappe.workflow (state fields, transitions)
	installWorkflow()
	// frappe.model.user_settings (get/save list/report view settings)
	installUserSettings()
	// frappe.get_indicator / frappe.get_indicator_color (status pills)
	installIndicator()
}
