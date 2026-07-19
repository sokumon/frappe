// search/searchUtils.ts
//
// frappe.search.utils — port of frappe/public/js/frappe/ui/toolbar/search_utils.js
// (a desk.bundle file that never loads in the Vue shell). It is the result
// engine behind the legacy Awesome Bar, and now behind the Vue command palette
// (search/commandPalette.ts + components/CommandPalette.vue).
//
// Kept API-compatible with the legacy module: every get_* method returns the
// same `{ type, label, value, index, route, route_options, onclick, ... }`
// option shape, so `label` still carries `<mark>` HTML from fuzzy_search and
// callers still rank by `index` descending. boot/pageview.ts already pushes
// into `results_to_hide`, and client scripts call `make_function_searchable`.
//
// Deviations from the legacy file, all forced by the Vue shell:
//   - jQuery helpers ($.isArray / $.isPlainObject / $.each) are replaced with
//     their native equivalents; nothing else about the control flow changed.
//   - get_workspaces() routed through `frappe.app.sidebar.open_workspace`, which
//     the Vue sidebar (composables/getSidebar.ts) does not implement. It now
//     routes to the workspace's first sidebar item instead — same landing spot,
//     via the real vue-router route.
//   - get_pages()' "Hub" entry is dropped (the Hub desk page is long gone).
import { fuzzy_match } from './fuzzyMatch'

declare const frappe: any
declare const __: (txt: string, args?: any[]) => string

export interface SearchOption {
	type?: string
	label: string
	value: string
	index: number
	description?: string
	match?: any
	route?: string[]
	route_options?: Record<string, any>
	recent?: boolean
	image?: string | null
	onclick?: (match?: any) => void
	_global_raw_content?: string
	_global_doctype?: string
}

export interface GlobalResultSet {
	title: string
	results: SearchOption[]
	fetch_type: string
}

