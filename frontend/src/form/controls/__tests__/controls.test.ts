// Phase-1 contract tests: the class layer (host + hierarchy + factory), exercised
// through both a frm-like host and a dialog-like host, WITHOUT the real vueForm /
// bridge / dialog (those are Vue/DOM-coupled and covered end-to-end on the dev
// server). Asserts the properties the plan calls out: reactive-df render, legacy
// set_df_property + refresh() parity, value routing through frappe.model, factory
// contract, and dialog/frm shape parity.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive, shallowReactive, computed } from 'vue'
import { buildLayoutFromMeta } from '@framework/ui/components/FormLayout/buildLayoutFromMeta'
import { resolveLayout } from '@framework/ui/components/FormLayout/resolveLayout'
import { installFrappeStub, getFrappeStub } from './frappeStub'
import type { FrappeStub } from './frappeStub'
import { makeControl } from '../makeControl'
import { frmHost, dialogHost } from '../host'

const DT = 'ToDo'
const META = [
	{ fieldname: 'title', fieldtype: 'Data', label: 'Title', parent: DT, hidden: 0 },
	{ fieldname: 'priority', fieldtype: 'Select', label: 'Priority', parent: DT, options: 'Low\nHigh' },
	{ fieldname: 'owner_link', fieldtype: 'Link', label: 'Owner', parent: DT, options: 'User' },
	{ fieldname: 'done', fieldtype: 'Check', label: 'Done', parent: DT },
	{ fieldname: 'notes_html', fieldtype: 'HTML', label: 'Notes', parent: DT },
	{ fieldname: 'sb', fieldtype: 'Section Break', parent: DT },
]

// A minimal frm satisfying what `frmHost` reads; `set_df_property` writes the same
// reactive df the control holds (single-df invariant), mirroring the real rewire.
function fakeFrm(stub: FrappeStub, docname: string) {
	stub.setMeta(DT, META)
	const doc = stub.setDoc({ doctype: DT, name: docname, title: 'Old' })
	const frm: any = {
		doctype: DT,
		docname,
		doc,
		perm: [{ read: 1, write: 1 }],
		wrapper: document.body,
		_child_dfs: {},
		fields_dict: {},
		_seed_field: vi.fn(),
		script_manager: { trigger: vi.fn() },
		dirty: vi.fn(),
		set_df_property(fn: string, prop: string, val: any) {
			const df = frm.fields_dict[fn]?.df
			if (df && df[prop] !== val) df[prop] = val
		},
	}
	return frm
}

function buildControl(frm: any, metaDf: any) {
	const df = shallowReactive({ ...metaDf })
	const control = makeControl({ df, host: frmHost(frm) })
	frm.fields_dict[df.fieldname] = control
	return control
}

// Resolve the single field out of a one-field layout built from a control df.
function resolvedField(control: any, doc: any) {
	const layout = computed(() => buildLayoutFromMeta([control.df]))
	return () => resolveLayout(layout.value, doc)[0].sections[0].columns[0].fields[0]
}

