// frappeGrid.ts
//
// The full grid facade + the Table controls that own it. The Vue `Grid` is purely
// `v-model`-driven (rows in, change/edit out) with no imperative API, so this facade
// NEVER calls into the Grid component: it manipulates the child-table array (via
// `frappe.model` on a form, or the dialog's `_vdoc`) and the reactive child dfs, then
// lets Vue re-render. It reproduces the legacy `frm.fields_dict[f].grid.*` surface —
// the single most-consumed part of `fields_dict` — so erpnext grid scripts keep
// working verbatim.
import { FrappeControlData } from './frappeControl'
import type { ControlOpts } from './frappeControl'
import type { ControlHost } from './host'

declare const frappe: any
declare const $: any
declare const __: (...args: any[]) => string

// A stable per-row handle. Its identity is cached by docname (see `grid_rows`) so a
// script that loops `grid.grid_rows` repeatedly gets the same objects; `doc` is
// re-pointed at the current child doc on each access.
interface GridRowHandle {
	doc: any
	readonly idx: number
	name: string
	remove(): void
	refresh_field(fieldname?: string): void
	toggle_editable(fieldname: string, editable: boolean): void
	get_field(fieldname: string): any
}

export class FrappeGrid {
	control: FrappeControlData
	host: ControlHost
	df: any
	frm: any
	// Legacy `grid.get_field` is a per-grid `fieldinfo[fn] ??= {}` stash (for
	// get_query); ours is a superset keyed here.
	fieldinfo: Record<string, any> = {}
	// Writable flag scripts set/read (`grid.cannot_add_rows = true`). The Vue grid
	// doesn't consume it yet (documented gap), but the value round-trips.
	cannot_add_rows = false
	private _rowHandles = new Map<string, GridRowHandle>()

	constructor(control: FrappeControlData, host: ControlHost) {
		this.control = control
		this.host = host
		this.df = control.df
		this.frm = host.frm
	}

	// Child doctype.
	get doctype(): string {
		return this.df.options
	}

	// The reactive child df copies. Per-cdt per-form (every grid of the same child
	// doctype shares them — legacy `update_docfield_property` reaches shared meta),
	// stored on the frm; a dialog uses its inline `df.fields`, falling back to child
	// meta when only `df.options` is given.
	get docfields(): any[] {
		if (this.frm) return this.frm._child_dfs?.[this.doctype] || []
		if (Array.isArray(this.df.fields) && this.df.fields.length) return this.df.fields
		return frappe.meta?.get_docfields?.(this.df.options) || []
	}

	get fields_map(): Record<string, any> {
		const map: Record<string, any> = {}
		for (const df of this.docfields) map[df.fieldname] = df
		return map
	}

	// The resolved grid wrapper (the `[data-fieldname]` node the Vue TableField
	// renders into), for DOM reads (selection).
	get wrapper(): any {
		return this.host.resolve_wrapper(this.df)
	}

	// --- data --------------------------------------------------------------
	get_data(_filter_field?: string): any[] {
		if (this.frm) return this.frm.doc?.[this.df.fieldname] || []
		return this.df.data || this.host.get_doc()?.[this.df.fieldname] || []
	}

	get_docfield(fieldname: string): any {
		// Dialogs: inline `df.fields` win over child meta (user-supplied columns).
		if (!this.frm && Array.isArray(this.df.fields)) {
			const inline = this.df.fields.find((f: any) => f.fieldname === fieldname)
			if (inline) return inline
		}
		return this.docfields.find((f: any) => f.fieldname === fieldname)
	}

	// --- column ops (df-level; reach Vue via the reactive child df) ----------
	get_field(fieldname: string): any {
		// Superset of legacy's `fieldinfo[fn] ??= {}`: a stable per-grid handle with
		// an assignable `get_query` (per-grid, matching `fieldinfo`) and a live `df`.
		let info = this.fieldinfo[fieldname]
		if (!info) {
			const grid = this
			info = this.fieldinfo[fieldname] = {
				fieldname,
				get df() {
					return grid.get_docfield(fieldname)
				},
				get_query: undefined,
				refresh() {},
			}
		}
		return info
	}

	update_docfield_property(fieldname: string, property: string, value: any) {
		const df = this.get_docfield(fieldname)
		if (!df) throw `field ${fieldname} not found`
		df[property] = value
		// Form: the reactive child df already re-renders via the bridge's base
		// computed. Dialog: rebuild the (non-reactive) `_base` schema.
		this.host.rebuild_schema?.()
	}

