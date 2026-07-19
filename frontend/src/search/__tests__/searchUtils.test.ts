// Contract tests for the frappe.search.utils port (search/searchUtils.ts) — the
// result engine behind the ⌘K palette. They pin the behaviour the palette
// depends on: fuzzy ranking + <mark> highlighting, the option shape each
// provider emits (type / label / value / index / route), and the boot-driven
// permission gates (can_read / can_search / can_create).
import { describe, it, expect, beforeEach } from 'vitest'
import { installSearch } from '../searchUtils'

const g: any = globalThis

function installFrappe(boot: any = {}) {
	const frappe: any = {
		provide(ns: string) {
			let cur: any = frappe
			for (const part of ns.split('.').slice(1)) {
				cur[part] = cur[part] || {}
				cur = cur[part]
			}
		},
		boot: {
			lang: 'en',
			single_types: [],
			tree_view_doctypes: [],
			doctype_layouts: [],
			dashboards: [],
			page_info: {},
			workspace_sidebar_item: {},
			frequently_visited_links: [],
			user: {
				recent: '[]',
				can_read: [],
				can_search: [],
				can_create: [],
				all_reports: {},
			},
			...boot,
		},
		route_history: [],
		route_titles: {},
		utils: {
			escape_html: (t: any) => String(t).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
			bold: (t: any) => `<strong>${t}</strong>`,
			get_route_label: (r: string[]) => r.join(' / '),
			parse_layout_condition_to_filters: () => ({}),
		},
		model: { can_get_report: () => false },
	}
	g.frappe = frappe
	;(window as any).frappe = frappe
	installSearch()
	return frappe
}

beforeEach(() => {
	installFrappe()
})

describe('fuzzy_search', () => {
	it('scores a tighter match above a looser one', () => {
		const u = g.frappe.search.utils
		// exact title beats the same title with a trailing word
		expect(u.fuzzy_search('sales order', 'Sales Order')).toBeGreaterThan(
			u.fuzzy_search('sales order', 'Sales Order Item')
		)
		// a leading match beats the same letters buried mid-string
		expect(u.fuzzy_search('user', 'User')).toBeGreaterThan(
			u.fuzzy_search('user', 'Prepared Report User')
		)
	})

	it('returns 0 for a non-match', () => {
		expect(g.frappe.search.utils.fuzzy_search('zzz', 'Sales Order')).toBe(0)
	})

	it('wraps matched characters in <mark> when asked for a marked string', () => {
		const { marked_string, score } = g.frappe.search.utils.fuzzy_search('sa', 'Sales', true)
		expect(score).toBeGreaterThan(0)
		expect(marked_string).toContain('<mark>')
		// stripping the markup must give the original string back
		expect(marked_string.replace(/<\/?mark>/g, '')).toBe('Sales')
	})

	it('returns the unmarked item when nothing matched', () => {
		const res = g.frappe.search.utils.fuzzy_search('zzz', 'Sales', true)
		expect(res).toEqual({ score: 0, marked_string: 'Sales' })
	})
})

describe('get_doctypes', () => {
	beforeEach(() => {
		installFrappe({
			user: {
				recent: '[]',
				can_read: ['Sales Order', 'Secret Doctype'],
				can_search: ['Sales Order'],
				can_create: ['Sales Order'],
				all_reports: {},
			},
		})
	})

	it('emits a List option and a New option for a searchable, creatable doctype', () => {
		const out = g.frappe.search.utils.get_doctypes('sales order')
		const types = out.map((o: any) => o.type)
		expect(types).toContain('List')
		expect(types).toContain('New')
		const list = out.find((o: any) => o.type === 'List')
		expect(list.route).toEqual(['List', 'Sales Order'])
	})

	it('omits doctypes the user cannot search', () => {
		const out = g.frappe.search.utils.get_doctypes('secret')
		expect(out).toEqual([])
	})

	it('routes single doctypes to their form', () => {
		installFrappe({
			single_types: ['System Settings'],
			user: {
				recent: '[]',
				can_read: ['System Settings'],
				can_search: [],
				can_create: [],
				all_reports: {},
			},
		})
		const out = g.frappe.search.utils.get_doctypes('system settings')
		expect(out[0].route).toEqual(['Form', 'System Settings', 'System Settings'])
	})

	it('emits a Tree option for tree-view doctypes', () => {
		installFrappe({
			tree_view_doctypes: ['Item Group'],
			user: {
				recent: '[]',
				can_read: ['Item Group'],
				can_search: ['Item Group'],
				can_create: [],
				all_reports: {},
			},
		})
		const out = g.frappe.search.utils.get_doctypes('item group')
		const tree = out.find((o: any) => o.type === 'Tree')
		expect(tree.route).toEqual(['Tree', 'Item Group'])
	})
})

describe('get_creatables', () => {
	it('only fires on a leading "new" keyword', () => {
		installFrappe({
			user: {
				recent: '[]',
				can_read: [],
				can_search: [],
				can_create: ['Sales Order'],
				all_reports: {},
			},
		})
		const u = g.frappe.search.utils
		expect(u.get_creatables('sales order')).toEqual([])
		const out = u.get_creatables('new sales order')
		expect(out).toHaveLength(1)
		expect(out[0].type).toBe('New')
		expect(typeof out[0].onclick).toBe('function')
	})
})