const utils = {
	setup_recent: function () {
		this.recent = JSON.parse(frappe.boot.user.recent || '[]') || []
	},
	recent: [] as any[],
	results_to_hide: [] as string[],

	get_recent_pages: function (keywords: string | null): SearchOption[] {
		if (keywords === null) keywords = ''
		const me = this
		let values: any[] = []
		let options: SearchOption[] = []

		function find(list: any[], keywords: string, process: (match: any) => any) {
			list.forEach(function (item) {
				let _item = Array.isArray(item) ? item[0] : item
				_item = __(_item || '')
					.toLowerCase()
					.replace(/-/g, ' ')

				if (keywords === _item || _item.indexOf(keywords) !== -1) {
					let option = process(item)

					if (option) {
						if (!Array.isArray(option)) {
							option = [option]
						}
						option.forEach(function (o: SearchOption) {
							o.match = item
							o.recent = true
						})

						options = option.concat(options)
					}
				}
			})
		}

		me.recent.forEach(function (doctype: any) {
			values.push([doctype[1], ['Form', doctype[0], doctype[1]]])
		})

		values = values.reverse()

		;(frappe.route_history || []).forEach(function (route: string[]) {
			if (route[0] === 'Form') {
				values.push([route[2], route])
			} else if (
				['List', 'Tree', 'Workspaces', 'query-report'].includes(route[0]) ||
				route[2] === 'Report'
			) {
				if (route[1]) {
					values.push([route[1], route])
				}
			} else if (route[0]) {
				values.push([frappe.route_titles[route.join('/')] || route[0], route])
			}
		})

		find(values, keywords, function (match: any) {
			const route = match[1]
			const out: any = { route: route }

			if (route[0] === 'Form') {
				const doctype = route[1]
				if (route.length > 2 && doctype !== route[2]) {
					const docname = route[2]
					out.label = __(doctype) + ' ' + frappe.utils.bold(docname)
					out.value = __(doctype) + ' ' + docname
				} else {
					out.label = `<strong>${__(doctype)}</strong>`
					out.value = __(doctype)
				}
			} else if (
				['List', 'Tree', 'Workspaces', 'query-report'].includes(route[0]) &&
				route.length > 1
			) {
				const view_type = route[0]
				const view_name = route[1]

				let labelSuffix
				switch (view_type) {
					case 'List':
						labelSuffix = __('List')
						break
					case 'Tree':
						labelSuffix = __('Tree')
						break
					case 'Workspaces':
						labelSuffix = __('Workspace')
						break
					case 'query-report':
						labelSuffix = __('Report')
						break
				}

				out.label = `<strong>${__(view_name)}</strong> ${labelSuffix}`
				out.value = __(view_name) + ' ' + labelSuffix
			} else if (match[0]) {
				out.label = `<strong>${frappe.utils.escape_html(match[0])}</strong>`
				out.value = match[0]
			} else {
				console.log('Illegal match', match)
			}
			out.index = 80
			return out
		})
		this.hide_results(options)
		return options
	},

	hide_results(options: SearchOption[]) {
		if (this.results_to_hide.length == 0) return
		this.results_to_hide.forEach((v) => {
			options.forEach((o, j) => {
				if (o.value == v) {
					options.splice(j, 1)
				}
			})
		})
	},

	get_frequent_links(): SearchOption[] {
		const options: SearchOption[] = []
		;(frappe.boot.frequently_visited_links || []).forEach((link: any) => {
			const label = frappe.utils.get_route_label(link.route)
			options.push({
				route: link.route,
				label: label,
				value: label,
				index: link.count,
			})
		})
		if (!options.length) {
			return this.get_recent_pages('')
		}
		return options
	},

	get_search_in_list: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		if (keywords.split(' ').includes('in') && keywords.slice(-2) !== 'in') {
			const parts = keywords.split(' in ')
			frappe.boot.user.can_read.forEach(function (item: string) {
				if (frappe.boot.user.can_search.includes(item)) {
					const search_result = me.fuzzy_search(parts[1], item, true)
					if (search_result.score) {
						out.push({
							type: 'In List',
							label: __('Find {0} in {1}', [__(parts[0]), search_result.marked_string]),
							value: __('Find {0} in {1}', [__(parts[0]), __(item)]),
							route_options: { name: ['like', '%' + parts[0] + '%'] },
							index: 1 + search_result.score,
							route: ['List', item],
						})
					}
				}
			})
		}
		return out
	},

	get_creatables: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		const firstKeyword = keywords.split(' ')[0]
		if (firstKeyword.toLowerCase() === __('new')) {
			frappe.boot.user.can_create.forEach(function (item: string) {
				const search_result = me.fuzzy_search(keywords.substr(4), item, true)
				const level = search_result.score
				if (level) {
					out.push({
						type: 'New',
						label: __('New {0}', [search_result.marked_string || __(item)]),
						value: __('New {0}', [__(item)]),
						index: 1 + level,
						match: item,
						onclick: function () {
							frappe.new_doc(item, true)
						},
					})
				}
			})
		}
		return out
	},

	get_doctypes: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []

		let score: number, marked_string: string, target: string
		const option = function (type: string, route: string[], order: number): SearchOption {
			// check to skip extra list in the text
			// eg. Price List List should be only Price List
			const skip_list = type === 'List' && target.endsWith('List')
			let label
			if (skip_list) {
				label = marked_string || __(target)
			} else {
				label = __(`{0} ${skip_list ? '' : type}`, [marked_string || __(target)])
			}
			return {
				type: type,
				label: label,
				value: __(`{0} ${type}`, [target]),
				index: score + order,
				match: target,
				route: route,
			}
		}
		frappe.boot.user.can_read.forEach(function (item: string) {
			const search_result = me.fuzzy_search(keywords, item, true)
			;({ score, marked_string } = search_result)
			if (score) {
				target = item
				if (frappe.boot.single_types.includes(item)) {
					out.push(option('', ['Form', item, item], 0.05))
				} else if (frappe.boot.user.can_search.includes(item)) {
					// include 'making new' option
					if (frappe.boot.user.can_create.includes(item)) {
						const match = item
						out.push({
							type: 'New',
							label: __('New {0}', [search_result.marked_string || __(item)]),
							value: __('New {0}', [__(item)]),
							index: score + 0.015,
							match: item,
							onclick: function () {
								frappe.new_doc(match, true)
							},
						})
					}
					const isTree = (frappe.boot.tree_view_doctypes || []).includes(item)
					const option_data = option(
						isTree ? 'Tree' : 'List',
						isTree ? ['Tree', item] : ['List', item],
						0.05
					)
					out.push(option_data)
					if (frappe.model.can_get_report(item)) {
						out.push(option('Report', ['List', item, 'Report'], 0.04))
					}
				}
			}
		})
		return out
	},

	/**
	 * Matches DocType Layouts (by title, falling back to name) so they are
	 * navigable from the palette. Selecting one opens the base doctype's
	 * list filtered by the layout condition, with the layout context active.
	 */
	get_doctype_layouts: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		;(frappe.boot.doctype_layouts || []).forEach(function (layout: any) {
			if (!frappe.boot.user.can_read.includes(layout.document_type)) return

			const display = layout.title || layout.name
			const search_result = me.fuzzy_search(keywords, display, true)
			if (!search_result.score) return

			// Only `_layout` (consumed by the list view for the breadcrumb +
			// filter context) is set. Setting `layout` would make the router
			// write `?layout=` into the URL, which shadows route_options in
			// parse_filters_from_route_options and drops the condition filters.
			const route_options = Object.assign(
				frappe.utils.parse_layout_condition_to_filters(layout.condition),
				{ _layout: layout.name }
			)
			out.push({
				type: 'Layout',
				label: __('{0} List', [search_result.marked_string || display]),
				value: __('{0} List', [display]),
				description: __(layout.document_type),
				index: search_result.score,
				route: ['List', layout.document_type],
				route_options: route_options,
			})
		})
		return out
	},

	get_reports: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		let route
		Object.keys(frappe.boot.user.all_reports || {}).forEach(function (item) {
			const search_result = me.fuzzy_search(keywords, item, true)
			const level = search_result.score
			if (level > 0) {
				const report = frappe.boot.user.all_reports[item]
				if (report.report_type == 'Report Builder')
					route = ['List', report.ref_doctype, 'Report', item]
				else route = ['query-report', item]
				out.push({
					type: 'Report',
					label: __('Report {0}', [search_result.marked_string || __(item)]),
					value: __('Report {0}', [__(item)]),
					index: level,
					route: route,
				})
			}
		})
		return out
	},

	pages: {} as Record<string, any>,

	get_pages: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		this.pages = {}
		Object.entries(frappe.boot.page_info || {}).forEach(function ([name, p]: [string, any]) {
			me.pages[p.title] = p
			p.name = name
		})
		Object.keys(this.pages).forEach(function (item) {
			if (item == 'Hub' || item == 'hub') return
			const search_result = me.fuzzy_search(keywords, item, true)
			const level = search_result.score
			if (level) {
				const page = me.pages[item]
				out.push({
					type: 'Page',
					label: __('Open {0}', [search_result.marked_string || __(item)]),
					value: __('Open {0}', [__(item)]),
					match: item,
					index: level,
					route: [page.route || page.name],
				})
			}
		})
		const target = 'Calendar'
		if (__('calendar').indexOf(keywords.toLowerCase()) === 0) {
			out.push({
				type: 'Calendar',
				label: __('Open {0}', [__(target)]),
				value: __('Open {0}', [__(target)]),
				index: me.fuzzy_search(keywords, 'Calendar') as number,
				match: target,
				route: ['List', 'Event', target],
			})
		}
		if (__('email inbox').indexOf(keywords.toLowerCase()) === 0) {
			out.push({
				type: 'Inbox',
				label: __('Open {0}', [__('Email Inbox')]),
				value: __('Open {0}', [__('Email Inbox')]),
				index: me.fuzzy_search(keywords, 'email inbox') as number,
				match: 'Email Inbox',
				route: ['List', 'Communication', 'Inbox'],
			})
		}
		return out
	},

	/**
	 * Route for a workspace: its sidebar's first linked item. The legacy
	 * `frappe.app.sidebar.open_workspace(title)` doesn't exist on the Vue
	 * sidebar, so resolve the same landing spot as a router route here.
	 */
	workspace_route: function (data: any): string[] | undefined {
		const item = (data?.items || []).find((i: any) => i.link_to || i.url)
		if (!item) return undefined
		if (!item.link_to) return item.url ? [item.url] : undefined
		switch (item.link_type) {
			case 'Report':
				return ['query-report', item.link_to]
			case 'Dashboard':
				return ['dashboard-view', item.link_to]
			case 'DocType':
				return ['List', item.link_to]
			default:
				return ['Workspaces', item.link_to]
		}
	},

	get_workspaces: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		const sidebars = frappe.boot.workspace_sidebar_item || {}
		Object.keys(sidebars).forEach(function (key) {
			const title = sidebars[key].label || key
			const search_result = me.fuzzy_search(keywords, title, true)
			const level = search_result.score
			if (level > 0) {
				const route = me.workspace_route(sidebars[key])
				if (!route) return
				out.push({
					type: 'Workspace',
					label: __('Open {0} Workspace', [search_result.marked_string || __(title)]),
					value: __('Open {0} Workspace', [__(title)]),
					index: level,
					route: route,
				})
			}
		})
		return out
	},

	get_dashboards: function (keywords: string): SearchOption[] {
		const me = this
		const out: SearchOption[] = []
		;(frappe.boot.dashboards || []).forEach(function (item: any) {
			const search_result = me.fuzzy_search(keywords, item.name, true)
			const level = search_result.score
			if (level > 0) {
				out.push({
					type: 'Dashboard',
					label: __('{0} Dashboard', [search_result.marked_string || __(item.name)]),
					value: __('{0} Dashboard', [__(item.name)]),
					index: level,
					route: ['dashboard-view', item.name],
				})
			}
		})
		return out
	},

	get_global_results: function (
		keywords: string,
		start?: number,
		limit?: number,
		doctype = ''
	): Promise<GlobalResultSet[]> {
		const me = this
		function get_results_sets(data: any[]): GlobalResultSet[] {
			const results_sets: GlobalResultSet[] = []
			let result: SearchOption, set: GlobalResultSet | undefined

			function get_existing_set(doctype: string) {
				return results_sets.find(function (set) {
					return set.title === doctype
				})
			}

			function make_description(content: string, doc_name: string) {
				const parts = (content || '').split(' ||| ')
				const result_max_length = 300
				const field_length = 120
				const fields: string[] = []
				let result_current_length = 0
				let field_text = ''
				for (let i = 0; i < parts.length; i++) {
					const part = parts[i]
					if (part.toLowerCase().indexOf(keywords.toLowerCase()) !== -1) {
						// If the field contains the keyword
						let colon_index, field_value
						if (part.indexOf(' &&& ') !== -1) {
							colon_index = part.indexOf(' &&& ')
							field_value = part.slice(colon_index + 5)
						} else {
							colon_index = part.indexOf(' : ')
							field_value = part.slice(colon_index + 3)
						}
						if (field_value.length > field_length) {
							// If field value exceeds field_length, find the keyword in it
							// and trim field value by half the field_length at both sides
							// ellipsify if necessary
							let field_data = ''
							const index = field_value.indexOf(keywords)
							field_data +=
								index < field_length / 2
									? field_value.slice(0, index)
									: '...' + field_value.slice(index - field_length / 2, index)
							field_data += field_value.slice(index, index + field_length / 2)
							field_data += index + field_length / 2 < field_value.length ? '...' : ''
							field_value = field_data
						}
						const field_name = part.slice(0, colon_index)

						// Find remaining result_length and add field length to result_current_length
						let remaining_length = result_max_length - result_current_length
						result_current_length += field_name.length + field_value.length + 2
						const search_result_name = me.fuzzy_search(keywords, field_name, true)
						const search_result_value = me.fuzzy_search(keywords, field_value, true)
						if (result_current_length < result_max_length) {
							// We have room, push the entire field
							field_text =
								'<span class="field-name text-ink-gray-5">' +
								search_result_name.marked_string +
								': </span> ' +
								search_result_value.marked_string
							if (fields.indexOf(field_text) === -1 && doc_name !== field_value) {
								fields.push(field_text)
							}
						} else {
							// Not enough room
							if (field_name.length < remaining_length) {
								// Ellipsify (trim at word end) and push
								remaining_length -= field_name.length
								field_text =
									'<span class="field-name text-ink-gray-5">' +
									search_result_name.marked_string +
									': </span> '
								field_value = field_value.slice(0, remaining_length)
								field_value =
									field_value.slice(0, field_value.lastIndexOf(' ')) + ' ...'
								field_text += search_result_value.marked_string
								fields.push(field_text)
							} else {
								// No room for even the field name, skip
								fields.push('...')
							}
							break
						}
					}
				}
				return fields.join(', ')
			}

			data.forEach(function (d) {
				result = {
					label: d.title || d.name, // show title if exists
					value: d.name,
					index: 0,
					description: make_description(d.content, d.name),
					route: ['Form', d.doctype, d.name],
					_global_raw_content: d.content,
					_global_doctype: d.doctype,
				}
				if (d.image || d.image === null) {
					result.image = d.image
				}
				set = get_existing_set(d.doctype)
				if (set) {
					set.results.push(result)
				} else {
					set = {
						title: d.doctype,
						results: [result],
						fetch_type: 'Global',
					}
					results_sets.push(set)
				}
			})
			return results_sets
		}
		return new Promise(function (resolve) {
			const args: any = { text: keywords }
			if (doctype) {
				args.doctype = doctype
			}
			const offset = parseInt(String(start), 10) || 0
			if (offset > 0) {
				args.start = offset
				args.limit = parseInt(String(limit), 10)
				if (!args.limit || args.limit < 1) {
					args.limit = 20
				}
			}
			frappe.call({
				method: 'frappe.utils.global_search.search',
				args: args,
				callback: function (r: any) {
					resolve(r.message ? get_results_sets(r.message) : [])
				},
			})
		})
	},

	/**
	 * Parses `__global_search` content into { field label - value list }.
	 * Segments are separated by `|||`; each segment is `label : value` (or `label &&& value`).
	 * Skips blank parts and the synthetic `name` field.
	 */
	parse_global_search_fields: function (content: string): Record<string, string[]> {
		const fields: Record<string, string[]> = {}
		if (!content) return fields
		for (const raw of content.split('|||')) {
			const part = (raw || '').trim()
			if (!part.length) continue
			let sep = ' : '
			let idx = part.indexOf(sep)
			if (idx === -1) {
				sep = ' &&& '
				idx = part.indexOf(sep)
			}
			if (idx === -1) continue
			const label = part.slice(0, idx).trim()
			const value = part.slice(idx + sep.length).trim()
			if (!label.length || /^name$/i.test(label)) continue
			if (!fields[label]) fields[label] = []
			fields[label].push(value)
		}
		return fields
	},

	/**
	 * Picks table column names for Global Search hits: walks each hit's snippet text,
	 * finds every field label in that text, then returns each label once.
	 */
	global_search_field_columns_for_results: function (results: SearchOption[]): string[] {
		const cols: string[] = []
		const seen = Object.create(null)
		for (const r of results || []) {
			const fields = this.parse_global_search_fields(r._global_raw_content || '')
			for (const col of Object.keys(fields)) {
				if (!seen[col]) {
					seen[col] = 1
					cols.push(col)
				}
			}
		}
		return cols
	},

	/** Highlights search terms in text: wraps each term in `<mark>` tags. */
	highlight_global_search_terms: function (text: string, keywords: string): string {
		const s = text == null ? '' : String(text)
		const terms = keywords
			.split('&')
			.map((p) => p.trim())
			.filter(Boolean)
		if (!terms.length) return frappe.utils.escape_html(s)
		const escaped = terms.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		try {
			const re = new RegExp('(' + escaped.join('|') + ')', 'gi')
			return s
				.split(re)
				.map((part) => {
					const isMatch = part && terms.some((t) => part.toLowerCase() === t.toLowerCase())
					const esc = frappe.utils.escape_html(part)
					return isMatch ? '<mark>' + esc + '</mark>' : esc
				})
				.join('')
		} catch (e) {
			return frappe.utils.escape_html(s)
		}
	},

	fuzzy_search: function (keywords = '', _item = '', return_marked_string = false): any {
		let item = __(_item)

		let [, score, matches] = fuzzy_match(keywords, item)
		if (score == 0 && frappe.boot.lang !== 'en' && item != _item) {
			item = _item || ''
			;[, score, matches] = fuzzy_match(keywords, item)
		}

		if (!return_marked_string) {
			return score
		}
		if (score == 0) {
			return { score: score, marked_string: item }
		}

		// Create Boolean mask to mark matching indices in the item string
		const matchArray = Array(item.length).fill(0)
		matches.forEach((index) => (matchArray[index] = 1))

		let marked_string = ''
		let buffer = ''

		// Clear the buffer and return marked matches.
		const flushBuffer = () => {
			if (!buffer) return ''
			const temp = `<mark>${buffer}</mark>`
			buffer = ''
			return temp
		}

		matchArray.forEach((isMatch, index) => {
			if (isMatch) {
				buffer += item[index]
			} else {
				marked_string += flushBuffer()
				marked_string += item[index]
			}
		})
		marked_string += flushBuffer()

		return { score, marked_string }
	},

	/**
	 * @deprecated Use frappe.search.utils.fuzzy_search(subseq, str, true).marked_string instead.
	 */
	bolden_match_part: function (str: string, subseq: string) {
		return this.fuzzy_search(subseq, str, true).marked_string
	},

	get_executables(keywords: string): SearchOption[] {
		const results: SearchOption[] = []
		this.searchable_functions.forEach((item) => {
			const target = item.label.toLowerCase()
			const txt = keywords.toLowerCase()
			if (txt === target || target.indexOf(txt) === 0) {
				const search_result = this.fuzzy_search(txt, item.label, true)
				results.push({
					type: 'Executable',
					label: search_result.marked_string,
					value: item.label,
					index: search_result.score,
					match: item.label,
					onclick: () => item.action.apply(this, item.args),
				})
			}
		})
		return results
	},

	make_function_searchable(_function: (...a: any[]) => any, label: string | null = null, args: any = null) {
		if (typeof _function !== 'function') {
			throw new Error('First argument should be a function')
		}

		this.searchable_functions.push({
			label: label || _function.name,
			action: _function,
			args: args,
		})
	},

	searchable_functions: [] as Array<{ label: string; action: (...a: any[]) => any; args: any }>,
}

export type SearchUtils = typeof utils

/**
 * Publish `frappe.search.utils`. Reads frappe.boot at call time, so it must run
 * after the boot payload lands (frappeApp.load_bootinfo) — bootstrap() in
 * main.ts installs it there.
 */
export function installSearch() {
	frappe.provide('frappe.search')
	frappe.search.utils = utils
	try {
		utils.setup_recent()
	} catch (e) {
		// boot.user.recent can be absent/malformed on a fresh site
		utils.recent = []
	}
}

export default utils
