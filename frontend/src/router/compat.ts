// Backward-compatibility layer.
//
// A large amount of legacy desk code calls `frappe.set_route("Form", "User", x)`,
// reads `frappe.get_route()` as a capitalised array and uses the global
// `frappe.route_options`. This module reimplements that public surface on top
// of vue-router so existing code keeps working while new code uses the router /
// `useRoute` directly.

import type { RouteLocationNormalized, Router } from "vue-router"
import {
	LIST_VIEWS_ROUTE,
	decodeComponent,
	isPlainObject,
	slug,
	unslug,
} from "./constants"

let router: Router

// ---------------------------------------------------------------------------
// slug <-> doctype map (built lazily from boot, mirrors legacy router.setup)
// ---------------------------------------------------------------------------

type DoctypeRoute = { doctype: string; doctype_layout?: string }
let routesMap: Record<string, DoctypeRoute> | null = null

export function buildRoutesMap(): Record<string, DoctypeRoute> {
	const map: Record<string, DoctypeRoute> = {}
	const boot = frappe?.boot
	if (!boot) return map

	for (const doctype of boot.user?.can_read || []) {
		map[slug(doctype)] = { doctype }
	}
	for (const layout of boot.doctype_layouts || []) {
		map[slug(layout.name)] = {
			doctype: layout.document_type,
			doctype_layout: layout.name,
		}
	}
	return map
}

// Memoised – rebuilt once boot becomes available.
export function getRoutesMap(): Record<string, DoctypeRoute> {
	if (!routesMap || Object.keys(routesMap).length === 0) {
		routesMap = buildRoutesMap()
	}
	return routesMap
}

export function getDoctypeRoute(slugged: string): DoctypeRoute | undefined {
	return getRoutesMap()[slugged]
}

function slugToDoctype(slugged: string): string {
	return getRoutesMap()[slugged]?.doctype || unslug(slugged)
}

// Whether `name` is a Frappe Page the current user may access. `allowed_pages`
// (an array of names) is only populated once desk.js runs, so we fall back to
// the authoritative `page_info` dict that always ships in boot.
export function isAllowedPage(name: string): boolean {
	const boot = frappe?.boot
	if (!boot) return false
	if (Array.isArray(boot.allowed_pages)) return boot.allowed_pages.includes(name)
	return !!boot.page_info?.[name]
}

// ---------------------------------------------------------------------------
// workspaces (ported from desk.js `setup_workspaces`)
//
// The legacy Application class builds frappe.workspaces / frappe.modules on
// boot; that code does not run in the vue shell, so the router builds them
// itself. The guards and the DoctypeOrWorkspace dispatcher rely on
// frappe.workspaces[slug] to tell workspaces apart from doctypes.
// ---------------------------------------------------------------------------

export function setupWorkspaces() {
	const boot = frappe?.boot
	if (!boot?.workspaces) return

	frappe.modules = {}
	frappe.workspaces = {}
	boot.allowed_workspaces = boot.workspaces.pages

	for (const page of boot.allowed_workspaces || []) {
		frappe.modules[page.module] = page
		frappe.workspaces[slug(page.name)] = page
	}
}

// ---------------------------------------------------------------------------
// router setup (ported from legacy frappe.router.setup)
//
// Builds the slug -> doctype map + workspaces and, crucially, repoints
// frappe.router.routes at the freshly built map. installCompat runs before
// boot is available, so the map it first assigned is empty; the lazily rebuilt
// map would otherwise never be visible to code that reads frappe.router.routes
// directly (List.vue, Form.vue, …). Mirrors desk.js calling frappe.router.setup
// from load_bootinfo.
// ---------------------------------------------------------------------------

let routerReady = false

export function setupRouter() {
	routesMap = buildRoutesMap()
	if (window.frappe?.router) window.frappe.router.routes = routesMap
	setupWorkspaces()
	routerReady = true
}

// Run setup once, as soon as boot is available (called from the navigation gate
// as a safety net in case bootstrap did not call frappe.router.setup()).
export function ensureRouterReady() {
	if (!routerReady && frappe?.boot) setupRouter()
}

// ---------------------------------------------------------------------------
// vue-router location  ->  legacy standard route array
// ---------------------------------------------------------------------------

