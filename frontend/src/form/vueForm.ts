// vueForm.ts
//
// Vue-native re-implementation of `frappe.ui.form.Form`'s ENGINE. The legacy
// `form_vue_shell` bundle (which carried `form.js`) is no longer loaded, so this
// class replaces `new frappe.ui.form.Form(...)`.
//
// The deliberate split: the legacy Form both (a) ran the model/behaviour engine
// AND (b) rendered every field into `.std-form-layout` DOM via
// `frappe.ui.form.Layout` + controls. This class keeps (a) — so old
// `frappe.ui.form.on(...)` scripts fire identically — and drops (b) entirely: the
// Vue `<FormLayout>` (wired by `useFormBridge`) is the field view now.
//
// What that means for `fields_dict`: instead of live control objects, each entry
// is a lightweight handle carrying `df` and a no-op `refresh()`. That's enough for
// scripts that read `frm.fields_dict[f].df`, for `frm.get_field`, and for
// `frm.set_query` (which just stashes `get_query` on the handle for the Vue
// LinkField resolver to pick up).
//
// The linchpin for "old scripts keep firing" is `watch_model_updates()`: it
// registers the `frappe.model.on(dt,"*")` handler that calls
// `script_manager.trigger(fieldname)`. `useFormBridge` only mirrors values into
// the reactive doc; it does NOT trigger scripts — this does.
//
// DEFERRED (follow-up increments): toolbar/save/dashboard/workflow-states/sidebar
// (chrome + save chain) and grid (child-table `.grid.*`, per instruction). Methods
// that touch those are guarded so the form still loads and scripts still run.

import { ref, shallowReactive } from 'vue'
import { installSidebarFacades } from './sidebarFacades'
import { makeControl, frmHost } from './controls'
import type { ControlHost } from './controls'
import { makeModelListeners } from './modelEvents'
import type { ModelListeners } from './modelEvents'

declare const frappe: any
declare const $: any
declare const cur_frm: any
declare const cstr: (v: any) => string
declare const __: (...args: any[]) => string

class FormController {
	constructor(opts: any) {
		$.extend(this, opts)
	}
}

const TABLE_TYPES = new Set(['Table', 'Table MultiSelect'])

// Detached jQuery node — a safe sink for deferred subsystems (dashboard/grid) whose
// legacy code renders into / chains off DOM we don't show.
function noopNode(): any {
	return $('<div>')
}

// --- Dashboard stub (Tier-2, deferred) ---------------------------------------
// erpnext calls `frm.dashboard.*` heavily in `refresh` (add_indicator, add_progress,
// set_headline_alert, stats_area_row.append, …). There is no Vue dashboard region
// yet, so a real port would render nowhere — but `frm.dashboard` being null would
// THROW and break the whole refresh chain. This Proxy makes every access safe:
// known DOM props are detached jQuery nodes; any other member is a no-op method
// returning a node (so calls and chains don't throw). Rendering is simply skipped.
function makeDashboardStub(): any {
	const node = noopNode()
	const known: Record<string, any> = {
		wrapper: node,
		stats_area: node,
		stats_area_row: node,
		heatmap: null,
		refresh() {},
		reset() {},
		show() {},
		hide() {},
		clear_headline() {},
		set_headline() {},
		set_headline_alert() {},
		add_comment() {},
		clear_comment() {},
		hide_progress() {},
		render_graph() {},
		after_refresh() {},
		add_transactions() {},
		add_indicator: () => noopNode(),
		add_section: () => noopNode(),
		add_progress: () => noopNode(),
		show_progress: () => noopNode(),
		make_section: () => noopNode(),
	}
	return new Proxy(known, {
		get: (t, p: string) => (p in t ? t[p] : () => noopNode()),
	})
}

export class VueForm {
	docname: string
	doctype: string
	doctype_layout_name?: string
	in_form: boolean
	hidden = false
	refresh_if_stale_for = 120
	opendocs: Record<string, boolean> = {}
	custom_buttons: Record<string, any> = {}
	sections: any[] = []
	grids: any[] = []
	cscript: any
	events: Record<string, any> = {}
	fetch_dict: Record<string, any> = {}
	parent: any
	doctype_layout: any
	meta: any
	perm: any
	action_perm_type_map: Record<string, string>
	state_fieldname: any

	// Vue-backed control hierarchy. `fields`/`fields_dict` are built EAGERLY in the
	// constructor (H7 — before Form.vue builds the bridge, whose base computed sources
	// the controls' reactive dfs). `_child_dfs` holds the per-cdt-per-form reactive
	// child docfields every grid of that child doctype shares. `controls_version` is a
	// defensive tick the bridge computed reads so a rebuild re-runs it.
	fields: any[] = []
	fields_dict: Record<string, any> = {}
	_child_dfs: Record<string, any[]> = {}
	_host: ControlHost | null = null
	_model_listeners: ModelListeners | null = null
	controls_version = ref(0)
	wrapper: any
	$wrapper: any
	page: any
	layout_main: any
	script_manager: any
	// The `<FormLayout>` component owns rendering, so there's no real legacy layout
	// object. Scripts still call `frm.layout.*` in refresh though (e.g. workspace.js:
	// `frm.layout.message.empty()` + `frm.layout.show_message(...)`), so expose a safe
	// shim: `message` is a detached jQuery node (empty()/html()/… no-op), and the
	// message helpers are no-ops (the Vue form has no banner region yet) so the refresh
	// chain doesn't throw. `$` resolves at construction time (after libs load).
	layout: any = {
		refresh_sections: () => {},
		message: $('<div>'),
		show_message: (_msg?: string) => {},
		clear_message: () => {},
	}
	doc: any
	read_only = false
	save_disabled = false
	setup_done = false

