// getBreadcrumbs.ts
//
// Vue port of `frappe/public/js/frappe/views/breadcrumbs.js`. The legacy module
// builds the navbar breadcrumbs as jQuery `<li>` DOM inside `.navbar-breadcrumbs`
// and is exposed globally as `frappe.breadcrumbs`. Here we keep the same public
// method surface (`add` / `update` / `current_page` / `rename` / `clear` /
// `set_doctype_module` / …) but each call mutates a single reactive `items`
// array of frappe-ui `BreadcrumbItem`s instead of touching the DOM. <Navbar>
// renders that array through frappe-ui's `<Breadcrumbs>`.
//
// Two integration points changed from the legacy desk:
//   - routes are vue-router paths (built with `frappe.router.slug`), not the
//     `/desk/...` URLs the legacy code emitted, and
//   - the leading "workspace" crumb is read from the already-resolved
//     `frappe.app.sidebar` (getSidebar.ts) instead of the old Sidebar class's
//     `sidebar_title` + desktop-icon helpers.
//
// Because the legacy `frappe.breadcrumbs.add(...)` calls are gated behind
// `frappe.vue_shell` for some views (notably the form), `update()` also
// AUTO-DERIVES a `{ doctype, module }` crumb from the current route for the
// standard doctype views. So breadcrumbs render from the router alone; the
// surviving `.add(...)` calls (workspace / file / page / list) just supplement
// or override that.

import { h, markRaw, reactive, watch, type Component } from 'vue'
import { FeatherIcon } from 'frappe-ui'
import { useWorkspaceSidebar } from '@/composables/getSidebar'

// frappe-ui's BreadcrumbItem (see Breadcrumbs/types.ts). `route` -> router-link,
// `onClick`/`href` cover non-router items; `icon` is rendered by <Navbar>'s
// `#prefix` slot. Kept local so this module doesn't depend on frappe-ui's types.
interface BreadcrumbItem {
	label: string
	route?: any
	href?: string
	onClick?: () => void
	icon?: Component
	[key: string]: any
}

// A crumb registered via `add()` (or auto-derived). Mirrors the legacy
// `frappe.breadcrumbs.all[route]` object.
interface Crumb {
	type?: string
	module?: string
	doctype?: string
	label?: string
	route?: string
	layout_name?: string | null
	[key: string]: any
}

// ---------------------------------------------------------------------------
// legacy lookup tables (verbatim from breadcrumbs.js)
// ---------------------------------------------------------------------------

const PREFERRED: Record<string, string> = {
	File: '',
	Dashboard: 'Customization',
	'Dashboard Chart': 'Customization',
	'Dashboard Chart Source': 'Customization',
}

const MODULE_MAP: Record<string, string> = {
	Core: 'Settings',
	Email: 'Settings',
	Custom: 'Settings',
	Workflow: 'Settings',
	Printing: 'Settings',
	Setup: 'Settings',
	Automation: 'Tools',
}

// The standard doctype views update() knows how to render (lower-cased route[0]).
const DOCTYPE_VIEWS = ['form', 'print', 'list', 'tree', 'report', 'dashboard-view']

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function translate(text: string, replace?: any, context?: any): string {
	const fn = (window as any).__ as ((...a: any[]) => string) | undefined
	return fn ? fn(text, replace, context) : text
}

function stripHtml(text: string): string {
	if (frappe?.utils?.strip_html) return frappe.utils.strip_html(text)
	return String(text ?? '').replace(/<[^>]*>/g, '')
}

function slug(name: string): string {
	return frappe?.router?.slug ? frappe.router.slug(name) : name.toLowerCase().replace(/ /g, '-')
}

function currentRoute(): any[] {
	return (frappe?.get_route?.() as any[]) || []
}

// The home crumb's icon. A tiny functional wrapper so <Navbar>'s
// `<component :is="item.icon" class="size-4" />` can mount it and forward the
// sizing class; markRaw keeps Vue from making the component reactive.
const HOME_ICON = markRaw(
	(_props: Record<string, unknown>, ctx: { attrs: Record<string, unknown> }) =>
		h(FeatherIcon, { name: 'home', ...ctx.attrs }),
) as unknown as Component

// "/" is the home route under the app's router base (mirrors legacy "/desk").
function homeCrumb(): BreadcrumbItem {
	return { label: '', route: '/', icon: HOME_ICON }
}

