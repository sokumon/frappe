// scriptHelpers.ts
//
// The legacy GLOBAL form helpers from `frappe/public/js/frappe/form/script_helpers.js`
// (`refresh_field`, `refresh_many`, `set_field_options`, `toggle_field`, `hide_field`,
// `unhide_field`). erpnext/frappe client scripts call these as bare globals — e.g.
// purchase_invoice.js `hide_fields()` calls `unhide_field(...)` — but they shipped in
// the dropped `form_vue_shell` bundle, so they're undefined in the Vue shell.
//
// Ported here, but ROUTED THROUGH THE FRM (not the shared `frappe.meta` docfield):
// legacy `toggle_field` mutated `frappe.meta.get_docfield(...).hidden`, which the
// Vue-native form does NOT render from (rendering is driven by each control's per-form
// reactive df — see [[project_vue_control_hierarchy]]). So `toggle_field` goes through
// `frm.set_df_property` (writes the reactive df → re-renders), and the child-table
// `refresh_field` branch drives the grid facade instead of the old control system.
//
// Installed from `installForm()` before the erpnext bundle loads, so the globals exist
// when erpnext client scripts run.

declare const cur_frm: any

export function installScriptHelpers() {
	// Function declarations (hoisted) so refresh_many ↔ refresh_field can reference
	// each other, and internal calls resolve to these — not an ambiguous global lookup.

	function refresh_many(flist: string[], dn?: string, table_field?: string) {
		for (const i in flist) {
			if (table_field) refresh_field(flist[i], dn, table_field)
			else refresh_field(flist[i])
		}
	}

	function refresh_field(n: any, docname?: string, table_field?: string) {
		if (Array.isArray(n)) {
			refresh_many(n, docname, table_field)
			return
		}
		if (n && typeof n === 'string' && table_field && cur_frm) {
			// Child-table cell: drive the grid facade (the old shared-meta `$.extend`
			// is dropped — it would clobber the reactive child df's runtime state).
			const grid = cur_frm.fields_dict[table_field]?.grid
			if (!grid) return
			const grid_row = docname ? grid.grid_rows_by_docname?.[docname] : undefined
			if (grid_row) grid_row.refresh_field(n)
			else grid.refresh()
		} else if (cur_frm) {
			cur_frm.refresh_field(n)
		}
	}

	function set_field_options(n: string, txt: string) {
		cur_frm?.set_df_property(n, 'options', txt)
	}

	// Writes the per-form REACTIVE df (via frm.set_df_property) so the field actually
	// shows/hides; falls back to a log for an unknown field (legacy parity).
	function toggle_field(n: string, hidden: number | boolean) {
		if (!cur_frm) return
		if (cur_frm.get_docfield(n)) {
			cur_frm.set_df_property(n, 'hidden', hidden ? 1 : 0)
		} else {
			console.log((hidden ? 'hide_field' : 'unhide_field') + ' cannot find field ' + n)
		}
	}

	function hide_field(n: string | string[]) {
		if (!cur_frm) return
		if ((n as any).substr) toggle_field(n as string, 1)
		else for (const i in n as string[]) toggle_field((n as string[])[i], 1)
	}

	function unhide_field(n: string | string[]) {
		if (!cur_frm) return
		if ((n as any).substr) toggle_field(n as string, 0)
		else for (const i in n as string[]) toggle_field((n as string[])[i], 0)
	}

	Object.assign(window as any, {
		refresh_many,
		refresh_field,
		set_field_options,
		toggle_field,
		hide_field,
		unhide_field,
	})
}
