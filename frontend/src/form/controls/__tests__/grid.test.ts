// Grid facade contract tests (phases 2-3): column ops via the reactive child df,
// data/row ops via frappe.model (form) / the doc array (dialog), and selection read
// from the rendered checkbox DOM.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowReactive, computed } from 'vue'
import { buildLayoutFromMeta } from '@framework/ui/components/FormLayout/buildLayoutFromMeta'
import { resolveLayout } from '@framework/ui/components/FormLayout/resolveLayout'
import { installFrappeStub } from './frappeStub'
import type { FrappeStub } from './frappeStub'
import { makeControl } from '../makeControl'
import { frmHost, dialogHost } from '../host'

const DT = 'Sales Order'
const CDT = 'Sales Order Item'
const PARENT_META = [{ fieldname: 'items', fieldtype: 'Table', label: 'Items', parent: DT, options: CDT }]
const CHILD_META = [
	{ fieldname: 'item_code', fieldtype: 'Link', options: 'Item', parent: CDT, in_list_view: 1 },
	{ fieldname: 'qty', fieldtype: 'Float', parent: CDT, in_list_view: 1 },
	{ fieldname: 'rate', fieldtype: 'Currency', parent: CDT, in_list_view: 1 },
]

function fakeFrm(stub: FrappeStub, wrapper?: HTMLElement) {
	stub.setMeta(DT, PARENT_META)
	stub.setMeta(CDT, CHILD_META)
	const doc = stub.setDoc({ doctype: DT, name: 'SO-1', items: [] })
	const frm: any = {
		doctype: DT,
		docname: 'SO-1',
		doc,
		wrapper: wrapper || document.body,
		_child_dfs: { [CDT]: CHILD_META.map((f) => shallowReactive({ ...f })) },
		fields_dict: {},
		_seed_field: vi.fn(),
		script_manager: { trigger: vi.fn() },
		dirty: vi.fn(),
	}
	return frm
}

function tableControl(frm: any) {
	const df = shallowReactive({ ...PARENT_META[0] })
	const control = makeControl({ df, host: frmHost(frm) })
	frm.fields_dict.items = control
	return control
}

describe('grid — column ops (reactive child df)', () => {
	let stub: FrappeStub
	let frm: any
	beforeEach(() => {
		stub = installFrappeStub()
		frm = fakeFrm(stub)
	})

	it('update_docfield_property(hidden) drops the column from the rendered grid', () => {
		const control = tableControl(frm)
		const layout = computed(() =>
			buildLayoutFromMeta([control.df], { childMetas: frm._child_dfs })
		)
		const cols = () => {
			const node = resolveLayout(layout.value, frm.doc)[0].sections[0].columns[0].fields[0]
			return (node.childFields || []).map((f: any) => f.fieldname)
		}
		expect(cols()).toEqual(['item_code', 'qty', 'rate'])
		control.grid.update_docfield_property('qty', 'hidden', 1)
		expect(cols()).toEqual(['item_code', 'rate'])
	})

	it('toggle_reqd / toggle_enable / set_column_disp write the child df', () => {
		const control = tableControl(frm)
		control.grid.toggle_reqd('qty', true)
		control.grid.toggle_enable('rate', false)
		control.grid.set_column_disp('item_code', false)
		// Legacy grid mutators store 0/1 (via update_docfield_property), not booleans.
		expect(control.grid.get_docfield('qty').reqd).toBe(1)
		expect(control.grid.get_docfield('rate').read_only).toBe(1)
		expect(control.grid.get_docfield('item_code').hidden).toBe(1)
	})

	it('get_field returns a stable handle with an assignable, per-grid get_query', () => {
		const control = tableControl(frm)
		const q = () => ({ filters: { is_stock_item: 1 } })
		control.grid.get_field('item_code').get_query = q
		expect(control.grid.get_field('item_code').get_query).toBe(q)
		// same handle object on repeated access
		expect(control.grid.get_field('item_code')).toBe(control.grid.get_field('item_code'))
	})

	it('Table control.get_field guards child-column existence (utils.js pattern)', () => {
		const control = tableControl(frm)
		// A "does this child column exist?" guard returning the fieldname / undefined,
		// distinct from grid.get_field (the get_query stash handle).
		expect(control.get_field('qty')).toBe('qty')
		expect(control.get_field('QTY')).toBe('qty') // case-insensitive
		expect(control.get_field('nonexistent')).toBeUndefined()
		expect(typeof control.grid.get_field).toBe('function')
	})

	it('child df ownership is per-cdt-per-form: two grids of the same cdt share dfs', () => {
		const a = tableControl(frm)
		// a second table field of the same child doctype
		const dfB = shallowReactive({ fieldname: 'packed_items', fieldtype: 'Table', options: CDT, parent: DT })
		const b = makeControl({ df: dfB, host: frmHost(frm) })
		a.grid.update_docfield_property('qty', 'reqd', 1)
		expect(b.grid.get_docfield('qty').reqd).toBe(1) // reached the shared df
	})
})