// ---------------------------------------------------------------------------
// per-view crumb builders (ports of breadcrumbs.js set_*_breadcrumb)
// ---------------------------------------------------------------------------

// The resolved workspace sidebar (getSidebar singleton), captured on install so
// pushWorkspaceCrumb can read its reactive `name` and the watch below can track
// it. Same object as frappe.app.sidebar.
let sidebarState: { name: string } | null = null

// Leading workspace crumb. Legacy walked module/preferred history to pick a
// workspace; in the vue shell getSidebar already resolves the workspace for the
// current route, so we just reuse its name (and only link when it maps to a
// real workspace route).
function pushWorkspaceCrumb(list: BreadcrumbItem[]) {
	const name = sidebarState?.name
	if (!name) return
	const wsSlug = slug(name)
	if (!frappe?.workspaces?.[wsSlug]) return
	list.push({ label: translate(name), route: `/${wsSlug}` })
}

// breadcrumbs.js set_list_breadcrumb
function pushListCrumb(list: BreadcrumbItem[], crumb: Crumb) {
	const doctype = crumb.doctype as string
	const meta = frappe?.get_meta?.(doctype)

	const isRestrictedUser = doctype === 'User' && !frappe?.user?.has_role?.('System Manager')
	if (isRestrictedUser || meta?.issingle) return // no list view for these

	const doctypeRoute = slug(doctype)
	let route: string
	if (meta?.is_tree) {
		const view = frappe?.model?.user_settings?.[doctype]?.last_view || 'Tree'
		route = `${doctypeRoute}/view/${String(view).toLowerCase()}`
	} else {
		route = doctypeRoute
	}
	const reset = crumb.layout_name ? '?reset_filters=1' : ''
	list.push({ label: translate(doctype), route: `/${route}${reset}` })
}

// breadcrumbs.js set_form_breadcrumb
function pushFormCrumb(list: BreadcrumbItem[], crumb: Crumb, view: string) {
	const doctype = crumb.doctype as string
	const route = currentRoute()
	const docname = route.slice(2).join('/')
	const formRoute = `/${slug(doctype)}/${encodeURIComponent(docname)}`

	let title: string
	if (docname.startsWith('new-' + doctype.toLowerCase().replace(/ /g, '-'))) {
		title = translate('New {0}', [translate(doctype)])
	} else {
		// The doc may not be loaded yet (update() can run before the form fetches
		// it); fall back to the route's docname so the crumb is never empty.
		const doc = frappe?.get_doc?.(doctype, docname)
		const docTitle = doc ? frappe?.model?.get_doc_title?.(doc) : undefined
		title = translate(docTitle) || translate(doc?.name) || docname
		if (frappe?.utils?.is_html?.(title)) title = stripHtml(title)
	}

	// On a form view the current doc is the last crumb and not a link (legacy
	// marks it `disabled`); on a print view it links back to the form.
	if (view === 'form') list.push({ label: title })
	else list.push({ label: title, route: formRoute })
}

// breadcrumbs.js set_dashboard_breadcrumb
function pushDashboardCrumb(list: BreadcrumbItem[], crumb: Crumb) {
	const docname = currentRoute()[1]
	list.push({ label: translate(docname), route: `/${slug(crumb.doctype as string)}/${docname}` })
}

// breadcrumbs.js set_custom_breadcrumbs. Custom routes are legacy-formatted
// (e.g. "/desk/List/File/Home", "#", a page route_str), so navigation goes
// through frappe.set_route rather than a vue-router `to`. "#"/empty routes are
// the current page -> a plain, non-clickable label.
function pushCustomCrumb(list: BreadcrumbItem[], crumb: Crumb) {
	const label = stripHtml(crumb.label || '')
	const route = crumb.route
	if (!route || route === '#') {
		list.push({ label })
	} else {
		list.push({ label, onClick: () => frappe?.set_route?.(route) })
	}
}

// ---------------------------------------------------------------------------
// the shared reactive breadcrumbs object (also published as frappe.breadcrumbs)
// ---------------------------------------------------------------------------

interface Breadcrumbs {
	all: Record<string, Crumb>
	items: BreadcrumbItem[]
	visible: boolean
	preferred: Record<string, string>
	module_map: Record<string, string>
	add(module: string | Crumb, doctype?: string, type?: string): void
	current_page(): string
	update(): void
	set_doctype_module(doctype: string, module: string): void
	get_doctype_module(doctype: string): string | undefined
	rename(doctype: string, oldName: string, newName: string): void
	clear(): void
	toggle(show: boolean): void
}

