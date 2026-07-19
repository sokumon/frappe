// search/commandPalette.ts
//
// The ⌘K store: turns `frappe.search.utils` options (searchUtils.ts) into the
// group/item shape frappe-ui's <CommandPalette> renders, and owns the open +
// query state that <CommandPalette.vue> binds to.
//
// The composition mirrors the legacy awesomebar (awesome_bar.js build_options /
// deduplicate / add_defaults): same providers, same `index`-descending ranking,
// same de-dup by route. What changes is presentation — a flat Awesomplete list
// becomes typed groups, and the legacy "Search for {0}" row (which opened the
// separate `frappe.searchdialog` global-search modal, never ported to the Vue
// shell) is replaced by global-search hits fetched inline into a Documents
// group as you type.
import { markRaw, ref, shallowRef, h, type Component } from 'vue'
import { Icon } from 'frappe-ui/icons'
import type { GlobalResultSet, SearchOption } from './searchUtils'

declare const frappe: any
declare const __: (txt: string, args?: any[]) => string

export interface PaletteItem {
	name: string
	/** Plain text, used for the combobox value + a11y. */
	title: string
	/** `label` from the search option — may contain <mark>/<strong> markup. */
	html: string
	description?: string
	icon?: Component
	option: SearchOption
}

export interface PaletteGroup {
	title: string
	hideTitle?: boolean
	component: Component
	items: PaletteItem[]
}

export const open = ref(false)
export const query = ref('')

// Global-search hits for the query in `globalQuery`. Kept separate from the
// synchronous local options so a slow round-trip never blocks local matches.
const globalSets = shallowRef<GlobalResultSet[]>([])
const globalQuery = ref('')
export const globalLoading = ref(false)

const MAX_PER_GROUP = 8
const GLOBAL_SEARCH_MIN_CHARS = 3
const GLOBAL_SEARCH_DEBOUNCE_MS = 300

// ---------------------------------------------------------------------------
// icons
// ---------------------------------------------------------------------------

// Legacy option `type` -> lucide icon id. `''` is a Single doctype (get_doctypes
// pushes an empty type for those), so it gets the plain document icon.
const TYPE_ICONS: Record<string, string> = {
	'': 'file-text',
	New: 'plus',
	List: 'list',
	Tree: 'network',
	Report: 'chart-no-axes-column',
	Layout: 'layout-list',
	Page: 'file',
	Workspace: 'layout-grid',
	Dashboard: 'gauge',
	Calendar: 'calendar',
	Inbox: 'inbox',
	'In List': 'search',
	Executable: 'terminal',
	Calculator: 'calculator',
	Recent: 'clock',
	Document: 'file-text',
}

const iconCache = new Map<string, Component>()

function iconFor(name: string): Component {
	let cached = iconCache.get(name)
	if (!cached) {
		cached = markRaw((_props: any, ctx: { attrs: Record<string, unknown> }) =>
			h(Icon, { name, ...ctx.attrs })
		) as unknown as Component
		iconCache.set(name, cached)
	}
	return cached
}

// ---------------------------------------------------------------------------
// local options — awesome_bar.js build_options + add_defaults, verbatim ranking
// ---------------------------------------------------------------------------

function utils() {
	return frappe?.search?.utils
}

function buildOptions(txt: string): SearchOption[] {
	const u = utils()
	if (!u) return []

	// `#tag` search: frappe.tags.utils lives in the (unported) tag_utils.js, so
	// the tag branch of the legacy build_options simply yields nothing here.
	if (txt.charAt(0) === '#') return []

	const options: SearchOption[] = u
		.get_creatables(txt)
		.concat(
			u.get_search_in_list(txt),
			u.get_doctypes(txt),
			u.get_doctype_layouts(txt),
			u.get_reports(txt),
			u.get_pages(txt),
			u.get_workspaces(txt),
			u.get_dashboards(txt),
			u.get_recent_pages(txt || ''),
			u.get_executables(txt)
		)
		.concat(searchInCurrentList(txt), calculator(txt))

	return deduplicate(options).sort((a, b) => b.index - a.index)
}

