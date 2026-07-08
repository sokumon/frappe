// useListBridge.ts
//
// Bridges the legacy per-doctype `frappe.listview_settings[doctype]` onto the Vue
// `@framework/ui` ListView (the controlled, meta-driven controls + `useListView`
// state). The ui controls know nothing about listview_settings; this layer makes
// the old client-side list customizations "just work" on the new stack:
//
//   Declarative hooks (mapped onto the controls / cell rendering):
//     add_fields · filters (defaults) · formatters · get_indicator (via
//     frappe.get_indicator) · get_form_link · hide_name_column · button ·
//     primary_action
//   Imperative hook (the maximal shim):
//     onload(listview) — apps call arbitrary methods on a legacy `listview`
//     object. We hand them a shim whose `.page` IS the PageShell page bridge
//     (so page.add_inner_button / set_primary_action / add_menu_item render on
//     the real Navbar for free) plus the common list methods (get_checked_items,
//     refresh, filter_area, call_for_selected_items, data, add_field, …). Unknown
//     calls are best-effort (onload runs in a try/catch), matching the chosen
//     "Vue for everything" policy.
//
// `frappe.listview_settings[doctype]` is populated by the doctype's `*_list.js`,
// which `frappe.model.with_doctype` evaluates (model.js init_doctype → __list_js),
// so the bridge awaits that before reading settings.
import { computed, reactive, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { createListResource, createResource } from 'frappe-ui'
import { parseFilters, getFilterableFields } from '@framework/ui/Filter'
import type { UseListView } from '@framework/ui/ListView'

declare const frappe: any
const jq = (window as any).$ || (window as any).jQuery

/** A rendered cell: raw HTML (standard formatting or a settings.formatter). */
interface HtmlCell {
	__html: string
}
/** One display row: `name` for row-key, the raw doc under `__doc`, plus per-column
 *  rendered values (HtmlCell) and the synthetic indicator/button cells. */
type DisplayRow = Record<string, any> & { name: string; __doc: Record<string, any> }

export interface ListBridge {
	/** listview_settings loaded (meta + __list_js evaluated). */
	ready: Ref<boolean>
	/** The raw `frappe.listview_settings[doctype]` object (reactive; `{}` until loaded). */
	settings: Ref<any>
	/** Columns to render: the view's wire columns, minus the name column when
	 *  `hide_name_column`, plus synthetic `_indicator` / `_button` columns. */
	wireColumns: ComputedRef<any[]>
	/** Rows for the frappe-ui ListView: formatted cells + indicator/button cells. */
	displayRows: ComputedRef<DisplayRow[]>
	loading: ComputedRef<boolean>
	rowCount: ComputedRef<number>
	totalCount: ComputedRef<number>
	pageLength: Ref<number>
	loadMore: () => void
	reload: () => void
	/** Per-row action button config from settings.button (or null). */
	button: ComputedRef<any>
	/** Map a display row to its form route (honors settings.get_form_link). */
	rowRoute: (row: DisplayRow) => string
	/** Record the ListView's selection Set (row objects and/or names). */
	setSelections: (s: Set<any>) => void
	/** The legacy-shaped `listview` object passed to settings.onload etc. */
	shim: any
	/** Run settings.onload(shim) once the page bridge exists (try/catch, best-effort). */
	runOnload: () => void
	/** Wire the Navbar primary action ("Add {Doctype}", or settings.primary_action). */
	setupPrimaryAction: () => void
}

export function useListBridge(
	doctype: string,
	view: UseListView,
	options: { getPage: () => any }
): ListBridge {
	const ready = ref(false)
	const settings = ref<any>({})
	const pageLength = ref(20)
	const extraFields = ref<Set<string>>(new Set()) // grown by shim.add_field()
	let selections = new Set<any>()
	let defaultFiltersSeeded = false

	// Meta lookups (populated once meta is in locals via with_doctype).
	const fieldByName: Record<string, any> = {}
	let workflowField: string | undefined
	let titleField: string | undefined

	function indexMeta() {
		const meta = frappe.get_meta(doctype)
		if (!meta) return
		for (const df of meta.fields || []) fieldByName[df.fieldname] = df
		titleField = meta.title_field || undefined
		workflowField = frappe.workflow?.get_state_fieldname?.(doctype) || undefined
	}

	// --- Data layer (own fetch: folds in add_fields + formatter/indicator deps) ---
	const fetchFields = computed<string[]>(() => {
		const s = new Set<string>(['name', 'docstatus'])
		for (const col of view.columns.wire.value) if (fieldByName[col.key]) s.add(col.key)
		for (const f of settings.value?.add_fields || []) if (typeof f === 'string') s.add(f)
		for (const k of Object.keys(settings.value?.formatters || {})) if (fieldByName[k]) s.add(k)
		if (workflowField) s.add(workflowField)
		if (titleField) s.add(titleField)
		if (fieldByName['status']) s.add('status')
		for (const f of extraFields.value) s.add(f)
		return [...s]
	})

	const list = createListResource({
		doctype,
		fields: fetchFields.value,
		filters: view.filters.wire.value,
		orderBy: view.sort.orderBy.value || undefined,
		pageLength: pageLength.value,
	})
	// createListResource tracks no total; a sibling count backs the footer's "of N".
	const count = createResource({
		url: 'frappe.client.get_count',
		makeParams: () => ({ doctype, filters: view.filters.wire.value }),
	})

	function reload() {
		if (!ready.value) return
		try {
			settings.value?.before_render?.()
		} catch (e) {
			console.warn(`[listview ${doctype}] before_render failed`, e)
		}
		list.update({
			fields: fetchFields.value,
			filters: view.filters.wire.value,
			orderBy: view.sort.orderBy.value || undefined,
			pageLength: pageLength.value,
			start: 0,
		})
		list.list.fetch()
		count.fetch()
		try {
			settings.value?.refresh?.(shim)
		} catch (e) {
			console.warn(`[listview ${doctype}] refresh() failed`, e)
		}
	}

	// One watcher drives every fetch but loadMore (wire filters, order_by, fields,
	// page length). Not `immediate`: the initial fetch fires from `load()` once
	// settings + meta are ready.
	watch(
		[() => view.filters.wire.value, () => view.sort.orderBy.value, fetchFields, pageLength],
		reload
	)

	const rows = computed<Record<string, any>[]>(
		() => (list.data as Record<string, any>[]) ?? []
	)

	// --- Cell rendering ---------------------------------------------------------
	function cellHtml(doc: Record<string, any>, key: string): string {
		const df = fieldByName[key] || { fieldtype: 'Data', fieldname: key }
		const value = doc[key]
		const fmt = settings.value?.formatters?.[key]
		if (fmt) {
			try {
				return fmt(value, df, doc)
			} catch (e) {
				console.warn(`[listview ${doctype}] formatter ${key} failed`, e)
			}
		}
		try {
			// frappe.format renders links/dates/currency as the desk list does.
			return frappe.format(value, df, { inline: true }, doc)
		} catch {
			return value == null ? '' : frappe.utils.escape_html(String(value))
		}
	}

	// Status pill via frappe.get_indicator (which itself applies settings.get_indicator).
	function indicatorFor(doc: Record<string, any>): [string, string] | null {
		try {
			const ind = frappe.get_indicator(doc, doctype)
			return ind ? [ind[0], ind[1]] : null
		} catch {
			return null
		}
	}

	const button = computed(() => settings.value?.button ?? null)

	// Columns: view's wire columns (drop name when hide_name_column) + the synthetic
	// indicator and a trailing button column the host draws. The indicator follows
	// the doctype's natural column order — it replaces the `status` field column
	// where one exists (subsumes it), else sits right after the title column
	// (after-title) — rather than being forced first.
	const wireColumns = computed<any[]>(() => {
		const hideName = !!settings.value?.hide_name_column
		const cols: any[] = view.columns.wire.value.filter(
			(c: any) => !(hideName && c.key === 'name')
		)
		// Indicator column only when the doctype actually yields an indicator
		// (submittable, has a status/workflow field, or a settings.get_indicator).
		if (hasIndicator.value) {
			const indicatorCol = { key: '_indicator', label: __('Status'), width: '9rem', type: 'Status' }
			const statusIdx = cols.findIndex((c: any) => c.key === 'status')
			if (statusIdx !== -1) {
				cols.splice(statusIdx, 1, indicatorCol) // subsume the raw status column
			} else {
				cols.splice(Math.min(1, cols.length), 0, indicatorCol) // after the title column
			}
		}
		if (button.value) {
			cols.push({ key: '_button', label: '', width: '7rem', align: 'right' })
		}
		return cols
	})

	// Whether to show the indicator column at all (cheap heuristic, evaluated once meta loads).
	const hasIndicator = computed(() => {
		if (!ready.value) return false
		if (settings.value?.get_indicator) return true
		if (workflowField) return true
		if (frappe.model.is_submittable(doctype)) return true
		return !!fieldByName['status']
	})

	const displayRows = computed<DisplayRow[]>(() =>
		rows.value.map((doc) => {
			const d: DisplayRow = { name: doc.name, __doc: doc }
			for (const col of wireColumns.value) {
				if (col.key === '_indicator') {
					d._indicator = indicatorFor(doc)
				} else if (col.key === '_button') {
					d._button = doc // the button cell needs the doc for show/label/action
				} else {
					d[col.key] = { __html: cellHtml(doc, col.key) } as HtmlCell
				}
			}
			return d
		})
	)

	// --- Navigation -------------------------------------------------------------
	function rowRoute(row: DisplayRow): string {
		const doc = row.__doc ?? row
		if (settings.value?.get_form_link) {
			try {
				const link = settings.value.get_form_link(doc)
				// Legacy returns a desk path ("/app/<dt>/<name>"); this SPA's router is
				// based at APP_PREFIX with base-relative paths, so strip the /app (or
				// /newdesk) prefix. Non-string routes (location objects) pass through.
				return typeof link === 'string'
					? link.replace(/^\/app(?=\/)/, '').replace(/^\/newdesk(?=\/)/, '')
					: link
			} catch (e) {
				console.warn(`[listview ${doctype}] get_form_link failed`, e)
			}
		}
		// Base-relative form route ("/<slug>/<name>"); the router base adds APP_PREFIX.
		const slug = frappe.router.slug(frappe.router.doctype_layout || doctype)
		return `/${slug}/${encodeURIComponent(doc.name)}`
	}

	// --- Selection --------------------------------------------------------------
	function setSelections(s: Set<any>) {
		selections = s
	}
	// Resolve the selection Set (row objects and/or name strings) to docs or names.
	function getCheckedItems(onlyDocnames = false): any[] {
		const docs = [...selections].map((x) => {
			if (x && typeof x === 'object') return x.__doc ?? x
			return rows.value.find((r) => r.name === x)
		})
		const clean = docs.filter(Boolean)
		return onlyDocnames ? clean.map((d) => d!.name) : clean
	}

	// --- The maximal `listview` shim -------------------------------------------
	// `.page` is the real PageShell bridge page, so page.* onload calls render on
	// the Navbar. The list-specific methods bridge to the Vue state.
	const $detached = jq ? jq('<div>') : undefined
	const shim: any = {
		doctype,
		get meta() {
			return frappe.get_meta(doctype)
		},
		get settings() {
			return settings.value
		},
		get page() {
			return options.getPage()
		},
		// Live rows (raw docs), as legacy code reads `listview.data`.
		get data() {
			return rows.value
		},
		get_meta: () => frappe.get_meta(doctype),
		get_checked_items: (onlyDocnames = false) => getCheckedItems(onlyDocnames),
		refresh: () => reload(),
		render: () => {},
		before_refresh: () => {},
		get_form_link: (doc: any) => rowRoute({ name: doc.name, __doc: doc } as DisplayRow),
		// Ensure a field is fetched (settings/onload sometimes need extra data).
		add_field: (fieldname: string) => {
			if (fieldname && !extraFields.value.has(fieldname)) {
				extraFields.value = new Set(extraFields.value).add(fieldname)
			}
		},
		// Filter area: bridge onto the shared filter conditions.
		filter_area: {
			add: (filters: any[]) => {
				const fields = getFilterableFields(frappe.get_meta(doctype)?.fields ?? [], doctype)
				const wire = normalizeFilters(filters)
				const parsed = parseFilters(fields as any, wire as any)
				view.filters.conditions.value = [...view.filters.conditions.value, ...parsed]
			},
			clear: () => {
				view.filters.conditions.value = []
			},
			get: () => view.filters.wire.value,
			remove: (fieldname: string) => {
				view.filters.conditions.value = view.filters.conditions.value.filter(
					(c: any) => c.fieldname !== fieldname
				)
			},
		},
		// Run a whitelisted method over the checked docnames, then refresh (legacy shape).
		call_for_selected_items: (method: string, args: Record<string, any> = {}) => {
			args.names = getCheckedItems(true)
			return frappe.call({ method, args }).then((r: any) => {
				reload()
				return r
			})
		},
		// jQuery handles some onload code pokes; hand back detached nodes so
		// `.find()`/`.on()`/`.append()` don't throw (best-effort, "Vue for everything").
		$result: $detached,
		$page: $detached,
		$frappe_list: $detached,
		start: 0,
		get page_length() {
			return pageLength.value
		},
	}

	function runOnload() {
		if (typeof settings.value?.onload === 'function') {
			try {
				settings.value.onload(shim)
			} catch (e) {
				console.warn(`[listview ${doctype}] onload failed (best-effort)`, e)
			}
		}
	}

	// --- Primary action (Add) ---------------------------------------------------
	function setupPrimaryAction() {
		const page = options.getPage()
		if (!page) return
		page.set_primary_action(
			__('Add {0}', [__(frappe.router.doctype_layout || doctype)]),
			() => {
				if (typeof settings.value?.primary_action === 'function') {
					settings.value.primary_action()
				} else {
					frappe.new_doc(doctype)
				}
			},
			'add'
		)
	}

	// --- Load (await meta + __list_js, seed defaults, first fetch) ---------------
	frappe.model.with_doctype(doctype, () => {
		indexMeta()
		settings.value = frappe.listview_settings[doctype] || {}

		// Seed default filters (settings.filters) into the shared filter state once,
		// so they show as (editable) conditions and drive the fetch.
		if (!defaultFiltersSeeded && settings.value.filters?.length) {
			try {
				const fields = getFilterableFields(frappe.get_meta(doctype)?.fields ?? [], doctype)
				const parsed = parseFilters(fields as any, normalizeFilters(settings.value.filters) as any)
				if (parsed.length) view.filters.conditions.value = parsed
			} catch (e) {
				console.warn(`[listview ${doctype}] default filters parse failed`, e)
			}
		}
		defaultFiltersSeeded = true
		ready.value = true
		reload()
	})

	return {
		ready,
		settings,
		wireColumns,
		displayRows,
		loading: computed(() => Boolean(list.list.loading)),
		rowCount: computed(() => rows.value.length),
		totalCount: computed(() => (count.data as number) ?? 0),
		pageLength,
		loadMore: () => list.next(),
		reload,
		button,
		rowRoute,
		setSelections,
		shim,
		runOnload,
		setupPrimaryAction,
	}
}

// A frappe global for gettext.
declare const __: (msg: string, args?: any[]) => string

// Normalize the many settings.filters / filter_area.add shapes to the wire form
// parseFilters expects: [[fieldname, operator, value], …] (doctype prefix dropped).
function normalizeFilters(filters: any): any[] {
	if (!Array.isArray(filters)) {
		// object form { fieldname: value }
		return Object.entries(filters || {}).map(([fieldname, value]) => [fieldname, '=', value])
	}
	return filters
		.map((f: any) => {
			if (!Array.isArray(f)) return null
			if (f.length === 4) return [f[1], f[2], f[3]] // [doctype, fieldname, op, value]
			if (f.length === 3) return f // [fieldname, op, value]
			if (f.length === 2) return [f[0], '=', f[1]] // [fieldname, value]
			return null
		})
		.filter(Boolean)
}