	toggle_enable(fieldname: string, enable: boolean) {
		this.update_docfield_property(fieldname, 'read_only', enable ? 0 : 1)
	}
	toggle_reqd(fieldname: string, reqd: boolean) {
		this.update_docfield_property(fieldname, 'reqd', reqd ? 1 : 0)
	}
	toggle_display(fieldname: string, show: boolean) {
		this.update_docfield_property(fieldname, 'hidden', show ? 0 : 1)
	}
	set_column_disp(fieldname: string | string[], show: boolean) {
		const names = Array.isArray(fieldname) ? fieldname : [fieldname]
		for (const fn of names) this.update_docfield_property(fn, 'hidden', show ? 0 : 1)
	}
	// Legacy adds a "multiple add" affordance; the Vue grid has none yet (gap).
	set_multiple_add(_link?: string, _qty?: number) {}

	// Grid custom buttons (erpnext "Get Items From", "Update Rate as per Latest
	// Purchase", …). The Vue grid has no button rail yet, so these are safe no-ops
	// (parity with the old grid stub — the button just doesn't render) that return a
	// detached jQuery button so caller chains (`.addClass()`, `.on("click")`,
	// `.removeClass()`) don't throw.
	custom_buttons: Record<string, any> = {}
	add_custom_button(label: string, _click?: any): any {
		const btn = $ ? $('<button class="btn btn-xs btn-secondary">').text(label) : undefined
		if (label) this.custom_buttons[label] = btn
		return btn
	}
	clear_custom_buttons() {
		this.custom_buttons = {}
	}

	// --- structural ops ----------------------------------------------------
	add_new_row(idx?: number): any {
		if (this.frm) {
			const d = frappe.model.add_child(this.frm.doc, this.doctype, this.df.fieldname, idx)
			d.__unedited = true
			this.frm.script_manager?.trigger?.(this.df.fieldname + '_add', d.doctype, d.name)
			this.refresh()
			return d
		}
		const doc = this.host.get_doc()
		const arr: any[] = Array.isArray(doc[this.df.fieldname]) ? doc[this.df.fieldname] : []
		const defaults: Record<string, any> = {}
		for (const cf of this.docfields) if (cf.default !== undefined) defaults[cf.fieldname] = cf.default
		const row = { idx: arr.length + 1, __islocal: true, ...defaults }
		const next = [...arr, row]
		doc[this.df.fieldname] = next // reassign → Vue re-render
		this.df.data = next
		return row
	}

	remove_all() {
		if (this.frm) {
			frappe.model.clear_table(this.frm.doc, this.df.fieldname)
			this.frm.dirty()
		} else {
			this.host.get_doc()[this.df.fieldname] = []
			this.df.data = []
		}
		this._rowHandles.clear()
		this.refresh()
	}

	reset_grid() {
		this.refresh()
	}

	// Form: resync the reactive mirror from frm.doc (identity-preserving seedField).
	// Dialog: reassigning the doc array is what re-renders the Vue grid, so mirror
	// `df.data → _vdoc` first (legacy shim parity).
	refresh() {
		if (!this.frm) {
			const doc = this.host.get_doc()
			doc[this.df.fieldname] = [...(this.df.data || doc[this.df.fieldname] || [])]
		}
		this.host.refresh_view(this.df.fieldname)
	}

	// grid.set_value is called by the model listener to reflect a cell change; the
	// bridge mirror already does that, so this just re-syncs the view.
	set_value(_fieldname: string, _value: any, _doc?: any) {
		this.refresh()
	}

	// --- rows --------------------------------------------------------------
	get grid_rows(): GridRowHandle[] {
		const data = this.get_data()
		const present = new Set<string>()
		const handles = data.map((doc: any) => {
			const key = doc.name
			present.add(key)
			let h = this._rowHandles.get(key)
			if (!h) {
				h = this._makeRowHandle(key)
				this._rowHandles.set(key, h)
			}
			h.doc = doc
			return h
		})
		// Prune handles whose row is gone (pruned-against-current-array on access).
		for (const k of [...this._rowHandles.keys()]) if (!present.has(k)) this._rowHandles.delete(k)
		return handles
	}

	get grid_rows_by_docname(): Record<string, GridRowHandle> {
		const map: Record<string, GridRowHandle> = {}
		for (const h of this.grid_rows) map[h.name] = h
		return map
	}

