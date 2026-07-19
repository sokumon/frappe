// getSidebar.ts
//
// Vue port of `frappe/public/js/frappe/ui/sidebar/sidebar.js`. The legacy class
// builds the workspace sidebar as jQuery DOM; here we only keep the data layer:
//   - turn one `frappe.boot.workspace_sidebar_item[*]` entry into a frappe-ui
//     `Sidebar` config (header + sections), and
//   - resolve which sidebar that should be for the current route (the port of
//     `set_workspace_sidebar`, the function highlighted in the legacy file).
//
// The result is a single reactive `sidebar` state that <PageShell> renders and
// that is also published as `frappe.app.sidebar`, so legacy/desk code that pokes
// at `frappe.app.sidebar.setup(...)` keeps working against the Vue chrome.
import { h, markRaw, reactive, type Component } from 'vue'
import { Icon } from 'frappe-ui/icons'

// ---------------------------------------------------------------------------
// boot shapes (subset of frappe.desk.desktop.get_sidebar_items)
// ---------------------------------------------------------------------------

interface SidebarItem {
  label: string
  link_to: string | null
  link_type: string
  type: 'Link' | 'Section Break' | string
  icon: string | null
  child: number
  collapsible: number
  indent: number
  keep_closed: number
  url?: string | null
}

interface SidebarData {
  label: string
  items: SidebarItem[]
  header_icon?: string
  module?: string
  app?: string
  /** Auto-generated from a module — it has no authored icon of its own. */
  from_module?: number
}

type AllSidebarItems = Record<string, SidebarData>

/** One entry of `frappe.boot.app_data`. */
export interface AppData {
  app_name: string
  app_title: string
  app_logo_url: string | string[]
  app_route?: string
  on_apps_screen?: boolean
  workspaces: string[]
}

// ---------------------------------------------------------------------------
// frappe-ui Sidebar shapes (see frappe-ui/src/components/Sidebar/types.ts)
// ---------------------------------------------------------------------------

interface SidebarSectionItem {
  label: string
  icon?: Component
  to?: string
  isActive?: boolean
}

interface SidebarSection {
  label: string
  items: SidebarSectionItem[]
  collapsible?: boolean
}

interface SidebarHeaderConfig {
  title: string
  menuItems: unknown[]
}

interface SidebarConfig {
  header: SidebarHeaderConfig
  sections: SidebarSection[]
}

// ---------------------------------------------------------------------------
// boot accessors (kept as functions so they re-read once boot is populated)
// ---------------------------------------------------------------------------

function allSidebarItems(): AllSidebarItems {
  return frappe?.boot?.workspace_sidebar_item ?? {}
}

// `allSidebarItems()` is keyed by `sidebar_title.lower()`; names we resolve are
// the proper-case titles, so every lookup goes through this.
export function sidebarData(name: string): SidebarData | undefined {
  return allSidebarItems()[name?.toLowerCase()]
}

function appData(): AppData[] {
  return frappe?.boot?.app_data ?? []
}

function allWorkspaces(): Record<string, any> {
  return frappe?.workspaces ?? {}
}

// `__` is seeded on window by boot/translate.ts and isn't a typed global; resolve
// it per call so this module doesn't capture it before boot has installed it.
function __(txt: string): string {
  return (window as any).__?.(txt) ?? txt
}

// Resolve a companion app to the host app it's pinned into (via the
// `add_app_to_rail` hook, surfaced as frappe.boot.app_rail_host). A companion app
// has no shell of its own — its workspaces live in the host app's rail — so its
// app context is the host's. Port of Sidebar.rail_host_app.
function railHostApp(appName: string): string {
  return frappe?.boot?.app_rail_host?.[appName] || appName
}

