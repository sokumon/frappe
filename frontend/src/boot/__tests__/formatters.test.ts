// Contract tests for the frappe.format / frappe.form.formatters port
// (boot/formatters.ts): fieldtype routing, the numeric formatters' precision
// rules, link rendering, and that pre-registered link_formatters survive the
// install (erpnext client scripts assign them at module eval).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installFormatters } from '../formatters'

const g: any = globalThis

function installGlobals() {
	g.cint = (v: any) => {
		const n = parseInt(v, 10)
		return isNaN(n) ? 0 : n
	}
	g.cstr = (v: any) => (v == null ? '' : String(v))
	g.is_null = (v: any) => v === null || v === undefined || v === ''
	g.format_number = (v: any, _f: any, p: any) => Number(v).toFixed(p == null ? 3 : p)
	g.format_currency = (v: any, currency: any, p: any) =>
		`${currency} ${Number(v).toFixed(p ?? 2)}`
	g.repl = (s: string, dict: any) =>
		s.replace(/%\((\w+)\)s/g, (_m, key) => String(dict[key]))
	for (const k of ['cint', 'cstr', 'is_null', 'format_number', 'format_currency', 'repl']) {
		;(window as any)[k] = g[k]
	}

	const frappe: any = {
		provide(ns: string) {
			let cur: any = g
			for (const part of ns.split('.')) {
				cur[part] = cur[part] || {}
				cur = cur[part]
			}
		},
		boot: { sysdefaults: { float_precision: '3', currency_precision: '2' } },
		meta: {
			docfield_map: {},
			get_docfield: () => undefined,
			get_field_currency: () => 'INR',
		},
		model: {
			get_value: () => undefined,
			can_read: () => true,
		},
		utils: {
			escape_html: (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
			get_formatted_iban: (v: string) => `IBAN(${v})`,
			get_link_title: () => undefined,
			replace_newlines: (t: string) => t.replace(/\n/g, '<br>'),
			get_duration_options: () => ({}),
			get_formatted_duration: (v: number) => `${v}s`,
			is_emoji: () => false,
			icon: () => '<svg/>',
		},
		datetime: { str_to_user: (v: string) => `user(${v})` },
		dom: { remove_script_and_style: vi.fn((s: string) => s) },
		router: { slug: (dt: string) => dt.toLowerCase().replace(/ /g, '-') },
		get_meta: () => undefined,
		get_doc: () => undefined,
		avatar: (v: string) => `<avatar>${v}</avatar>`,
	}
	g.frappe = frappe
	;(window as any).frappe = frappe
}

describe('frappe.format port', () => {
	beforeEach(() => {
		installGlobals()
		installFormatters()
	})

	it('keeps link_formatters registered before install (erpnext eval-time)', () => {
		installGlobals()
		const custom = () => 'X'
		g.frappe.form = { link_formatters: { Item: custom } }
		installFormatters()
		expect(g.frappe.form.link_formatters.Item).toBe(custom)
		expect(g.frappe.form.link_formatters.User).toBeTypeOf('function')
	})

	it('get_formatter strips spaces and falls back to Data', () => {
		const f = g.frappe.form
		expect(f.get_formatter('Small Text')).toBe(f.formatters.SmallText)
		expect(f.get_formatter('Nonexistent Type')).toBe(f.formatters.Data)
		expect(f.get_formatter(undefined)).toBe(f.formatters.Data)
	})

	it('Data handles URL and IBAN options', () => {
		const f = g.frappe.form.formatters
		expect(f.Data('http://x.co', { options: 'URL' })).toContain('href="http://x.co"')
		expect(f.Data('DE89', { options: 'IBAN' })).toBe('IBAN(DE89)')
		expect(f.Data(null, {})).toBe('')
	})

	it('Float collapses zero decimals and right-aligns', () => {
		const f = g.frappe.form.formatters
		expect(f.Float(1.0, {})).toBe("<div style='text-align: right'>1</div>")
		expect(f.Float(1.5, {}, { inline: true })).toBe('1.500')
		expect(f.Float(null, {})).toBe('')
	})

	it('Int routes File Size options through FileSize', () => {
		const f = g.frappe.form.formatters
		expect(f.Int(2 * 1048576, { options: 'File Size' })).toBe('2.00M')
		expect(f.Int(2048, { options: 'File Size' })).toBe('2.00K')
		expect(f.Int('7.9', {}, { only_value: true })).toBe(7)
	})

	it('Percent caps precision at the value precision', () => {
		const f = g.frappe.form.formatters
		expect(f.Percent(12.5, {}, { only_value: true })).toBe('12.5%')
		expect(f.Percent(12, {}, { only_value: true })).toBe('12%')
	})

	it('Currency respects only_value and the field currency', () => {
		const f = g.frappe.form.formatters
		expect(f.Currency(10, { precision: 2 }, { only_value: true }, {})).toBe('INR 10.00')
		expect(f.Currency(null, {}, {}, {})).toBe('')
	})

	it('Link renders a /desk anchor when readable, plain value otherwise', () => {
		const f = g.frappe.form.formatters
		const html = f.Link('ITEM-001', { options: 'Item Price' }, undefined, undefined)
		expect(html).toContain('href="/desk/item-price/ITEM-001"')
		expect(html).toContain('data-doctype="Item Price"')

		g.frappe.model.can_read = () => false
		expect(f.Link('ITEM-001', { options: 'Item Price' }, undefined, undefined)).toBe('ITEM-001')
	})

	it('Link applies link_formatters except for composite same-doctype docs', () => {
		const f = g.frappe.form.formatters
		const doc = { doctype: 'ToDo', full_name: 'Jane Doe' }
		const html = f.Link('jane@x.co', { options: 'User', fieldname: 'owner' }, undefined, doc)
		expect(html).toContain('Jane Doe')

		const userDoc = { doctype: 'User', full_name: 'Jane Doe' }
		const html2 = f.Link('jane@x.co', { options: 'User', fieldname: 'owner' }, undefined, userDoc)
		expect(html2).toContain('jane@x.co')
		expect(html2).not.toContain('Jane Doe')
	})

	it('frappe.format routes _user_tags to Tag and Dynamic Link to Link', () => {
		const tags = g.frappe.format('a,b', { fieldname: '_user_tags', fieldtype: 'Data' })
		expect(tags).toContain('data-label="a"')
		expect(tags).toContain('data-label="b"')

		const doc = { doctype: 'ToDo', ref_type: 'Note', ref_name: 'N1' }
		const html = g.frappe.format(
			'N1',
			{ fieldtype: 'Dynamic Link', options: 'ref_type', fieldname: 'ref_name' },
			undefined,
			doc
		)
		expect(html).toContain('href="/desk/note/N1"')
	})

	it('frappe.format masks fields listed in meta.masked_fields', () => {
		g.frappe.get_meta = () => ({ masked_fields: ['secret'] })
		const out = g.frappe.format('abc', {
			fieldtype: 'Currency',
			parent: 'ToDo',
			fieldname: 'secret',
		})
		expect(out).toBe('abc') // Data formatter, not Currency
	})

	it('frappe.format strips script/style from string output', () => {
		g.frappe.format('x', { fieldtype: 'Data' })
		expect(g.frappe.dom.remove_script_and_style).toHaveBeenCalled()
	})

	it('Duration/LikedBy/Assign render from ported utils', () => {
		const f = g.frappe.form.formatters
		expect(f.Duration(90, {})).toBe('90s')
		expect(f.Duration(0, {})).toBe('0s')
		expect(f.LikedBy('["a","b"]')).toBe('<avatar>a</avatar><avatar>b</avatar>')
		expect(f.Assign('["x"]')).toContain('data-field="_assign"')
	})
})