	constructor(doctype: string, parent: any, in_form?: boolean, doctype_layout_name?: string) {
		this.docname = ''
		this.doctype = doctype
		this.doctype_layout_name = doctype_layout_name
		this.in_form = in_form ? true : false
		this.cscript = new FormController({ frm: this })

		// frappe.get_doc (not get_meta) because the layout doc is loaded via
		// frappe.model.with_doc; guards against a stale name from a prior navigation.
		this.doctype_layout = (() => {
			if (!doctype_layout_name) return null
			const layout = frappe.get_doc('DocType Layout', doctype_layout_name)
			if (layout && layout.document_type === doctype) return layout
			return null
		})()

		this.parent = parent
		this.setup_meta(doctype)
		// H7: build fields_dict from meta in the CONSTRUCTOR, not setup(). Form.vue
		// builds the bridge right after `new Form(...)` and its layout computed reads
		// the controls' reactive dfs off `frm.fields`; if that were still empty (built
		// lazily in the first refresh's setup()) the form would render permanently
		// blank. Nothing here needs setup() state — meta is loaded, child metas were
		// fetched by `with_doctype` before construction.
		this.build_fields_dict()
		this.debounced_reload_doc = frappe.utils.debounce(this.reload_doc.bind(this), 1000)
	}

	debounced_reload_doc: () => void = () => {}

	setup_meta() {
		this.meta = frappe.get_meta(this.doctype)
		if (this.meta.istable) {
			this.meta.in_dialog = 1
		}
		this.perm = frappe.perm.get_perm(this.doctype) // for create
		this.action_perm_type_map = {
			Create: 'create',
			Save: 'write',
			Submit: 'submit',
			Update: 'submit',
			Cancel: 'cancel',
			Amend: 'amend',
			Delete: 'delete',
			Mask: 'mask',
		}
	}

	setup() {
		// fields_dict was built in the constructor (H7); do NOT reset it here.
		this.state_fieldname = frappe.workflow.get_state_fieldname(this.doctype)

		this.wrapper = this.parent
		this.$wrapper = $(this.wrapper)

		const is_single_column = this.doctype === 'DocType' ? true : this.meta.hide_toolbar

		// make_app_page is the Vue page bridge: it reuses the shell's PageShell page,
		// so `this.page` drives the Navbar chrome (add_custom_button -> add_inner_button).
		frappe.ui.make_app_page({
			parent: this.wrapper,
			single_column: is_single_column,
			sidebar_position: 'Right',
		})
		this.page = this.wrapper.page
		this.layout_main = this.page.main?.get?.(0)

		// Dashboard is still deferred (no Vue region yet); scripts call
		// `frm.dashboard.*` in refresh — a null would throw, so keep the no-op stub.
		this.dashboard = makeDashboardStub()
		// Sidebar is now Vue-native: install the script-compat facades
		// (frm.sidebar/attachments/assign_to/shared/tags) that FormSidebar.vue renders
		// from. They hold the data + actions; the Vue component owns the markup.
		installSidebarFacades(this)

		// The Toolbar drives the Vue Navbar via the page bridge: primary action
		// (Save/Submit/Update), the ⋯ menu (Delete/Duplicate/Rename/Print…), action
		// icons and the status indicator. Its constructor calls refresh() → sets the
		// primary action on the bridge page. Created before fields_dict (legacy order).
		this.toolbar = new frappe.ui.form.Toolbar({ frm: this, page: this.page })

		// "Who's viewing" avatars + workflow states. Guarded: FormViewers renders into
		// page.page_actions and States wires workflow buttons — both non-critical, so a
		// failure must not block the form from loading.
		try {
			this.viewers = new frappe.ui.form.FormViewers({
				frm: this,
				parent: $('<div class="form-viewers d-flex"></div>').prependTo(this.page.page_actions),
			})
		} catch (e) {
			console.warn('[vueForm] FormViewers init skipped', e)
		}
		try {
			this.states = new frappe.ui.form.States({ frm: this })
		} catch (e) {
			console.warn('[vueForm] workflow States init skipped', e)
		}

		// fields_dict is already built (constructor, H7); script_manager.setup() reads
		// frm.fields / frm.fields_dict for the add_fetch scan and finds them populated.
		this.script_manager = new frappe.ui.form.ScriptManager({ frm: this })
		this.script_manager.setup()
		this.watch_model_updates()

		this.setup_done = true
	}

	viewers: any = null
	states: any = null

	// --- fields_dict -------------------------------------------------------
	// One Vue-backed control per meta docfield (§0). The classes own data/model
	// behaviour (so old `frm.fields_dict[f].*` scripts keep working); the Vue
	// <FormLayout> owns rendering. Each control holds a PER-FORM `shallowReactive`
	// copy of the docfield — mutating it (`field.df.hidden = 1`, or via
	// `set_df_property`) re-renders on its own because the bridge's layout computed
	// is built from these dfs. Child (grid) columns get their own per-cdt-per-form
	// reactive copies in `_child_dfs`, shared by every grid of that child doctype.
	build_fields_dict() {
		const copy_df = (d: any) =>
			shallowReactive(frappe.utils?.copy_dict ? frappe.utils.copy_dict(d) : { ...d })
		this.fields = []
		this.fields_dict = {}
		this._child_dfs = {}
		const host = (this._host = frmHost(this))

		for (const metaDf of this.meta.fields || []) {
			const df = copy_df(metaDf)
			// Table field → build the shared per-cdt reactive child dfs once, before
			// the control's grid (which reads them) is constructed.
			if (TABLE_TYPES.has(df.fieldtype) && df.options && !this._child_dfs[df.options]) {
				this._child_dfs[df.options] = (
					frappe.meta.get_docfields(df.options, this.docname) || []
				).map((cf: any) => copy_df(cf))
			}
			const control = makeControl({ df, host })
			if (!control) continue // unknown fieldtype → no entry (contract preserved)
			this.fields.push(control)
			if (df.fieldname) this.fields_dict[df.fieldname] = control
		}

		// Synthetic __newname (Data, hidden) — legacy layout injects it; scripts call
		// `frm.get_field("__newname").set_label(...)`. fields_dict-only (hidden, so it
		// never needs to render), a cheap parity win.
		if (!this.fields_dict['__newname']) {
			const df = shallowReactive({
				fieldname: '__newname',
				fieldtype: 'Data',
				hidden: 1,
				parent: this.doctype,
			})
			const control = makeControl({ df, host })
			if (control) this.fields_dict['__newname'] = control
		}

		// Defensive tick (H7): the bridge's base computed reads this so a rebuild
		// re-runs it even though `frm.fields` is a plain array.
		this.controls_version.value++
	}