// The app that owns a named sidebar, or null (port of Sidebar.get_sidebar_app).
// Custom (non-standard) workspaces belong to no app, so they carry no app context
// even if an older record has a stale `app` value. Both the header (for its title)
// and the workspace rail (for its workspace set) resolve their app through this.
export function sidebarApp(name: string): AppData | null {
  if (!name) return null
  const workspace = allWorkspaces()[slug(name)]
  const data = sidebarData(name)
  const appName = workspace && !workspace.standard ? null : workspace?.app || data?.app || null
  if (!appName) return null
  return appData().find((a) => a.app_name === railHostApp(appName)) ?? null
}

// ---------------------------------------------------------------------------
// item -> frappe-ui section transform
// ---------------------------------------------------------------------------

// `to` must be a real app route (vue-router), so we slug names the same way the
// router does (frappe.router.slug) instead of emitting legacy desk paths.
export function slug(name: string): string {
  return frappe?.router?.slug ? frappe.router.slug(name) : name.toLowerCase().replace(/ /g, '-')
}

function buildRoute(item: SidebarItem): string {
  if (!item.link_to) return item.url || ''
  switch (item.link_type) {
    case 'Report':
      return `/query-report/${encodeURIComponent(item.link_to)}`
    case 'Dashboard':
      return `/dashboard/${slug(item.link_to)}`
    // Workspace / DocType / Page all resolve through the `/:slug` dispatcher.
    default:
      return `/${slug(item.link_to)}`
  }
}

// Sidebar icons are stored as Lucide icon names (kebab-case). Render them with
// frappe-ui's `Icon`, which `<use>`s the Lucide sprite injected by spritePlugin
// (wired in main.ts). Returned as a tiny functional component so frappe-ui's
// `<component :is="icon">` can mount it and forward the sizing `class`; `markRaw`
// keeps Vue from making the component reactive.
const DEFAULT_ICON = 'file'

// Ids actually present in the injected sprite, so an unknown name falls back to a
// visible default instead of rendering a blank `<use href="#missing">`. Resolved
// lazily (the sprite is in the DOM by the time the sidebar first builds).
let spriteIds: Set<string> | null = null
function lucideHas(name: string): boolean {
  if (!spriteIds) {
    const sprite = document.getElementById('lucide-sprite')
    if (!sprite) return true // can't verify yet; assume valid
    spriteIds = new Set(Array.from(sprite.querySelectorAll('symbol[id]')).map((s) => s.id))
  }
  return spriteIds.has(name)
}

