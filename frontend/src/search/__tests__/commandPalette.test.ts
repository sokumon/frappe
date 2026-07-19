// Contract tests for the ⌘K palette store (search/commandPalette.ts): that a
// typed query actually produces grouped, ranked items out of frappe.search.utils.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// `frappe-ui/icons` pulls in browser-only sprite plumbing; the palette only uses
// Icon as a render target, so stub it.
vi.mock('frappe-ui/icons', () => ({ Icon: { name: 'Icon', render: () => null } }))

import { installSearch } from '../searchUtils'
import { buildGroups } from '../commandPalette'

const g: any = globalThis
const ItemStub = { name: 'ItemStub', render: () => null }

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
				can_read: ['Sales Order', 'Sales Invoice'],
				can_search: ['Sales Order', 'Sales Invoice'],
				can_create: ['Sales Order'],
				all_reports: {},
			},
			...boot,
		},
		route_history: [],
		route_titles: {},
		get_route: () => [],
		get_meta: () => undefined,
		utils: {
			escape_html: (t: any) => String(t),
			bold: (t: any) => `<strong>${t}</strong>`,
			get_route_label: (r: string[]) => r.join(' / '),
			parse_layout_condition_to_filters: () => ({}),
			eval_expression: () => undefined,
		},
		model: { can_get_report: () => false },
	}
	g.frappe = frappe
	;(window as any).frappe = frappe
	installSearch()
	return frappe
}

beforeEach(() => installFrappe())

describe('buildGroups', () => {
	it('returns ranked items for a typed query', () => {
		const groups = buildGroups('sales order', ItemStub as any)
		const items = groups.flatMap((gr) => gr.items)
		expect(items.length).toBeGreaterThan(0)
		expect(items.some((i) => i.option.route?.join('/') === 'List/Sales Order')).toBe(true)
	})

	it('marks the matched characters in each item label', () => {
		const groups = buildGroups('sales order', ItemStub as any)
		const item = groups.flatMap((gr) => gr.items).find((i) => i.option.type === 'List')
		expect(item?.html).toContain('<mark>')
	})

	it('groups New options under Create and navigation under Jump to', () => {
		const titles = buildGroups('sales order', ItemStub as any).map((gr) => gr.title)
		expect(titles).toContain('Jump to')
		expect(titles).toContain('Create')
	})

	it('ranks each group by index descending', () => {
		const groups = buildGroups('sales', ItemStub as any)
		for (const gr of groups) {
			const idx = gr.items.map((i) => i.option.index)
			expect(idx).toEqual([...idx].sort((a, b) => b - a))
		}
	})

	it('falls back to frequent links on an empty query', () => {
		installFrappe({
			frequently_visited_links: [{ route: ['List', 'Item'], count: 3 }],
		})
		const groups = buildGroups('', ItemStub as any)
		expect(groups.flatMap((gr) => gr.items)).toHaveLength(1)
	})

	it('yields nothing for a #tag query (tag_utils.js is not ported)', () => {
		expect(buildGroups('#urgent', ItemStub as any)).toEqual([])
	})

	// Regression: the palette used to sit on its empty-query results forever
	// because the query never reached the store (frappe-ui's <CommandPalette>
	// binds `v-model` to a headlessui ComboboxInput that emits only `change`),
	// so the Recent group never cleared. Typing must replace those results.
	it('replaces the empty-query results once a query is typed', () => {
		const frappe = installFrappe()
		frappe.route_history = [['List', 'Sales Invoice']]

		const idle = buildGroups('', ItemStub as any)
		expect(idle.map((gr) => gr.title)).toEqual(['Recent'])

		const typed = buildGroups('sales order', ItemStub as any)
		expect(typed.map((gr) => gr.title)).not.toEqual(['Recent'])
		expect(typed.flatMap((gr) => gr.items).some((i) => i.html.includes('<mark>'))).toBe(true)
	})
})