	// --- model updates -> scripts -----------------------------------------
	// THE linchpin. Registers the model listener that runs client scripts on every
	// value change (whether from a Vue control via useFormBridge's set_value, a
	// programmatic frm.set_value, a fetch, or a default). useFormBridge mirrors
	// values into the reactive doc but does not trigger scripts; this does.
	watch_model_updates() {
		const me = this
		// Register through a tracker so `teardown()` can splice these out (there is no
		// frappe.model.off) — otherwise navigating away leaks the whole frm graph and,
		// worse, a stale instance whose docname matches again double-fires scripts.
		const listeners = (this._model_listeners = makeModelListeners())

		listeners.on(
			me.doctype,
			'*',
			function (fieldname: string, value: any, doc: any, skip_dirty_trigger = false) {
				if (doc.name == me.docname) {
					if (!skip_dirty_trigger) me.dirty()

					const field = me.fields_dict[fieldname]
					field && field.refresh(fieldname)

					return me.script_manager.trigger(fieldname, doc.doctype, doc.name)
				}
			}
		)

		// child tables
		const table_fields = frappe.get_children('DocType', me.doctype, 'fields', {
			fieldtype: ['in', frappe.model.table_fields],
		})

		$.each(table_fields, function (i: number, df: any) {
			listeners.on(
				df.options,
				'*',
				function (fieldname: string, value: any, doc: any, skip_dirty_trigger = false) {
					if (doc.parent == me.docname && doc.parentfield === df.fieldname) {
						if (!skip_dirty_trigger) me.dirty()

						// The bridge mirrors the child cell into the reactive doc; here we
						// only re-sync the grid view + trigger scripts.
						me.fields_dict[df.fieldname]?.grid?.set_value?.(fieldname, value, doc)
						return me.script_manager.trigger(fieldname, doc.doctype, doc.name)
					}
				}
			)
		})
	}

	// Remove model listeners, release detached wrapper sinks, and drop the global
	// cur_frm pointer if it is this instance. Called from Form.vue onUnmounted (after
	// bridge.dispose()); pairs with watch_model_updates + the reactive df sinks.
	teardown() {
		this._model_listeners?.offAll()
		this._model_listeners = null
		this._host?.release?.()
		if ((window as any).cur_frm === this) (window as any).cur_frm = null
	}

	// --- refresh / onload --------------------------------------------------
	refresh(docname?: string) {
		const switched = docname ? true : false

		if (docname) this.switch_doc(docname)
		;(window as any).cur_frm = this

		if (this.docname) {
			this.save_disabled = false
			this.doc = frappe.get_doc(this.doctype, this.docname)

			if (!this.has_read_permission()) {
				frappe.show_not_permitted?.(__(this.doctype) + ' ' + __(cstr(this.docname)))
				return
			}

			// do setup (first time only)
			if (!this.setup_done) this.setup()

			// workflow read-only
			this.read_only = frappe.workflow.is_read_only(this.doctype, this.docname)

			// site-wide read-only (maintenance) — disable the whole form (form.js parity).
			if (frappe.boot.read_only) this.disable_form()

			// fire before_load/onload (first open) then refresh
			this.trigger_onload(switched)
		}
	}

	switch_doc(docname: string) {
		this.docname = docname
	}

	has_read_permission() {
		this.perm = frappe.perm.get_perm(this.doctype, this.doc)
		if (!this.perm[0]?.read) return false
		return true
	}

	trigger_onload(switched?: boolean) {
		if (!this.opendocs[this.docname]) {
			this.cscript.is_onload = true
			this.initialize_new_doc()
		} else {
			this.render_form(switched)
		}
	}

	initialize_new_doc() {
		const me = this
		this.script_manager.trigger('before_load', this.doctype, this.docname).then(() => {
			me.script_manager.trigger('onload')
			me.opendocs[me.docname] = true
			me.render_form()
		})
	}

	// Slim render_form: the Vue <FormLayout> renders fields; here we run only the
	// script/refresh chain that scripts and chrome depend on (the legacy method
	// also rebuilt layout DOM, sidebar, dashboard — deferred).
	render_form(switched?: boolean) {
		if (!this.meta.istable) {
			frappe.run_serially([
				() => this.refresh_header(switched),
				() => $(document).trigger('form-refresh', [this]),
				() => this.script_manager.trigger('refresh'),
				() => {
					if (this.cscript.is_onload) {
						return this.script_manager.trigger('onload_post_render')
					}
				},
				() => (this.cscript.is_onload = false),
			])
		} else {
			this.refresh_header(switched)
		}
		this.$wrapper.trigger('render_complete')
	}

	refresh_header(switched?: boolean) {
		if (!this.meta.in_dialog || this.in_form) {
			frappe.utils.set_title(this.meta.issingle ? this.doctype : this.docname)
		}
		// chrome pieces are deferred; refresh them defensively if a later increment
		// wires them.
		if (this.toolbar) {
			if (switched) this.toolbar.current_status = undefined
			this.toolbar.refresh()
		}
		this.viewers?.refresh?.()
		this.dashboard?.refresh?.()
		// Vue-native sidebar: re-sync the assignment/attachment/share/tag facades from
		// the freshly-loaded docinfo and bump the reactive version so FormSidebar.vue
		// re-renders (legacy render_form called sidebar.refresh() here too).
		this.sidebar?.refresh?.()
		// reactive Vue breadcrumbs — pick up the loaded doc's title
		frappe.breadcrumbs?.update?.()
		this.clear_custom_buttons()
	}

	toolbar: any = null
	dashboard: any = null

	clear_custom_buttons() {
		this.custom_buttons = {}
		this.page?.clear_inner_toolbar?.()
	}