describe('control hierarchy (frm host)', () => {
	let stub: FrappeStub
	let frm: any
	beforeEach(() => {
		stub = installFrappeStub()
		frm = fakeFrm(stub, 't1')
	})

	it('reactive df: df.hidden = 1 flips the resolved field with no refresh() call', () => {
		const control = buildControl(frm, META[0])
		const field = resolvedField(control, frm.doc)
		expect(field().hidden).toBe(false)
		control.df.hidden = 1
		expect(field().hidden).toBe(true)
	})

	it('back-compat: legacy set_df_property + refresh() produces the same resolved state', () => {
		const control = buildControl(frm, META[0])
		const field = resolvedField(control, frm.doc)
		expect(field().readOnly).toBe(false)
		frm.set_df_property('title', 'read_only', 1)
		control.refresh() // legacy pattern; render already reflects the reactive df
		expect(field().readOnly).toBe(true)
		expect(frm._seed_field).toHaveBeenCalledWith('title')
	})

	it('value routing: set_value commits through frappe.model.set_value', async () => {
		const control = buildControl(frm, META[0])
		await control.set_value('New Title')
		expect(stub.setValueSpy).toHaveBeenCalledWith(DT, 't1', 'title', 'New Title')
		expect(control.get_value()).toBe('New Title')
	})

	it('value getter/setter reads/writes through the model', () => {
		const control = buildControl(frm, META[0])
		expect(control.value).toBe('Old')
		control.value = 'Set Via Property'
		expect(stub.setValueSpy).toHaveBeenCalledWith(DT, 't1', 'title', 'Set Via Property')
	})

	it('set_label / set_description re-render via the reactive df', () => {
		const control = buildControl(frm, META[0])
		const field = resolvedField(control, frm.doc)
		control.set_label('Renamed')
		control.set_description('Some help')
		expect(field().label).toBe('Renamed')
		expect(field().description).toBe('Some help')
	})

	it('toggle(false) hides the field on its own', () => {
		const control = buildControl(frm, META[0])
		const field = resolvedField(control, frm.doc)
		control.toggle(false)
		expect(field().hidden).toBe(true)
		control.toggle(true)
		expect(field().hidden).toBe(false)
	})

	it('Check.get_input_value coerces the model value to 0/1', () => {
		frm.doc.done = 1
		const control = buildControl(frm, META[3])
		expect(control.get_input_value()).toBe(1)
		frm.doc.done = 0
		expect(control.get_input_value()).toBe(0)
	})

	it('Link exposes get_options + an assignable get_query', () => {
		const control = buildControl(frm, META[2])
		expect(control.get_options()).toBe('User')
		const q = () => ({ filters: { enabled: 1 } })
		control.get_query = q
		expect(control.get_query).toBe(q)
	})

	it('Select.set_options updates options through the reactive df', () => {
		const control = buildControl(frm, META[1])
		const field = resolvedField(control, frm.doc)
		control.set_options('A\nB\nC')
		expect(field().options).toBe('A\nB\nC')
	})

	it('HTML control resolves an eager $wrapper node and html() writes it', () => {
		const control = buildControl(frm, META[4])
		control.html('<b>hi</b>')
		expect(control.$wrapper.get(0).innerHTML).toBe('<b>hi</b>')
		// The eager node is stable across resolves (HtmlField.vue adopts $wrapper[0]).
		expect(control.$wrapper.get(0)).toBe(control.$wrapper.get(0))
	})

	it('container control (Section Break) exposes a jQuery wrapper', () => {
		const control = buildControl(frm, META[5])
		expect(control.wrapper).toBeDefined()
		expect(typeof control.wrapper.addClass).toBe('function')
		expect(() => control.wrapper.addClass('x')).not.toThrow()
	})

	it('universal mutators resolve on a container control (erpnext relabels sections)', () => {
		// erpnext reset_currency_labels(["totals_section"]) calls set_label on a
		// Section Break — the old handle exposed set_label on every entry.
		const control = buildControl(frm, META[5]) // Section Break
		expect(typeof control.set_label).toBe('function')
		expect(typeof control.set_description).toBe('function')
		expect(typeof control.set_input).toBe('function')
		control.df.label = 'Totals'
		control.set_label('Totals (INR)')
		expect(control.df.label).toBe('Totals (INR)')
		expect(control.options).toBe(control.df.options)
	})

	it('disp_status is a lazy getter, settable, defaulting to Write', () => {
		const control = buildControl(frm, META[0])
		expect(control.disp_status).toBe('Write')
		control.disp_status = 'Read'
		expect(control.disp_status).toBe('Read')
	})
})

describe('factory contract', () => {
	beforeEach(() => installFrappeStub())
	it('returns undefined for an unknown fieldtype (layout.js:262 null contract)', () => {
		const stub = getFrappeStub()
		const frm = fakeFrm(stub, 't1')
		const control = makeControl({ df: { fieldname: 'x', fieldtype: 'Bogus' }, host: frmHost(frm) })
		expect(control).toBeUndefined()
	})
	it('resolves the class by "Control" + fieldtype', () => {
		const stub = getFrappeStub()
		const frm = fakeFrm(stub, 't1')
		const link = makeControl({ df: reactive({ fieldname: 'l', fieldtype: 'Link', options: 'User' }), host: frmHost(frm) })
		expect(typeof link.get_options).toBe('function')
	})
})

describe('dialog / frm shape parity', () => {
	beforeEach(() => installFrappeStub())

	function fakeDialog() {
		const _vdoc = reactive<Record<string, any>>({ title: 'Dlg' })
		const changes: any[] = []
		const dialog: any = {
			_vdoc,
			doc: _vdoc,
			refresh: vi.fn(),
			set_value: vi.fn((fn: string, v: any) => {
				_vdoc[fn] = v
				changes.push([fn, v])
			}),
			set_df_property: vi.fn((fn: string, prop: string, v: any) => {
				// dialog writes the reactive df (post-rewire behaviour)
				if (dialog.fields_dict[fn]) dialog.fields_dict[fn].df[prop] = v
			}),
			_fieldWrapper: vi.fn(() => (window as any).$(document.createElement('div'))),
			fields_dict: {},
		}
		return { dialog, changes }
	}

	it('frm and dialog controls share the same method surface', () => {
		const stub = getFrappeStub()
		const frm = fakeFrm(stub, 't1')
		const { dialog } = fakeDialog()
		const df1 = shallowReactive({ fieldname: 'title', fieldtype: 'Data' })
		const df2 = shallowReactive({ fieldname: 'title', fieldtype: 'Data' })
		const frmControl = makeControl({ df: df1, host: frmHost(frm) })
		const dlgControl = makeControl({ df: df2, host: dialogHost(dialog) })
		for (const m of ['get_value', 'set_value', 'set_input', 'refresh', 'toggle', 'set_label']) {
			expect(typeof frmControl[m]).toBe('function')
			expect(typeof dlgControl[m]).toBe('function')
		}
	})

	it('dialog control routes set_value through dialog.set_value (no double change)', async () => {
		const { dialog } = fakeDialog()
		const df = shallowReactive({ fieldname: 'title', fieldtype: 'Data', change: vi.fn() })
		const control = makeControl({ df, host: dialogHost(dialog) })
		dialog.fields_dict.title = control
		await control.set_value('Edited')
		expect(dialog.set_value).toHaveBeenCalledWith('title', 'Edited')
		// df.change is fired by dialog.set_value, NOT again by the control (frm-only).
		expect(df.change).not.toHaveBeenCalled()
	})
})