function toLucideName(iconStr: string | null): string {
  const name = (iconStr || '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  return name && lucideHas(name) ? name : DEFAULT_ICON
}

export function resolveIcon(iconStr: string | null): Component {
  const name = toLucideName(iconStr)
  return markRaw(
    (_props: Record<string, unknown>, ctx: { attrs: Record<string, unknown> }) =>
      h(Icon, { name, ...ctx.attrs })
  ) as unknown as Component
}

function transformItems(rawItems: SidebarItem[]): SidebarSection[] {
  const sections: SidebarSection[] = []
  // Items before the first Section Break live in an unlabelled lead section.
  let current: SidebarSection = { label: '', items: [] }

  for (const item of rawItems) {
    if (item.type === 'Section Break') {
      if (current.items.length > 0) sections.push(current)
      current = { label: item.label ?? '', items: [], collapsible: !!item.collapsible }
      continue
    }

    if (item.link_to || item.url) {
      current.items.push({
        label: item.label,
        icon: resolveIcon(item.icon),
        to: buildRoute(item),
      })
    }
  }

  if (current.items.length > 0) sections.push(current)
  return sections
}

// ---------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------

// Extra header dropdown entries. Empty by default; a host can push to it before
// the first sidebar is built. Appended after the Apps group below.
const headerMenuItems: unknown[] = []

// The header's primary line (port of SidebarHeader.get_display_title). It names
// the app the sidebar belongs to; custom / app-less / module sidebars have none,
// so they fall back to the workspace title (private workspaces are stored as
// `${title}-${for_user}`, hence preferring the workspace's own `title`).
function displayTitle(name: string, data: SidebarData): string {
  const app = sidebarApp(name)
  if (app) return app.app_title

  const workspace = allWorkspaces()[slug(name)]
  if (workspace && !workspace.public && workspace.for_user) return workspace.title
  return data.label || name
}

// An app's logo as a menu icon. `app_logo_url` is occasionally a list (hooks can
// return one), so take the first entry the way the legacy header did.
function appLogoIcon(app: AppData): Component | undefined {
  const logo = Array.isArray(app.app_logo_url) ? app.app_logo_url[0] : app.app_logo_url
  if (!logo) return undefined
  return markRaw(
    (_props: Record<string, unknown>, ctx: { attrs: Record<string, unknown> }) =>
      h('img', {
        src: logo,
        alt: '',
        class: [ctx.attrs.class as string, 'size-4 rounded-sm object-contain'],
      })
  ) as unknown as Component
}

// The app switcher (port of SidebarHeader.fetch_apps): every app that opts into
// the apps screen, as one group of entries. `app_route` points at another app's
// own SPA (e.g. /crm), so switching is a full page load, not a router push.
// Legacy also offered its inline workspace selector here, but only when the dock
// was off — the rail owns workspace switching now, so that list stays dropped.
function appsMenu(): unknown[] {
  const apps = appData().filter((app) => app.on_apps_screen)
  if (!apps.length) return []

  return [
    {
      group: __('Apps'),
      items: apps.map((app) => ({
        label: app.app_title,
        icon: appLogoIcon(app),
        onClick: () => {
          if (app.app_route) window.location.href = app.app_route
        },
      })),
    },
  ]
}

// The header is title + dropdown only: no icon (legacy's set_header_icon chain
// is dropped — the rail already carries the app logo) and no subtitle. PageShell
// renders it with `:show-logo="false"`.
function buildHeader(name: string, data: SidebarData): SidebarHeaderConfig {
  return {
    title: displayTitle(name, data),
    menuItems: [...appsMenu(), ...headerMenuItems],
  }
}

// Route of the first navigable item in a workspace's sidebar, or null when it has
// none (port of legacy Sidebar.get_first_sidebar_route). The workspace rail lands
// on this rather than the bare workspace page, so switching workspaces opens the
// thing you actually work in.
export function getFirstSidebarRoute(name: string): string | null {
  for (const item of sidebarData(name)?.items ?? []) {
    if (item.type === 'Section Break') continue
    const route = buildRoute(item)
    if (route) return route
  }
  return null
}

// Build the frappe-ui config for a named sidebar (no selection / side effects).
function buildSidebarConfig(name: string): SidebarConfig | null {
  const data = sidebarData(name)
  if (!data) return null
  return { header: buildHeader(name, data), sections: transformItems(data.items) }
}

// ---------------------------------------------------------------------------
// route -> sidebar name  (port of legacy set_workspace_sidebar + helpers)
// ---------------------------------------------------------------------------

// Sidebars whose items link to `linkTo` (legacy get_workspace_sidebars).
function getWorkspaceSidebars(linkTo: string): string[] {
  const sidebars: string[] = []
  for (const [name, data] of Object.entries(allSidebarItems())) {
    if (data.items.some((item) => item.link_to === linkTo)) {
      sidebars.push(data.label || name)
    }
  }
  return sidebars
}

// First top-level workspace belonging to `module` (legacy get_workspace_for_module).
function getWorkspaceForModule(module?: string): string {
  if (!module) return ''
  for (const page of frappe?.boot?.workspaces?.pages ?? []) {
    if (page.module === module && !page.parent_page) return page.name
  }
  return ''
}

// Keep only sidebars that belong to `app` (legacy filter_sidebars_from_app).
function filterSidebarsFromApp(sidebars: string[], app: string): string[] {
  const out: string[] = []
  for (const name of sidebars) {
    if (!out.includes(name) && sidebarData(name)?.app === app) out.push(name)
  }
  return out
}

// module -> [sidebar labels] (legacy build_sidebar_module_map).
function sidebarModuleMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const data of Object.values(allSidebarItems())) {
    if (data.module && !data.label.includes('My Workspaces')) {
      ;(map[data.module] ||= []).push(data.label)
    }
  }
  return map
}