	// --- Tier-1 model / behaviour API -------------------------------------
	refresh_fields() {
		// Vue owns field rendering; nothing to re-render here.
	}

	refresh_field(fname: string) {
		if (this.fields_dict[fname] && this.fields_dict[fname].refresh) {
			this.fields_dict[fname].refresh()
		}
	}

	reload_doc() {
		if (!this.doc?.__islocal) {
			frappe.model.remove_from_locals(this.doctype, this.docname)
			return frappe.model.with_doc(this.doctype, this.docname, () => {
				this.refresh()
			})
		}
	}

	add_fetch(link_field: string, source_field: string, target_field: string, target_doctype?: string) {
		if (!target_doctype) target_doctype = '*'
		this.fetch_dict.setDefault(target_doctype, {}).setDefault(link_field, {})[target_field] =
			source_field
	}

	has_perm(ptype: string) {
		return frappe.perm.has_perm(this.doctype, 0, ptype, this.doc)
	}

	dirty() {
		this.doc.__unsaved = 1
		this.$wrapper.trigger('dirty')
	}

	is_dirty() {
		return !!this.doc.__unsaved
	}

	is_new() {
		return this.doc.__islocal
	}

	get_perm(permlevel: number, access_type: string) {
		return this.perm[permlevel] ? this.perm[permlevel][access_type] : null
	}

	field_map(fnames: string | string[], fn: (df: any) => void) {
		if (typeof fnames === 'string') {
			if (fnames == '*') {
				fnames = Object.keys(this.fields_dict)
			} else {
				fnames = [fnames]
			}
		}
		for (const fieldname of fnames) {
			// Single-df invariant: resolve the control's PER-FORM reactive df, not the
			// shared `frappe.meta` docfield — mutating the shared one wouldn't render and
			// would leak across forms.
			const field = this.get_docfield(fieldname)
			if (field) {
				fn(field)
				this.refresh_field(fieldname)
			}
		}
	}

	// Single-df invariant: exactly one df object per field per form, shared by the
	// control, get_docfield, field_map, set_df_property and the layout build. Parent
	// → the control's reactive df; child (two-arg) → the grid's reactive child df.
	get_docfield(fieldname1: string, fieldname2?: string) {
		if (fieldname2) {
			return this.fields_dict[fieldname1]?.grid?.get_docfield(fieldname2)
		}
		return this.fields_dict[fieldname1]?.df
	}

	set_df_property(
		fieldname: string,
		property: string,
		value: any,
		docname?: string,
		table_field?: string,
		table_row_name: string | null = null
	) {
		let df
		if (!docname || !table_field) {
			df = this.get_docfield(fieldname)
		} else {
			// Child (grid) cell: the grid's reactive child df (per-cdt-per-form).
			df = this.fields_dict[fieldname]?.grid?.get_docfield(table_field)
		}

		if (df && df[property] != value) {
			// Writing the reactive df re-renders via the bridge's layout computed (§2a).
			df[property] = value
			if (!(table_field && table_row_name)) {
				this.refresh_field(fieldname)
			}
		}
	}

	toggle_enable(fnames: string | string[], enable: boolean) {
		this.field_map(fnames, function (field) {
			field.read_only = enable ? 0 : 1
		})
	}

	toggle_reqd(fnames: string | string[], mandatory: boolean) {
		this.field_map(fnames, function (field) {
			field.reqd = mandatory ? true : false
		})
	}

	toggle_display(fnames: string | string[], show: boolean) {
		this.field_map(fnames, function (field) {
			field.hidden = show ? 0 : 1
		})
	}

	// Stashes the runtime query where the Vue LinkField resolver (Form.vue's
	// LinkQueryKey) reads it at fetch time: `fields_dict[f].get_query` for a top-level
	// Link, `grid.get_field(f).get_query` for a child-table cell.
	set_query(fieldname: string, opt1: any, opt2?: any) {
		if (opt2) {
			// child table: set_query(child_fieldname, parent_fieldname, query)
			const grid = this.fields_dict[opt1]?.grid
			if (grid) grid.get_field(fieldname).get_query = opt2
		} else {
			// parent: set_query(fieldname, query)
			if (this.fields_dict[fieldname]) {
				this.fields_dict[fieldname].get_query = opt1
			}
		}
	}

	clear_table(fieldname: string) {
		frappe.model.clear_table(this.doc, fieldname)
	}

	add_child(fieldname: string, values?: Record<string, any>) {
		const doc = frappe.model.add_child(
			this.doc,
			this.get_docfield(fieldname)?.options,
			fieldname
		)
		if (values) {
			const d: Record<string, any> = {}
			const unique_keys = ['idx', 'name']
			Object.keys(values).forEach((key) => {
				if (!unique_keys.includes(key)) d[key] = values[key]
			})
			$.extend(doc, d)
		}
		return doc
	}

	set_value(field: any, value?: any, if_missing?: boolean, skip_dirty_trigger = false) {
		const me = this
		const _set = function (f: string, v: any) {
			const fieldobj = me.fields_dict[f]
			if (fieldobj) {
				if (!if_missing || !frappe.model.has_value(me.doctype, me.doc.name, f)) {
					if (frappe.model.table_fields.includes(fieldobj.df.fieldtype) && $.isArray(v)) {
						frappe.model.clear_table(me.doc, fieldobj.df.fieldname)
						const standard_fields = [
							...frappe.model.std_fields_list,
							...frappe.model.child_table_field_list,
						]
						v.forEach((d: any, idx: number) => {
							const child = frappe.model.add_child(
								me.doc,
								fieldobj.df.options,
								fieldobj.df.fieldname,
								idx + 1
							)
							const doc_copy = { ...d }
							standard_fields.forEach((sf: string) => delete doc_copy[sf])
							$.extend(child, doc_copy)
						})
						me.refresh_field(f)
						return Promise.resolve()
					} else {
						return frappe.model.set_value(
							me.doctype,
							me.doc.name,
							f,
							v,
							undefined,
							skip_dirty_trigger
						)
					}
				}
			} else {
				frappe.msgprint(__('Field {0} not found.', [f]))
				throw `frm.set_value: '${f}' does not exist in the form`
			}
		}

		if (typeof field == 'string') {
			return _set(field, value)
		} else if ($.isPlainObject(field)) {
			const tasks: Array<() => any> = []
			for (const f in field) {
				const v = field[f]
				if (me.get_field(f)) tasks.push(() => _set(f, v))
			}
			return frappe.run_serially(tasks)
		}
	}