describe('grid — data & row ops', () => {
	let stub: FrappeStub
	let frm: any
	beforeEach(() => {
		stub = installFrappeStub()
		frm = fakeFrm(stub)
	})

	it('add_new_row adds a child via frappe.model + fires the _add trigger + resync', () => {
		const control = tableControl(frm)
		const row = control.grid.add_new_row()
		expect(frm.doc.items).toHaveLength(1)
		expect(frm.doc.items[0]).toBe(row)
		expect(frm.script_manager.trigger).toHaveBeenCalledWith('items_add', CDT, row.name)
		expect(frm._seed_field).toHaveBeenCalledWith('items')
	})

	it('grid_rows[i].remove() splices, renumbers idx, dirties, and resyncs', () => {
		const control = tableControl(frm)
		control.grid.add_new_row()
		control.grid.add_new_row()
		control.grid.add_new_row()
		expect(frm.doc.items).toHaveLength(3)
		const rows = control.grid.grid_rows
		rows[1].remove()
		expect(frm.doc.items).toHaveLength(2)
		expect(frm.doc.items.map((r: any) => r.idx)).toEqual([1, 2]) // renumbered
		expect(frm.dirty).toHaveBeenCalled()
	})

	it('grid_rows returns stable handles cached by docname', () => {
		const control = tableControl(frm)
		control.grid.add_new_row()
		const h1 = control.grid.grid_rows[0]
		const h2 = control.grid.grid_rows[0]
		expect(h1).toBe(h2)
	})

	it('get_row / get_grid_row / get_data resolve rows', () => {
		const control = tableControl(frm)
		const r0 = control.grid.add_new_row()
		const r1 = control.grid.add_new_row()
		expect(control.grid.get_data()).toHaveLength(2)
		expect(control.grid.get_row(0)?.doc).toBe(r0)
		expect(control.grid.get_row(-1)?.doc).toBe(r1)
		expect(control.grid.get_row(r1.name)?.doc).toBe(r1)
	})

	it('remove_all clears the table', () => {
		const control = tableControl(frm)
		control.grid.add_new_row()
		control.grid.add_new_row()
		control.grid.remove_all()
		expect(frm.doc.items).toHaveLength(0)
	})
})

describe('grid — selection from rendered checkbox DOM', () => {
	let stub: FrappeStub
	let frm: any
	let wrapper: HTMLElement

	beforeEach(() => {
		stub = installFrappeStub()
		wrapper = document.createElement('div')
		wrapper.innerHTML = `
			<div data-fieldname="items">
				<div class="grid-row"><input type="checkbox"></div>
				<div class="grid-row"><input type="checkbox" checked></div>
				<div class="grid-row"><input type="checkbox" checked></div>
			</div>`
		document.body.appendChild(wrapper)
		frm = fakeFrm(stub, wrapper)
	})

	it('get_selected_children returns the checked rows; get_selected their names', () => {
		const control = tableControl(frm)
		const a = control.grid.add_new_row()
		const b = control.grid.add_new_row()
		const c = control.grid.add_new_row()
		void a
		expect(control.grid.get_selected_children()).toEqual([b, c])
		expect(control.grid.get_selected()).toEqual([b.name, c.name])
	})
})

describe('grid — dialog host', () => {
	beforeEach(() => installFrappeStub())

	function fakeDialog() {
		const _vdoc = shallowReactive<Record<string, any>>({ items: [] })
		return {
			_vdoc,
			doc: _vdoc,
			refresh: vi.fn(),
			set_value: vi.fn(),
			set_df_property: vi.fn(),
			_fieldWrapper: vi.fn(() => (window as any).$(null)),
			fields_dict: {},
		}
	}

	it('add_new_row pushes a defaulted row into the dialog _vdoc array', () => {
		const dialog = fakeDialog()
		const df = shallowReactive({
			fieldname: 'items',
			fieldtype: 'Table',
			options: CDT,
			fields: [{ fieldname: 'qty', fieldtype: 'Float', default: 1 }],
		})
		const control = makeControl({ df, host: dialogHost(dialog) })
		dialog.fields_dict.items = control
		const row = control.grid.add_new_row()
		expect(dialog._vdoc.items).toHaveLength(1)
		expect(dialog._vdoc.items[0]).toEqual(row)
		expect(row.qty).toBe(1) // column default applied
	})
})