// Fallback when the route's entity matched no sidebar by link (legacy
// show_sidebar_for_module).
function resolveModuleSidebar(module: string): string | null {
  if (sidebar.name && sidebar.preferredSidebars.includes(sidebar.name)) return null
  if (sidebarData(module)) return module
  const workspaceName = getWorkspaceForModule(module)
  if (workspaceName && sidebarData(workspaceName)) return workspaceName
  const candidates = sidebarModuleMap()[module]?.slice().sort((a, b) => a.localeCompare(b))
  return candidates?.length ? candidates[0] : null
}

function readSidebarItemMap(): Record<string, string[]> | null {
  try {
    return JSON.parse(localStorage.getItem('sidebar_item_map') || 'null')
  } catch {
    return null
  }
}

// The function highlighted in sidebar.js: given the current standard route, work
// out which workspace sidebar should be shown. Returns the sidebar name to load,
// or `null` to keep the current one (it already serves this route).
function resolveSidebarName(route: string[], module?: string): string | null {
  let entityName: string | undefined

  switch (route.length) {
    case 1:
      entityName = route[0]
      break
    case 2:
      entityName = route[1]
      // a route that points straight at a workspace (e.g. ["Workspaces", "Stock"])
      if (sidebarData(entityName)) return entityName
      break
    case 3:
      entityName = route[1]
      if (route[0] === 'Workspaces' && route[1] === 'private') entityName = route[2]
      break
    default:
      entityName = route[1]
  }

  let sidebars = getWorkspaceSidebars(entityName ?? '')
  sidebar.preferredSidebars = sidebars

  // already showing a sidebar that serves this entity -> just re-highlight
  if (sidebar.name && sidebars.includes(sidebar.name)) return null

  // user's last choice for this entity (persisted by the legacy desk)
  const itemMap = readSidebarItemMap()
  if (entityName && itemMap?.[entityName]) return itemMap[entityName][0]

  if (module) {
    sidebars = filterSidebarsFromApp(
      sidebars,
      frappe.boot.module_app[module.toLowerCase().replace(/[ -]/g, '_')]
    )
  }

  if (sidebars.length === 1) return sidebars[0]
  if (sidebars.length > 1) {
    const workspaceSidebar = getWorkspaceForModule(module)
    // Prefer the module's own workspace; otherwise keep a linking sidebar rather
    // than dropping to null (legacy falls back to the first candidate here).
    return sidebars.includes(workspaceSidebar) ? workspaceSidebar : sidebars[0]
  }
  if (module) return resolveModuleSidebar(module)
  return null
}

// ---------------------------------------------------------------------------
// the shared reactive sidebar state (also published as frappe.app.sidebar)
// ---------------------------------------------------------------------------

interface SidebarState {
  name: string
  header: SidebarHeaderConfig | null
  sections: SidebarSection[]
  preferredSidebars: string[]
  /** Load a named workspace sidebar (legacy frappe.app.sidebar.setup). */
  setup(name: string): void
  /** Re-resolve for the current route (legacy set_workspace_sidebar). */
  set_workspace_sidebar(router?: { meta?: { module?: string } }): void
  /** Build the frappe-ui config for an arbitrary sidebar without selecting it. */
  getSidebarByName(name: string): SidebarConfig | null
}

const sidebar = reactive<SidebarState>({
  name: '',
  header: null,
  sections: [],
  preferredSidebars: [],

  setup(name: string): void {
    setSidebar(name)
  },

  set_workspace_sidebar(router): void {
    resolveForCurrentRoute(router?.meta?.module)
  },

  getSidebarByName(name: string): SidebarConfig | null {
    return buildSidebarConfig(name)
  },
})