	call(opts: any, args?: any, callback?: any) {
		const me = this
		if (typeof opts === 'string') {
			opts = { method: opts, doc: this.doc, args, callback }
		}
		if (!opts.doc) {
			if (opts.method.indexOf('.') === -1)
				opts.method = frappe.model.get_server_module_name(me.doctype) + '.' + opts.method
			opts.original_callback = opts.callback
			opts.callback = function (r: any) {
				if ($.isPlainObject(r.message)) {
					if (opts.child) {
						opts.child = (window as any).locals[opts.child.doctype][opts.child.name]
						if (opts.child) {
							const std_field_list = ['doctype']
								.concat(frappe.model.std_fields_list)
								.concat(frappe.model.child_table_field_list)
							for (const key in r.message) {
								if (std_field_list.indexOf(key) === -1) {
									opts.child[key] = r.message[key]
								}
							}
							me.fields_dict[opts.child.parentfield].refresh()
						}
					} else {
						me.set_value(r.message)
					}
				}
				opts.original_callback && opts.original_callback(r)
			}
		} else {
			opts.original_callback = opts.callback
			opts.callback = function (r: any) {
				if (!r.exc) me.refresh_fields()
				opts.original_callback && opts.original_callback(r)
			}
		}
		return frappe.call(opts)
	}

	get_field(field: string) {
		return this.fields_dict[field]
	}

	// FormSidebar.vue's title computed reads this; without it the sidebar title is blank.
	get_title() {
		return frappe.model.get_doc_title(this.doc)
	}

	// FormTimeline.vue + toolbar read this (docinfo backfill).
	get_docinfo() {
		return frappe.model.docinfo[this.doctype]?.[this.docname]
	}

	trigger(event: string, doctype?: string, docname?: string) {
		return this.script_manager.trigger(event, doctype, docname)
	}

	get_formatted(fieldname: string) {
		return frappe.format(
			this.doc[fieldname],
			this.get_docfield(fieldname) ||
				frappe.meta.get_docfield(this.doctype, fieldname, this.docname),
			{ no_icon: true },
			this.doc
		)
	}

	get_doc() {
		return (window as any).locals[this.doctype]?.[this.docname]
	}

	add_custom_button(label: string, fn: () => void, group?: string) {
		// temp! old parameter used to be icon
		if (group && group.indexOf('fa fa-') !== -1) group = undefined
		const btn = this.page.add_inner_button(label, fn, group)
		if (btn) this.custom_buttons[label] = btn
		return btn
	}

	set_intro(txt: string, color?: string) {
		// dashboard deferred; keep the call safe.
		this.dashboard?.set_headline_alert?.(txt, color)
	}

	// --- currency labels (ported) — transaction forms call these in refresh ------
	set_currency_labels(fields_list: string[], currency: string, parentfield?: string) {
		if (!currency) return
		const me = this
		const doctype = parentfield ? this.fields_dict[parentfield].grid.doctype : this.doc.doctype
		const field_label_map: Record<string, string> = {}
		const grid_field_label_map: Record<string, string> = {}
		fields_list.forEach((fname) => {
			const docfield = frappe.meta.docfield_map[doctype]?.[fname]
			if (docfield) {
				if (docfield._original_label === undefined) docfield._original_label = docfield.label
				const label = __(docfield._original_label || '', null, docfield.parent)
				if (parentfield) grid_field_label_map[doctype + '-' + fname] = label.trim() + ' (' + currency + ')'
				else field_label_map[fname] = label.trim() + ' (' + currency + ')'
			}
		})
		for (const fname in field_label_map) me.fields_dict[fname]?.set_label(field_label_map[fname])
		for (const key in grid_field_label_map) {
			const fname = key.split('-')[1]
			// grid deferred: update_docfield_property is a no-op stub.
			me.fields_dict[parentfield!].grid.update_docfield_property(fname, 'label', grid_field_label_map[key])
		}
	}

	reset_currency_labels(fields: string[], parentfield?: string) {
		if (!fields.length) return
		const doctype = parentfield ? this.fields_dict[parentfield].grid.doctype : this.doc.doctype
		fields.forEach((field) => {
			const docfield = frappe.meta.docfield_map[doctype]?.[field]
			if (docfield) {
				if (docfield._original_label === undefined) docfield._original_label = docfield.label
				const label = __(docfield._original_label || '', null, docfield.parent)
				if (parentfield)
					this.fields_dict[parentfield].grid.update_docfield_property(field, 'label', label)
				else this.fields_dict[field]?.set_label(label)
			}
		})
	}

	// Sets a link/indicator formatter on the docfield meta (used by list/grid render).
	// Harmless for the form; ported so the call doesn't throw.
	set_indicator_formatter(fieldname: string, get_color: any, get_text?: any) {
		let doctype: string | undefined
		if (frappe.meta.docfield_map[this.doctype][fieldname]) {
			doctype = this.doctype
		} else {
			frappe.meta.get_table_fields(this.doctype, true).every((df: any) => {
				if (frappe.meta.docfield_map[df.options]?.[fieldname]) {
					doctype = df.options
					return false
				}
				return true
			})
		}
		if (!doctype) return
		frappe.meta.docfield_map[doctype][fieldname].formatter = function (
			value: any,
			df: any,
			_options: any,
			doc: any
		) {
			if (!value) return value
			let label
			if (get_text) label = get_text(doc)
			else if (frappe.form.link_formatters[df.options])
				label = frappe.form.link_formatters[df.options](value, doc, df)
			else label = value
			const escaped_name = encodeURIComponent(value)
			return `<a class="indicator ${get_color(doc || {})}" href="/desk/${frappe.router.slug(
				df.options
			)}/${escaped_name}" data-doctype="${df.options}" data-name="${frappe.utils.escape_html(
				value
			)}">${label}</a>`
		}
	}

