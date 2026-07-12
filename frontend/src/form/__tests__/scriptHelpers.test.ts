// The legacy global form helpers (unhide_field / hide_field / toggle_field /
// refresh_field) must be defined AND route through the frm's reactive df — the
// verbatim legacy version mutated shared `frappe.meta`, which the Vue-native form
// doesn't render from.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installScriptHelpers } from '../scriptHelpers'

const g: any = globalThis
const w: any = typeof window !== 'undefined' ? window : globalThis

describe('script helper globals', () => {
	let frm: any
	beforeEach(() => {
		frm = {
			doctype: 'ToDo',
			docname: 't1',
			fields_dict: {
				status: { df: { fieldname: 'status', hidden: 0 } },
				a: { df: { fieldname: 'a', hidden: 0 } },
				b: { df: { fieldname: 'b', hidden: 0 } },
				items: { grid: { grid_rows_by_docname: {}, refresh: vi.fn() } },
			},
			get_docfield: (fn: string) => frm.fields_dict[fn]?.df,
			set_df_property: vi.fn((fn: string, prop: string, val: any) => {
				const df = frm.fields_dict[fn]?.df
				if (df) df[prop] = val
			}),
			refresh_field: vi.fn(),
		}
		g.cur_frm = frm
		w.cur_frm = frm
		installScriptHelpers()
	})
	afterEach(() => {
		g.cur_frm = undefined
		w.cur_frm = undefined
	})

	it('unhide_field / hide_field route through set_df_property (reactive df)', () => {
		w.hide_field('status')
		expect(frm.fields_dict.status.df.hidden).toBe(1)
		expect(frm.set_df_property).toHaveBeenCalledWith('status', 'hidden', 1)
		w.unhide_field('status')
		expect(frm.fields_dict.status.df.hidden).toBe(0)
	})

	it('hide_field accepts an array of fieldnames', () => {
		w.hide_field(['a', 'b'])
		expect(frm.fields_dict.a.df.hidden).toBe(1)
		expect(frm.fields_dict.b.df.hidden).toBe(1)
	})

	it('toggle_field logs (does not throw) for an unknown field', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		expect(() => w.toggle_field('nonexistent', 1)).not.toThrow()
		expect(spy).toHaveBeenCalled()
		spy.mockRestore()
	})

	it('refresh_field on a child table drives the grid facade', () => {
		w.refresh_field('qty', undefined, 'items')
		expect(frm.fields_dict.items.grid.refresh).toHaveBeenCalled()
	})

	it('refresh_field on a parent field calls frm.refresh_field', () => {
		w.refresh_field('status')
		expect(frm.refresh_field).toHaveBeenCalledWith('status')
	})
})