	get_row(key: number | string): GridRowHandle | undefined {
		if (typeof key === 'number') {
			const rows = this.grid_rows
			return key < 0 ? rows[rows.length + key] : rows[key]
		}
		return this.grid_rows_by_docname[key]
	}
	get_grid_row(key: number | string): GridRowHandle | undefined {
		return this.get_row(key)
	}

	private _makeRowHandle(name: string): GridRowHandle {
		const grid = this
		const handle: GridRowHandle = {
			doc: null,
			name,
			get idx() {
				return handle.doc?.idx
			},
			// Splice + idx renumber + dirty + mirror resync. Legacy `*_remove` script
			// triggers are out of scope (documented).
			remove() {
				const fieldname = grid.df.fieldname
				if (grid.frm) {
					const arr: any[] = grid.frm.doc[fieldname] || []
					const i = arr.indexOf(handle.doc)
					if (i > -1) arr.splice(i, 1)
					arr.forEach((r, k) => (r.idx = k + 1))
					frappe.model.clear_doc?.(handle.doc.doctype, handle.doc.name)
					grid.frm.dirty()
				} else {
					const doc = grid.host.get_doc()
					const next = (doc[fieldname] || []).filter((r: any) => r !== handle.doc)
					next.forEach((r: any, k: number) => (r.idx = k + 1))
					doc[fieldname] = next
					grid.df.data = next
				}
				grid._rowHandles.delete(name)
				grid.refresh()
			},
			refresh_field(_fieldname?: string) {
				grid.refresh()
			},
			// Grid-wide approximation (the Vue grid has no per-row editability yet).
			toggle_editable(fieldname: string, editable: boolean) {
				grid.update_docfield_property(fieldname, 'read_only', editable ? 0 : 1)
			},
			get_field(fieldname: string) {
				return grid.get_field(fieldname)
			},
		}
		return handle
	}

	// --- selection (read from the rendered checkbox DOM) --------------------
	private _selectedRowIndices(): number[] {
		const node: HTMLElement | undefined = this.wrapper?.get?.(0)
		if (!node) return []
		const indices: number[] = []
		node.querySelectorAll('.grid-row').forEach((rowEl, i) => {
			const cb = rowEl.querySelector('input[type="checkbox"]') as HTMLInputElement | null
			if (cb?.checked) indices.push(i)
		})
		return indices
	}

	get_selected_children(): any[] {
		const data = this.get_data()
		return this._selectedRowIndices()
			.map((i) => data[i])
			.filter(Boolean)
	}
	get_selected(): string[] {
		return this.get_selected_children().map((d) => d.name)
	}
}

// --- Table controls (own the grid) ------------------------------------------
// Mirrors legacy `ControlTable`: the value is the child array, so the model methods
// delegate to the grid rather than the scalar path, and it carries the DIRECT
// `get_field` helper (distinct from `grid.get_field`) that scripts call on the
// control itself (erpnext utils.js toggle_serial_batch_fields).
export class FrappeControlTable extends FrappeControlData {
	grid: FrappeGrid
	constructor(opts: ControlOpts) {
		super(opts)
		this.grid = new FrappeGrid(this, this.host)
	}

	// Resolve a CHILD column by fieldname/label (case-insensitive, skipping
	// no-value types) → its fieldname, else undefined. A "does this column exist?"
	// guard — NOT the grid's per-field get_query handle.
	get_field(field_name: string): string | undefined {
		const target = String(field_name ?? '').toLowerCase()
		for (const field of this.grid.docfields) {
			if (frappe.model.no_value_type?.includes(field.fieldtype)) continue
			const label = field.label || ''
			if (
				(field.fieldname || '').toLowerCase() === target ||
				label.toLowerCase() === target ||
				(__(label, null, field.parent) || '').toLowerCase() === target
			) {
				return field.fieldname
			}
		}
		return undefined
	}

	get_value(): any {
		return this.grid.get_data()
	}
	refresh_input() {
		this.grid.refresh()
	}
	// A table has no scalar input (legacy no-op); the base would wrongly route this
	// through frappe.model.set_value on the table field.
	set_input() {}
	validate(): any {
		return this.get_value()
	}
	// Best-effort: click the grid's header "select all" checkbox (first checkbox in
	// the resolved wrapper). No-ops safely when the grid isn't mounted.
	check_all_rows() {
		const cb = this.$wrapper?.get?.(0)?.querySelector?.('input[type="checkbox"]')
		cb?.click?.()
	}
}

export class FrappeControlTableMultiSelect extends FrappeControlTable {}