const breadcrumbs = reactive<Breadcrumbs>({
	all: {},
	items: [homeCrumb()],
	visible: false,
	preferred: PREFERRED,
	module_map: MODULE_MAP,

	current_page() {
		return frappe?.get_route_str?.() ?? ''
	},

	add(module, doctype, type) {
		const obj: Crumb =
			typeof module === 'object' ? module : { module: module as string, doctype, type }
		breadcrumbs.all[breadcrumbs.current_page()] = obj
		breadcrumbs.update()
	},

	update() {
		// Registered crumb wins; otherwise derive one from the route so the
		// standard doctype views render without an explicit add() (form is gated).
		const crumb = breadcrumbs.all[breadcrumbs.current_page()] ?? deriveFromRoute()

		const list: BreadcrumbItem[] = [homeCrumb()]
		if (!crumb) {
			breadcrumbs.items = list
			breadcrumbs.visible = false
			return
		}

		if (crumb.type === 'Custom') {
			pushCustomCrumb(list, crumb)
		} else {
			pushWorkspaceCrumb(list)

			const view = (currentRoute()[0] || '').toString().toLowerCase()
			if (crumb.doctype && ['print', 'form'].includes(view)) {
				pushListCrumb(list, crumb)
				pushFormCrumb(list, crumb, view)
			} else if (crumb.doctype && view === 'list') {
				pushListCrumb(list, crumb)
			} else if (crumb.doctype && view === 'dashboard-view') {
				pushListCrumb(list, crumb)
				pushDashboardCrumb(list, crumb)
			} else if (view === 'query-report') {
				const label = (frappe as any)?.query_report?.page_title
				if (label) list.push({ label })
			}
		}

		breadcrumbs.items = list
		breadcrumbs.visible = true
	},

	set_doctype_module(doctype, module) {
		localStorage['preferred_breadcrumbs:' + doctype] = module
	},

	get_doctype_module(doctype) {
		return localStorage['preferred_breadcrumbs:' + doctype]
	},

	rename(doctype, oldName, newName) {
		const oldKey = ['Form', doctype, oldName].join('/')
		const newKey = ['Form', doctype, newName].join('/')
		breadcrumbs.all[newKey] = breadcrumbs.all[oldKey]
		delete breadcrumbs.all[oldKey]
		breadcrumbs.update()
	},

	clear() {
		breadcrumbs.items = [homeCrumb()]
		breadcrumbs.visible = false
	},

	toggle(show) {
		breadcrumbs.visible = show
	},
})

// Auto-derive a `{ doctype, module }` crumb for the standard doctype views, so
// the form/list/tree/report breadcrumbs render straight from the route even
// where the legacy `add()` call is gated behind frappe.vue_shell.
function deriveFromRoute(): Crumb | null {
	const route = currentRoute()
	const view = (route[0] || '').toString().toLowerCase()
	if (!DOCTYPE_VIEWS.includes(view) || !route[1]) return null
	const doctype = route[1]
	return { doctype, module: frappe?.get_meta?.(doctype)?.module }
}

// ---------------------------------------------------------------------------
// install + composable
// ---------------------------------------------------------------------------

let installed = false

// Publish `frappe.breadcrumbs` and keep it in sync with the route. Called once
// from main.ts bootstrap (before any view mounts), replacing the load-time stub.
export function installBreadcrumbs() {
	if (installed || typeof frappe === 'undefined') return
	installed = true

	frappe.breadcrumbs = breadcrumbs

	// Ensure the workspace sidebar is initialised (registers its own router
	// 'change' handler) and capture its reactive state for the workspace crumb.
	// Doing this before we register our handler means getSidebar resolves the
	// sidebar for the new route first, so our update() reads the fresh name.
	const { sidebar } = useWorkspaceSidebar()
	sidebarState = sidebar

	// Re-resolve on every navigation (the workspace crumb is rebuilt too).
	frappe.router?.on?.('change', () => breadcrumbs.update())

	// getSidebar can resolve the workspace name asynchronously (it defers on a
	// not-yet-loaded doctype meta). Re-run when it settles so the leading crumb
	// isn't left stale for a navigation.
	watch(
		() => sidebar.name,
		() => breadcrumbs.update(),
	)

	breadcrumbs.update()
}

export function useBreadcrumbs() {
	return { breadcrumbs }
}