/** awesome_bar.js deduplicate — collapses options that resolve to the same route. */
function deduplicate(options: SearchOption[]): SearchOption[] {
	const out: SearchOption[] = []
	const routes: string[] = []
	options.forEach(function (option) {
		if (option.route) {
			if (
				option.route[0] === 'List' &&
				option.route[2] !== 'Report' &&
				option.route[2] !== 'Inbox'
			) {
				option.route.splice(2)
			}

			const str_route =
				typeof option.route === 'string' ? option.route : option.route.join('/')
			if (option.description || routes.indexOf(str_route) === -1) {
				out.push(option)
				routes.push(str_route)
			} else {
				const old = routes.indexOf(str_route)
				if (out[old].index < option.index && !option.recent) {
					out[old] = option
				}
			}
		} else {
			out.push(option)
			routes.push('')
		}
	})
	return out
}

/**
 * awesome_bar.js make_search_in_current — "Find {txt} in {current list}".
 * The legacy version read `frappe.container.page.list_view.doctype`; the Vue
 * shell has no page container, so the doctype comes off the route instead.
 */
function searchInCurrentList(txt: string): SearchOption[] {
	if (!txt) return []
	const route = frappe.get_route?.() || []
	if (route[0] !== 'List' || txt.indexOf(' in') !== -1) return []
	const doctype = route[1]
	if (!doctype) return []
	const meta = frappe.get_meta?.(doctype)
	if (!meta) return []
	const search_field = meta.title_field || 'name'
	const route_options: Record<string, any> = {}
	route_options[search_field] = ['like', '%' + txt + '%']
	return [
		{
			type: 'In List',
			label: __('Find {0} in {1}', [
				`<strong>${frappe.utils.escape_html(txt)}</strong>`,
				`<strong>${__(doctype)}</strong>`,
			]),
			value: __('Find {0} in {1}', [txt, __(doctype)]),
			route: ['List', doctype],
			route_options,
			index: 90,
			match: txt,
		},
	]
}

/** awesome_bar.js make_calculator — `=1+1` / `1+1` evaluates inline. */
function calculator(txt: string): SearchOption[] {
	const first = txt.substr(0, 1)
	if (!(first == String(parseInt(first)) || first === '(' || first === '=')) return []

	const w = window as any
	if (typeof w.format_number !== 'function' || !frappe.utils?.eval_expression) return []

	let expr = first === '=' ? txt.substr(1) : txt
	try {
		const decimalStr = w.get_number_format_info?.()?.decimal_str ?? '.'
		// Split the input to find the numbers and their decimal places
		const numbers = expr.match(/[+-]?([0-9]*[.,])?[0-9]+/g)
		let maxDecimalPlaces = 0
		if (numbers) {
			maxDecimalPlaces = Math.max(
				...numbers.map((num: string) => num.split(decimalStr)[1]?.length || 0)
			)
		}

		// Find the result to the appropriate number of decimal places
		const val = frappe.utils.eval_expression(expr)
		if (val === undefined || val === null || Number.isNaN(val)) return []
		const result = w.format_number(val, null, maxDecimalPlaces)
		const formatted = __('{0} = {1}', [
			frappe.utils.escape_html(expr),
			`<strong>${result}</strong>`,
		])
		return [
			{
				type: 'Calculator',
				label: formatted,
				value: __('{0} = {1}', [expr, result]),
				match: result,
				index: 95,
				onclick: function () {
					navigator.clipboard?.writeText?.(String(result))
					frappe.show_alert?.({ message: __('Copied {0}', [result]), indicator: 'green' })
				},
			},
		]
	} catch (e) {
		return []
	}
}

// ---------------------------------------------------------------------------
// global search (async)
// ---------------------------------------------------------------------------

let globalTimer: ReturnType<typeof setTimeout> | undefined
// Only the newest request may write into `globalSets` — an earlier, slower
// round-trip must not overwrite results for a query the user has moved past.
let globalToken = 0