export function toStandardRoute(to: RouteLocationNormalized): any[] {
	const p: Record<string, any> = to.params || {}

	switch (to.name) {
		case "home":
			return []

		case "form": {
			const name = Array.isArray(p.name) ? p.name.join("/") : p.name
			return ["Form", slugToDoctype(p.doctype), name]
		}

		case "list-view": {
			const view = String(p.view || "").toLowerCase()
			if (view === "tree") return ["Tree", slugToDoctype(p.doctype)]
			const std: any[] = ["List", slugToDoctype(p.doctype), LIST_VIEWS_ROUTE[view] || "List"]
			if (p.rest) std.push(...String(p.rest).split("/").filter(Boolean))
			return std
		}

		case "workspace-private":
			return ["Workspaces", "private", p.workspace]

		case "query-report":
			return ["query-report", p.reportName]

		case "doctype-or-workspace": {
			const s = p.slug
			if (frappe.workspaces?.[s]) return ["Workspaces", frappe.workspaces[s].name]
			if (isAllowedPage(s)) return [s]
			const dt = slugToDoctype(s)
			// single doctype resolves to its form (["Form", doctype, doctype])
			if (frappe.model?.is_single?.(dt)) return ["Form", dt, dt]
			return ["List", dt, "List"]
		}

		default:
			return [to.path.replace(/^\//, "")]
	}
}

// ---------------------------------------------------------------------------
// legacy standard route array  ->  vue-router path  (ported from legacy
// get_route_from_arguments + convert_from_standard_route)
// ---------------------------------------------------------------------------

function getRouteFromArguments(args: any[]): any[] {
	let route = Array.from(args)

	if (route.length === 1 && Array.isArray(route[0])) {
		// frappe.set_route(['a', 'b', 'c'])
		route = route[0]
	}

	if (route.length === 1 && typeof route[0] === "string" && route[0].includes("/")) {
		// frappe.set_route('a/b/c')
		route = route[0].split("/").map(decodeComponent)
	}

	if (route[0] === "") route.shift()

	// strip the app prefix segment ("desk"/"app") if a caller included it
	if (["desk", "app"].includes(route[0])) route.shift()

	// names may contain "/"
	if (route[0] === "Form" && route.length > 3) {
		route = [route[0], route[1], route.slice(2).join("/")]
	}

	return route
}

function convertFromStandardRoute(route: any[]): any[] {
	const view = route[0] ? String(route[0]).toLowerCase() : ""
	let newRoute = route

	if (view === "list") {
		if (route[2] && route[2] !== "list" && !isPlainObject(route[2])) {
			newRoute = [slug(route[1]), "view", String(route[2]).toLowerCase()]
			// calendar / inbox / file folder
			if (route[3]) newRoute.push(...route.slice(3))
		} else {
			if (isPlainObject(route[2])) frappe.route_options = route[2]
			newRoute = [slug(route[1])]
		}
	} else if (view === "form") {
		newRoute = [slug(route[1])]
		if (route[2]) newRoute.push(route[2])
	} else if (view === "tree") {
		newRoute = [slug(route[1]), "view", "tree"]
	}

	return newRoute
}

function setRoute(...args: any[]) {
	let route = getRouteFromArguments(args)
	route = convertFromStandardRoute(route)

	// any plain-object segment becomes route_options (legacy make_url behaviour)
	const segments: string[] = []
	for (const seg of route) {
		if (isPlainObject(seg)) {
			frappe.route_options = seg
		} else {
			segments.push(encodeURIComponent(String(seg)))
		}
	}

	const path = "/" + segments.join("/")
	const query = (frappe.route_options || {}) as any
	const replace = !!frappe.route_flags?.replace_route
	frappe.route_flags = {}

	return router[replace ? "replace" : "push"]({ path, query })
}

// ---------------------------------------------------------------------------
// tiny event emitter (replaces frappe.utils.make_event_emitter on the router)
// ---------------------------------------------------------------------------

function makeEmitter() {
	const listeners: Record<string, Function[]> = {}
	return {
		events: listeners,
		on(name: string, cb: Function) {
			;(listeners[name] ||= []).push(cb)
		},
		off(name: string, cb: Function) {
			listeners[name] = (listeners[name] || []).filter((fn) => fn !== cb)
		},
		trigger(name: string, ...payload: any[]) {
			;(listeners[name] || []).forEach((cb) => cb(...payload))
		},
	}
}

// ---------------------------------------------------------------------------
// install: attach the whole legacy surface onto window.frappe
// ---------------------------------------------------------------------------

export function installCompat(routerInstance: Router) {
	router = routerInstance

	if (!window.frappe) window.frappe = {}
	const f = window.frappe

	// state
	f.re_route ??= { "#login": "" }
	f.route_titles ??= {}
	f.route_flags ??= {}
	f.route_hooks ??= {}
	f.route_history ??= []
	if (f.route_options === undefined) f.route_options = null

	// router object
	const emitter = makeEmitter()
	f.router = {
		...(f.router || {}),
		...emitter,
		current_route: null,
		routes: getRoutesMap(),
		doctype_layout: undefined,
		slug,
		unslug,
		setup: setupRouter,
		get_sub_path() {
			return router.currentRoute.value.path.replace(/^\//, "")
		},
	}

	// global helpers
	f.set_route = setRoute
	f.get_route = () => f.router.current_route
	f.get_route_str = () => (f.router.current_route || []).join("/")
	f.get_prev_route = () =>
		f.route_history.length > 1 ? f.route_history[f.route_history.length - 2] : []
	f.has_route_options = () => Boolean(Object.keys(f.route_options || {}).length)
	f.set_re_route = function (...args: any[]) {
		const tmp = f.router.get_sub_path()
		setRoute(...args)
		f.re_route[tmp] = f.router.get_sub_path()
	}
}

// Called from the router's afterEach to keep all the legacy globals in sync
// with the current location.
export function syncCompatState(to: RouteLocationNormalized) {
	const f = window.frappe
	if (!f) return

	f.route_options = { ...(to.query || {}) }
	f.router.current_route = toStandardRoute(to)
	f.router.doctype_layout = getDoctypeRoute(String(to.params.doctype ?? to.params.slug ?? ""))
		?.doctype_layout
	f.route_history.push(f.router.current_route)

	const subPath = to.path.replace(/^\//, "")
	if (f.route_titles[subPath]) document.title = f.route_titles[subPath]

	f.router.trigger?.("change", f.router)
}