	change_custom_button_type(label: string, group: string, type: string) {
		this.page.change_inner_button_type?.(label, group, type)
	}

	remove_custom_button(label: string, group?: string) {
		this.page.remove_inner_button?.(label, group)
		delete this.custom_buttons[label]
	}

	// Child-table helpers scripts occasionally use (grid rendering works; these read
	// the model directly, so they don't depend on the deferred grid scripting).
	// { parentfield: [selected child docnames] } — reads each grid's checkbox
	// selection from the rendered DOM (form.js:2069 parity).
	get_selected() {
		const selected: Record<string, string[]> = {}
		for (const field of this.fields) {
			if (!field.grid) continue
			const _selected = field.grid.get_selected()
			if (_selected.length) selected[field.df.fieldname] = _selected
		}
		return selected
	}

	get_sum(table: string, fieldname: string) {
		const rows: any[] = this.doc[table] || []
		return rows.reduce((sum, row) => sum + (parseFloat(row[fieldname]) || 0), 0)
	}

	update_in_all_rows(table: string, field: string, value: any) {
		const rows: any[] = this.doc[table] || []
		rows.forEach((row) => {
			if (row[field] !== value)
				frappe.model.set_value(row.doctype, row.name, field, value)
		})
	}

	has_import_file() {
		return false
	}

	add_web_link(path?: string, label?: string) {
		// Adds a "See on Website" link to the Vue sidebar's user-actions list
		// (frm.sidebar.add_user_action); the click opens the doc's public route.
		if (!this.sidebar) return
		this.web_link = this.sidebar.add_user_action?.(__(label || 'See on Website'), () => {
			const target = path || this.doc.route
			window.open(target ? '/' + target : '/', '_blank')
		})
	}
	web_link: any = null
	sidebar: any = null

	// --- SAVE pipeline (ported from form.js) -------------------------------
	// The toolbar's primary action calls these. `frappe.ui.form.save` is the
	// ported save.js. Deferred deps (grid close_grid_form, SuccessAction,
	// comment_box) are guarded so the chain runs without them.
	comment_box: any = null

	save(save_action?: string, callback?: any, btn?: any, on_error?: any) {
		const me = this
		return new Promise<void>((resolve, reject) => {
			btn && $(btn).prop('disabled', true)
			frappe.ui.form.close_grid_form?.()
			me.validate_and_save(save_action, callback, btn, on_error, resolve, reject)
		})
			.then(() => me.show_success_action())
			.catch((e) => console.error(e))
	}

	validate_and_save(
		save_action: string | undefined,
		callback: any,
		btn: any,
		on_error: any,
		resolve: () => void,
		reject: () => void
	) {
		const me = this
		if (!save_action) save_action = 'Save'
		this.validate_form_action(save_action, resolve)

		const after_save = function (r: any) {
			history.replaceState(null, '', ' ')
			if (!r.exc) {
				if (['Save', 'Update', 'Amend'].indexOf(save_action as string) !== -1) {
					frappe.utils.play_sound('click')
				}
				me.script_manager.trigger('after_save')
				if (frappe.route_hooks.after_save) {
					const route_callback = frappe.route_hooks.after_save
					delete frappe.route_hooks.after_save
					route_callback(me)
				}
				me.comment_box?.submit?.()
				me.refresh()
			} else {
				if (on_error) {
					on_error()
					reject()
				}
			}
			callback && callback(r)
			resolve()
		}

		const fail = (e?: any) => {
			if (e) console.error(e)
			btn && $(btn).prop('disabled', false)
			if (on_error) {
				on_error()
				reject()
			}
		}

		if (save_action != 'Update') {
			frappe.validated = true
			frappe
				.run_serially([
					() => this.script_manager.trigger('validate'),
					() => this.script_manager.trigger('before_save'),
					() => {
						if (!frappe.validated) {
							fail()
							return
						}
						frappe.ui.form.save(me, save_action, after_save, btn)
					},
				])
				.catch(fail)
		} else {
			frappe.ui.form.save(me, save_action, after_save, btn)
		}
	}

	validate_form_action(action: string, resolve?: () => void) {
		const perm_to_check = this.action_perm_type_map[action]
		let allowed_for_workflow = false
		const perms = frappe.perm.get_perm(this.doc.doctype)[0]
		if (
			(frappe.workflow.is_read_only(this.doctype, this.docname) &&
				(perms['write'] || perms['create'] || perms['submit'] || perms['cancel'])) ||
			!frappe.workflow.is_read_only(this.doctype, this.docname)
		) {
			allowed_for_workflow = true
		}
		if (!this.perm[0][perm_to_check] && !allowed_for_workflow) {
			if (resolve) resolve()
			frappe.throw(
				__('No permission to \'{0}\' {1}', [__(action), __(this.doc.doctype)], '{0} = verb, {1} = object')
			)
		}
	}

	savesubmit(btn?: any, callback?: any, on_error?: any) {
		const me = this
		return new Promise((resolve) => {
			this.validate_form_action('Submit')
			frappe.confirm(
				__('Permanently Submit {0}?', [this.docname]),
				function () {
					frappe.validated = true
					me.script_manager.trigger('before_submit').then(function () {
						if (!frappe.validated) return me.handle_save_fail(btn, on_error)
						me.save(
							'Submit',
							function (r: any) {
								if (r.exc) {
									me.handle_save_fail(btn, on_error)
								} else {
									frappe.utils.play_sound('submit')
									callback && callback()
									me.script_manager
										.trigger('on_submit')
										.then(() => resolve(me))
										.then(() => {
											if (frappe.route_hooks.after_submit) {
												const route_callback = frappe.route_hooks.after_submit
												delete frappe.route_hooks.after_submit
												route_callback(me)
											}
										})
								}
							},
							btn,
							() => me.handle_save_fail(btn, on_error)
						)
					})
				},
				() => me.handle_save_fail(btn, on_error)
			)
		})
	}

