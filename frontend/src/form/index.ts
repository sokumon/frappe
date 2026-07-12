// form/index.ts
//
// Installs the Vue-native form engine onto the global `frappe`, in dependency
// order. This replaces the removed `form_vue_shell` desk bundle (which carried
// form.js + script_manager + quick_entry).
//
// TIMING (critical): must run AFTER the libs/controls desk bundles (so
// frappe.provide / frappe.ui / frappe.model exist) and BEFORE the erpnext bundle
// (whose client scripts call frappe.ui.form.on at load, and whose classes extend
// frappe.ui.form.Controller and frappe.ui.form.QuickEntryForm at module-eval).
// main.ts installs it mid-`appendScripts`, just before the first erpnext script.
import { installDialogBridge } from '@/dialog/createDialog'
import { installScriptManager } from './scriptManager'
import { installScriptHelpers } from './scriptHelpers'
import { installQuickEntry } from './quickEntry'
import { installFormEngine } from './vueForm'
// frappe.render_template / render / render_grid / render_tree / render_pdf — used
// by template_manager, form_sidebar and erpnext templates (e.g. item_prices).
import { installMicrotemplate } from './legacy/microtemplate'
// Toolbar + save pipeline (ported legacy modules; drive the Vue Navbar via the
// page bridge). Self-contained — each attaches its class to frappe.ui.form.*.
import { installSave } from './legacy/save'
import { installStates } from './legacy/workflow'
import { installFormViewers } from './legacy/form_viewers'
import { installTemplateManager } from './legacy/template_manager'
import { installLinkedWith } from './legacy/linked_with'
import { installToolbar } from './legacy/toolbar'

export function installForm() {
	// frappe.render_template etc. — no deps; template_manager/sidebar/erpnext use it.
	installMicrotemplate()
	// frappe.ui.Dialog = DialogBridge first — QuickEntryForm extends it.
	installDialogBridge()
	// frappe.ui.form.on / off / trigger / ScriptManager
	installScriptManager()
	// global form helpers scripts call bare: refresh_field / hide_field /
	// unhide_field / toggle_field / set_field_options / refresh_many
	installScriptHelpers()

	// Toolbar + save pipeline classes (order among these doesn't matter — they're
	// only instantiated later, when a form opens; just install before the engine).
	installSave() // frappe.ui.form.save / check_mandatory
	installStates() // frappe.ui.form.States (workflow)
	installFormViewers() // frappe.ui.form.FormViewers
	installTemplateManager() // frappe.ui.form.TemplateManager (used by Toolbar ctor)
	installLinkedWith() // frappe.ui.form.LinkedWith
	installToolbar() // frappe.ui.form.Toolbar

	// frappe.ui.form.Controller / Form
	installFormEngine()
	// frappe.ui.form.QuickEntryForm (needs the bridged Dialog above)
	installQuickEntry()
}