describe('get_search_in_list', () => {
	it('builds a name-like filter from "<text> in <doctype>"', () => {
		installFrappe({
			user: {
				recent: '[]',
				can_read: ['Sales Order'],
				can_search: ['Sales Order'],
				can_create: [],
				all_reports: {},
			},
		})
		const out = g.frappe.search.utils.get_search_in_list('acme in sales order')
		expect(out).toHaveLength(1)
		expect(out[0].route).toEqual(['List', 'Sales Order'])
		expect(out[0].route_options).toEqual({ name: ['like', '%acme%'] })
	})

	it('stays quiet while the user is still typing the trailing "in"', () => {
		expect(g.frappe.search.utils.get_search_in_list('acme in')).toEqual([])
	})
})

describe('get_reports', () => {
	it('routes Report Builder reports through the list view and query reports directly', () => {
		installFrappe({
			user: {
				recent: '[]',
				can_read: [],
				can_search: [],
				can_create: [],
				all_reports: {
					'Sales Register': { report_type: 'Query Report' },
					'Item Shortage': { report_type: 'Report Builder', ref_doctype: 'Item' },
				},
			},
		})
		const u = g.frappe.search.utils
		expect(u.get_reports('sales register')[0].route).toEqual([
			'query-report',
			'Sales Register',
		])
		expect(u.get_reports('item shortage')[0].route).toEqual([
			'List',
			'Item',
			'Report',
			'Item Shortage',
		])
	})
})

describe('get_workspaces', () => {
	it('routes a workspace to the first linked item of its sidebar', () => {
		installFrappe({
			workspace_sidebar_item: {
				accounting: {
					label: 'Accounting',
					items: [{ link_type: 'DocType', link_to: 'Sales Invoice' }],
				},
			},
		})
		const out = g.frappe.search.utils.get_workspaces('accounting')
		expect(out).toHaveLength(1)
		expect(out[0].type).toBe('Workspace')
		expect(out[0].route).toEqual(['List', 'Sales Invoice'])
	})

	it('skips workspaces whose sidebar has nothing to link to', () => {
		installFrappe({
			workspace_sidebar_item: { empty: { label: 'Empty', items: [] } },
		})
		expect(g.frappe.search.utils.get_workspaces('empty')).toEqual([])
	})
})

describe('get_recent_pages', () => {
	it('turns route history into options and marks them recent', () => {
		const frappe = installFrappe()
		frappe.route_history = [['List', 'Sales Order']]
		const out = g.frappe.search.utils.get_recent_pages('sales')
		expect(out).toHaveLength(1)
		expect(out[0].recent).toBe(true)
		expect(out[0].route).toEqual(['List', 'Sales Order'])
	})

	it('drops entries registered in results_to_hide', () => {
		const frappe = installFrappe()
		frappe.route_history = [['List', 'Sales Order']]
		const u = g.frappe.search.utils
		// boot/pageview.ts pushes page names here for pages that opted out
		u.results_to_hide.push(u.get_recent_pages('sales')[0].value)
		expect(u.get_recent_pages('sales')).toEqual([])
		u.results_to_hide.length = 0
	})
})

describe('get_frequent_links', () => {
	it('falls back to recent pages when the user has no visit counts', () => {
		const frappe = installFrappe()
		frappe.route_history = [['List', 'Sales Order']]
		const out = g.frappe.search.utils.get_frequent_links()
		expect(out).toHaveLength(1)
		expect(out[0].recent).toBe(true)
	})

	it('ranks frequent links by visit count', () => {
		installFrappe({
			frequently_visited_links: [
				{ route: ['List', 'Item'], count: 3 },
				{ route: ['List', 'Sales Order'], count: 9 },
			],
		})
		const out = g.frappe.search.utils.get_frequent_links()
		expect(out.map((o: any) => o.index)).toEqual([3, 9])
	})
})

describe('make_function_searchable / get_executables', () => {
	it('matches on a label prefix and runs the registered function', () => {
		const u = g.frappe.search.utils
		let ran = 0
		u.searchable_functions.length = 0
		u.make_function_searchable(() => ran++, 'Toggle Theme')
		expect(u.get_executables('nope')).toEqual([])
		const out = u.get_executables('toggle')
		expect(out).toHaveLength(1)
		expect(out[0].type).toBe('Executable')
		out[0].onclick()
		expect(ran).toBe(1)
		u.searchable_functions.length = 0
	})

	it('rejects a non-function', () => {
		expect(() => g.frappe.search.utils.make_function_searchable('nope' as any)).toThrow()
	})
})

describe('highlight_global_search_terms', () => {
	it('marks each term and escapes the surrounding text', () => {
		const out = g.frappe.search.utils.highlight_global_search_terms(
			'<b>Acme</b> Corp',
			'Acme'
		)
		expect(out).toContain('<mark>Acme</mark>')
		expect(out).toContain('&lt;b&gt;')
	})
})

describe('parse_global_search_fields', () => {
	it('splits label : value segments and skips the synthetic name field', () => {
		const out = g.frappe.search.utils.parse_global_search_fields(
			'Customer : Acme ||| name : SO-0001 ||| Status &&& Draft'
		)
		expect(out).toEqual({ Customer: ['Acme'], Status: ['Draft'] })
	})
})