	savecancel(btn?: any, callback?: any, on_error?: any) {
		const me = this
		this.validate_form_action('Cancel')
		me.ignore_doctypes_on_cancel_all = me.ignore_doctypes_on_cancel_all || []
		frappe
			.call({
				method: 'frappe.desk.form.linked_with.get_submitted_linked_docs',
				args: {
					doctype: me.doc.doctype,
					name: me.doc.name,
					ignore_doctypes_on_cancel_all: me.ignore_doctypes_on_cancel_all,
				},
				freeze: true,
			})
			.then((r: any) => {
				if (!r.exc) {
					const doctypes_to_cancel = (r.message.docs || []).map((v: any) => v.doctype)
					if (doctypes_to_cancel.length) {
						return me._cancel_all(r, btn, callback, on_error)
					}
				}
				return me._cancel(btn, callback, on_error, false)
			})
	}

	ignore_doctypes_on_cancel_all: string[] = []

	_cancel_all(r: any, btn: any, callback: any, on_error: any) {
		const me = this
		let links_text = ''
		const links = r.message.docs
		const doctypes = Array.from(new Set(links.map((link: any) => link.doctype))) as string[]
		me.ignore_doctypes_on_cancel_all = me.ignore_doctypes_on_cancel_all || []
		for (const doctype of doctypes) {
			if (!me.ignore_doctypes_on_cancel_all.includes(doctype)) {
				const docnames = links
					.filter((link: any) => link.doctype == doctype)
					.map((link: any) => frappe.utils.get_form_link(link.doctype, link.name, true))
					.join(', ')
				links_text += `<li><strong>${__(doctype)}</strong>: ${docnames}</li>`
			}
		}
		links_text = `<ul>${links_text}</ul>`
		let confirm_message = __('{0} {1} is linked with the following submitted documents: {2}', [
			__(me.doc.doctype).bold(),
			me.doc.name,
			links_text,
		])
		const can_cancel = links.every((link: any) => frappe.model.can_cancel(link.doctype))
		confirm_message += can_cancel
			? __('Do you want to cancel all linked documents?')
			: __('You do not have permissions to cancel all linked documents.')
		const d = new frappe.ui.Dialog(
			{
				title: __('Cancel All Documents'),
				fields: [
					{ fieldtype: 'HTML', options: `<p class="frappe-confirm-message">${confirm_message}</p>` },
				],
			},
			() => me.handle_save_fail(btn, on_error)
		)
		if (can_cancel) {
			d.set_primary_action(__('Cancel All'), () => {
				d.hide()
				frappe.call({
					method: 'frappe.desk.form.linked_with.cancel_all_linked_docs',
					args: { docs: links, ignore_doctypes_on_cancel_all: me.ignore_doctypes_on_cancel_all || [] },
					freeze: true,
					callback: (resp: any) => {
						if (!resp.exc) {
							me.reload_doc()
							me._cancel(btn, callback, on_error, true)
						}
					},
				})
			})
		}
		d.show()
	}

	_cancel(btn?: any, callback?: any, on_error?: any, skip_confirm?: boolean) {
		const me = this
		const cancel_doc = () => {
			frappe.validated = true
			me.script_manager.trigger('before_cancel').then(() => {
				if (!frappe.validated) return me.handle_save_fail(btn, on_error)
				const after_cancel = function (r: any) {
					if (r.exc) {
						me.handle_save_fail(btn, on_error)
					} else {
						frappe.utils.play_sound('cancel')
						me.refresh()
						callback && callback()
						me.script_manager.trigger('after_cancel')
					}
				}
				frappe.ui.form.save(me, 'cancel', after_cancel, btn)
			})
		}
		if (skip_confirm) cancel_doc()
		else
			frappe.confirm(
				__('Permanently Cancel {0}?', [this.docname]),
				cancel_doc,
				me.handle_save_fail(btn, on_error)
			)
	}

	_discard(btn?: any, on_error?: any, skip_confirm?: boolean) {
		const me = this
		const discard_doc = () => {
			frappe.validated = true
			me.script_manager.trigger('before_discard').then(() => {
				if (!frappe.validated) return me.handle_save_fail(btn, on_error)
				const after_discard = function (r: any) {
					if (r.exc) me.handle_save_fail(btn, on_error)
					else {
						frappe.utils.play_sound('cancel')
						me.refresh()
						me.script_manager.trigger('after_discard')
					}
					me.reload_doc()
				}
				frappe.call({
					freeze: true,
					method: 'frappe.desk.form.save.discard',
					args: { doctype: me.doc.doctype, name: me.doc.name },
					btn,
					callback: (r: any) => after_discard(r),
				})
			})
		}
		if (skip_confirm) discard_doc()
		else
			frappe.confirm(
				__('Permanently Discard {0}?', [this.docname]),
				discard_doc,
				me.handle_save_fail(btn, on_error)
			)
	}

	discard(btn?: any, callback?: any, on_error?: any) {
		const me = this
		return new Promise<void>((resolve) => {
			frappe.confirm(__('Discard {0}', [this.docname]), function () {
				me.script_manager.trigger('before_discard').then(function () {
					return me._discard(btn, on_error, false)
				})
			})
			resolve()
		})
	}

	savetrash() {
		this.validate_form_action('Delete')
		frappe.model.delete_doc(this.doctype, this.docname, function () {
			window.history.back()
		})
	}

	amend_doc() {
		if (!this.fields_dict['amended_from']) {
			frappe.msgprint(__('"amended_from" field must be present to do an amendment.'))
			return
		}
		frappe
			.xcall('frappe.client.is_document_amended', { doctype: this.doc.doctype, docname: this.doc.name })
			.then((is_amended: boolean) => {
				if (is_amended) {
					frappe.throw(__('This document is already amended, you cannot ammend it again'))
				}
				this.validate_form_action('Amend')
				const me = this
				const fn = function (newdoc: any) {
					newdoc.amended_from = me.docname
					if (me.fields_dict && me.fields_dict['amendment_date'])
						newdoc.amendment_date = frappe.datetime.obj_to_str(new Date())
				}
				this.copy_doc(fn, 1)
				frappe.utils.play_sound('click')
			})
	}