export function requestGlobalSearch(txt: string) {
	clearTimeout(globalTimer)
	const keywords = (txt || '').trim()
	if (keywords.length < GLOBAL_SEARCH_MIN_CHARS || keywords.charAt(0) === '#') {
		globalToken++
		globalSets.value = []
		globalQuery.value = ''
		globalLoading.value = false
		return
	}
	globalLoading.value = true
	globalTimer = setTimeout(() => {
		const token = ++globalToken
		utils()
			?.get_global_results(keywords)
			.then((sets: GlobalResultSet[]) => {
				if (token !== globalToken) return
				globalSets.value = sets || []
				globalQuery.value = keywords
				globalLoading.value = false
			})
			.catch(() => {
				if (token !== globalToken) return
				globalSets.value = []
				globalLoading.value = false
			})
	}, GLOBAL_SEARCH_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

// Group titles in display order. Everything navigational lands in "Jump to";
// only the buckets below are pulled out ahead of it.
function groupTitleFor(option: SearchOption): string {
	if (option.type === 'New') return __('Create')
	if (option.type === 'Executable' || option.type === 'In List' || option.type === 'Calculator')
		return __('Actions')
	if (option.recent) return __('Recent')
	return __('Jump to')
}

const GROUP_ORDER = ['Actions', 'Create', 'Jump to', 'Recent', 'Documents']

function toItem(option: SearchOption, key: string): PaletteItem {
	return {
		name: key,
		title: option.value,
		html: option.label,
		description: option.description,
		icon: iconFor(
			TYPE_ICONS[option.recent && !option.type ? 'Recent' : (option.type ?? '')] ?? 'file-text'
		),
		option,
	}
}

/**
 * Build the groups for the current query. `itemComponent` is the renderer
 * frappe-ui mounts per row (passed in by CommandPalette.vue so this module
 * stays free of .vue imports).
 */
export function buildGroups(txt: string, itemComponent: Component): PaletteGroup[] {
	const u = utils()
	if (!u) return []
	const keywords = (txt || '').trim()

	// Empty query: the legacy awesomebar seeded the dropdown with the user's
	// most-visited routes (get_frequent_links, itself falling back to recents).
	const options = keywords ? buildOptions(keywords) : u.get_frequent_links()

	const buckets = new Map<string, PaletteItem[]>()
	options.forEach((option: SearchOption, i: number) => {
		const title = keywords ? groupTitleFor(option) : __('Recent')
		if (!buckets.has(title)) buckets.set(title, [])
		const items = buckets.get(title)!
		if (items.length >= MAX_PER_GROUP) return
		items.push(toItem(option, `local-${i}`))
	})

	// Global search hits, flattened into one Documents group with the source
	// doctype as the row description. Only shown while they match the query the
	// user is still typing, so stale hits never linger under a new search.
	if (keywords && globalQuery.value === keywords) {
		const docs: PaletteItem[] = []
		for (const set of globalSets.value) {
			for (const result of set.results) {
				if (docs.length >= MAX_PER_GROUP) break
				docs.push({
					name: `global-${set.title}-${result.value}`,
					title: result.value,
					html: u.highlight_global_search_terms(result.label, keywords),
					description: __(set.title),
					icon: iconFor(TYPE_ICONS.Document),
					option: result,
				})
			}
		}
		if (docs.length) buckets.set(__('Documents'), docs)
	}

	return GROUP_ORDER.filter((title) => buckets.get(__(title))?.length).map((title) => ({
		title: __(title),
		component: itemComponent,
		items: buckets.get(__(title))!,
	}))
}

// ---------------------------------------------------------------------------
// selection — awesome_bar.js "awesomplete-select" handler
// ---------------------------------------------------------------------------

export function selectItem(item: PaletteItem | null | undefined) {
	const option = item?.option
	if (!option) return

	if (option.route_options) {
		frappe.route_options = option.route_options
	}

	if (option.onclick) {
		option.onclick(option.match)
	} else if (option.route) {
		if (typeof option.route[0] === 'string' && option.route[0].startsWith('https://')) {
			window.open(option.route[0], '_blank')
		} else {
			frappe.set_route(option.route)
		}
	}

	query.value = ''
	open.value = false
}

// ---------------------------------------------------------------------------
// open/close
// ---------------------------------------------------------------------------

export function openCommandPalette() {
	query.value = ''
	open.value = true
}

export function closeCommandPalette() {
	open.value = false
}

/**
 * Publish the legacy entry points boot/keys.ts already dispatches ⌘K / ⌘G to
 * (`frappe.search.open_awesomebar_from_global_search_shortcut` and
 * `..._global_search_from_navbar_shortcut`), so both shortcuts land on the
 * palette and keep their rows in the keyboard-shortcuts modal.
 *
 * boot/keys.ts is the only ⌘K listener — components/CommandPalette.vue is built
 * on frappe-ui's <Dialog> rather than its <CommandPalette> (which binds a
 * competing window listener of its own), so ⌘K can toggle the way the legacy
 * awesomebar did instead of only ever opening.
 */
export function installCommandPaletteShortcuts() {
	frappe.provide('frappe.search')
	const toggle = function (e?: Event) {
		e?.preventDefault()
		if (open.value) closeCommandPalette()
		else openCommandPalette()
		return false
	}
	frappe.search.open_awesomebar_from_global_search_shortcut = toggle
	frappe.search.open_global_search_from_navbar_shortcut = toggle
}