// Build + select a sidebar by name (legacy setup()).
function setSidebar(name: string) {
  const config = buildSidebarConfig(name)
  if (!config) return
  sidebar.name = sidebarData(name)?.label ?? name
  sidebar.header = config.header
  sidebar.sections = config.sections
  markActive()
}

// Highlight the item matching the current path (legacy set_active_workspace_item).
function currentPath(): string {
  const routed = (window as any).frappe?._router?.currentRoute?.value?.path
  return routed || window.location.pathname
}

function markActive() {
  const path = currentPath()
  for (const section of sidebar.sections) {
    for (const item of section.items) {
      const to = item.to
      item.isActive = !!to && (path === to || path.startsWith(to + '/'))
    }
  }
}

// Legacy reads the module off `router.meta.module`, which the desk router sets
// from the route's doctype meta (set_doctype_route). The vue compat router does
// not, so derive it from the route's doctype for List/Form/Tree/Report routes.
function moduleForRoute(route: string[]): string | undefined {
  const view = route[0]
  if (!['List', 'Form', 'Tree', 'Report'].includes(view)) return undefined
  const doctype = route[1]
  if (!doctype) return undefined
  return frappe?.get_meta?.(doctype)?.module || undefined
}

function resolveForCurrentRoute(module?: string) {
  const route = (frappe?.get_route?.() ?? []) as string[]

  // For doctype routes the module comes from the doctype meta. If that meta
  // isn't loaded yet (the change event can fire before the view fetches it),
  // load it and re-resolve, so the sidebar isn't left empty on first paint.
  const doctype = ['List', 'Form', 'Tree', 'Report'].includes(route[0]) ? route[1] : undefined
  if (doctype && module === undefined && !frappe?.get_meta?.(doctype)) {
    frappe?.model?.with_doctype?.(doctype, () => resolveForCurrentRoute())
    return
  }

  // Query reports aren't doctype routes, so their module can't come from route
  // meta or get_meta (route[1] is a Report name, not a DocType). Without a module
  // a report that isn't directly linked in any sidebar resolves to nothing and
  // leaves the sidebar empty. Pull the module off the Report doc (loading it if
  // it isn't local yet) so the module-based fallback in resolveSidebarName runs.
  if (route[0] === 'query-report' && module === undefined && route[1]) {
    const reportName = route[1]
    const reportDoc = frappe?.get_doc?.('Report', reportName)
    if (!reportDoc) {
      frappe?.model?.with_doc?.('Report', reportName, () => resolveForCurrentRoute())
      return
    }
    module = reportDoc.module || frappe?.get_meta?.(reportDoc.ref_doctype)?.module || undefined
  }

  const name = resolveSidebarName(route, module ?? moduleForRoute(route))
  if (name) {
    setSidebar(name)
  } else {
    // same sidebar still applies; just move the active highlight
    markActive()
  }
}

// ---------------------------------------------------------------------------
// init: wire route changes + publish frappe.app.sidebar (runs once)
// ---------------------------------------------------------------------------

let initialised = false

function init() {
  if (initialised || typeof frappe === 'undefined') return
  initialised = true

  frappe.app = frappe.app || {}
  sidebar.show_sidebar_for_module = function () {
      console.log('show_sidebar_for_module is deprecated; sidebars are now resolved automatically based on the route. Please migrate any calls to this function to instead ensure the relevant sidebar config is present in boot and that sidebar items link to the correct entities.')
  }
  frappe.app.sidebar = sidebar

  // re-resolve on every navigation (compat layer fires this after each route)
  frappe.router?.on?.('change', (router: { meta?: { module?: string } }) =>
    resolveForCurrentRoute(router?.meta?.module)
  )

  // resolve for the route we booted on
  resolveForCurrentRoute()
}

// ---------------------------------------------------------------------------
// public composable
// ---------------------------------------------------------------------------

export function useWorkspaceSidebar() {
  init()
  return { sidebar }
}

export type { SidebarConfig, SidebarSection, SidebarHeaderConfig }