	handle_save_fail(btn: any, on_error: any) {
		$(btn).prop('disabled', false)
		if (on_error) on_error()
	}

	show_success_action() {
		const route = frappe.get_route()
		if (route[0] !== 'Form') return
		if (this.meta.is_submittable && this.doc.docstatus !== 1) return
		// SuccessAction lived in success_action.js (removed with the shell bundle); guard.
		if (frappe.ui.form.SuccessAction) new frappe.ui.form.SuccessAction(this).show()
	}

	enable_save() {
		this.save_disabled = false
		this.toolbar?.set_primary_action()
	}

	disable_save(set_dirty = false) {
		this.save_disabled = true
		if (this.toolbar) this.toolbar.current_status = null
		this.set_dirty = set_dirty
		this.page.clear_primary_action()
	}
	set_dirty = false

	set_read_only() {
		const docperms = frappe.perm.get_perm(this.doc.doctype)
		this.perm = docperms.map((p: any) => ({
			read: p.read,
			cancel: p.cancel,
			share: p.share,
			print: p.print,
			email: p.email,
			mask: p.mask,
		}))
		this.refresh_fields()
	}

	// Ported from form.js: strip write perms, mark every field read-only (each
	// set_df_property pushes an applyMetaScript op so the Vue layout re-resolves),
	// and disable saving. Used by scripts and by refresh() when frappe.boot.read_only.
	disable_form() {
		this.set_read_only()
		this.fields.forEach((field) => {
			this.set_df_property(field.df.fieldname, 'read_only', '1')
		})
		this.disable_save()
	}

	// --- ACTIONS (ported) --------------------------------------------------
	print_doc() {
		if (this.is_dirty()) {
			frappe.toast({
				message: __(
					'This document has unsaved changes which might not appear in final PDF. <br> Consider saving the document before printing.'
				),
				indicator: 'yellow',
			})
		}
		frappe.route_options = { frm: this }
		if (this._layout_print_format) frappe.route_options.print_format = this._layout_print_format
		frappe.set_route('print', this.doctype, this.doc.name)
	}
	_layout_print_format: any
	_layout_email_template: any

	navigate_records(prev: boolean) {
		let filters, sort_field, sort_order
		const list_view = frappe.get_list_view(this.doctype)
		if (list_view) {
			filters = list_view.get_filters_for_args()
			sort_field = list_view.sort_by
			sort_order = list_view.sort_order
		} else {
			const list_settings = frappe.get_user_settings(this.doctype)['List']
			if (list_settings) {
				filters = list_settings.filters
				sort_field = list_settings.sort_by
				sort_order = list_settings.sort_order
			}
		}
		const args = { doctype: this.doctype, value: this.docname, filters, sort_order, sort_field, prev }
		frappe.call({ method: 'frappe.desk.form.utils.get_next', args, freeze: true }).then((r: any) => {
			if (r.message) {
				frappe.set_route('Form', this.doctype, r.message)
				this.focus_on_first_input()
			}
		})
	}

	rename_doc() {
		frappe.model.rename_doc(this.doctype, this.docname, () => this.refresh_header())
	}

	share_doc() {
		this.shared?.show?.()
	}
	shared: any = null

	email_doc(message?: string) {
		return new frappe.views.CommunicationComposer({
			doc: this.doc,
			frm: this,
			subject: __(this.meta.name) + ': ' + this.docname,
			recipients: this.doc.email || this.doc.email_id || this.doc.contact_email,
			attach_document_print: true,
			message,
			email_template: this._layout_email_template || undefined,
		})
	}

	copy_doc(onload?: any, from_amend?: any) {
		this.validate_form_action('Create')
		const newdoc = frappe.model.copy_doc(this.doc, from_amend)
		newdoc.idx = null
		newdoc.__run_link_triggers = false
		if (onload) onload(newdoc)
		frappe.set_route('Form', newdoc.doctype, newdoc.name)
	}

	check_doctype_conflict(docname: string) {
		if (this.doctype == 'DocType' && docname == 'DocType') {
			frappe.msgprint(__('Allowing DocType, DocType. Be careful!'))
		} else if (this.doctype == 'DocType') {
			if (frappe.views?.formview?.[docname] || frappe.pages?.['List/' + docname]) {
				window.location.reload()
			}
		} else {
			if (
				frappe.views?.formview?.DocType &&
				frappe.views.formview.DocType.frm.opendocs[this.doctype]
			) {
				window.location.reload()
			}
		}
	}

	// Layout-dependent; the Vue <FormLayout> owns focus/tabs, so these are guarded.
	focus_on_first_input() {
		// no legacy layout wrapper in the Vue shell
	}
	get_active_tab() {
		return this.active_tab_map && this.active_tab_map[this.docname]
	}
	active_tab_map: any
	is_form_builder() {
		return (
			['DocType', 'Customize Form'].includes(this.doctype) &&
			this.get_active_tab()?.label == 'Form'
		)
	}
	open_grid_row() {
		return frappe.ui.form.get_open_grid_form?.()
	}
	scroll_to_field() {
		// layout/DOM-dependent; Vue owns scrolling. No-op for now.
	}
	run_after_load_hook() {
		if (frappe.route_hooks.after_load) {
			const route_callback = frappe.route_hooks.after_load
			delete frappe.route_hooks.after_load
			route_callback(this)
		}
	}
}

// Install the Vue-native form engine onto the global `frappe`. Order matters: the
// dialog bridge and QuickEntryForm must be installed first (see form/install.ts).
export function installFormEngine() {
	frappe.provide('frappe.ui.form')
	frappe.ui.form.Controller = FormController
	frappe.ui.form.Form = VueForm
}
