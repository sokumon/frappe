// getWorkspaceRail.ts
//
// Vue port of `frappe/public/js/frappe/ui/sidebar/workspace_dock.js` — the slim
// vertical rail rendered to the left of the body sidebar, listing the current
// app's workspaces as icons with the app logo pinned to the corner.
//
// The legacy class builds jQuery DOM and owns its own refresh cycle; here we
// keep only the data layer and let <WorkspaceRail> render it with frappe-ui's
// `Rail`. The workspace *set* the rail offers is the port of the selector
// helpers that live on the legacy Sidebar (get_sidebar_app /
// get_public_workspaces / get_private_workspaces / collect_selector_workspaces /
// is_active_workspace), since the dock reads all of them off `this.sidebar`.
//
// Everything derives from the shared sidebar state in getSidebar.ts: the rail
// belongs to the app whose sidebar is on screen, so it re-renders whenever the
// route resolves a different sidebar.
import {
  computed,
  onScopeDispose,
  reactive,
  watchEffect,
  type Component,
  type ComputedRef,
} from 'vue'
import {
  getFirstSidebarRoute,
  resolveIcon,
  sidebarData,
  slug,
  useWorkspaceSidebar,
} from './getSidebar'

// ---------------------------------------------------------------------------
// boot shapes (subset of frappe.boot)
// ---------------------------------------------------------------------------

interface AppData {
  app_name: string
  app_title: string
  app_logo_url: string
  workspaces: string[]
}

interface Workspace {
  name: string
  title?: string
  label?: string
  icon?: string | null
  app?: string | null
  public?: number | boolean
  standard?: number | boolean
  for_user?: string
}

/** One rendered cell of the rail. */
export interface RailWorkspace {
  name: string
  label: string
  icon: Component
  /** Where the cell navigates: the workspace's first sidebar link, else its own page. */
  to: string
  active: boolean
  /** Switch the body sidebar to this workspace (alongside navigating). */
  select(): void
}

// `__` is seeded on window by boot/translate.ts and isn't a typed global; resolve
// it per call so this module doesn't capture it before boot has installed it.
function __(txt: string): string {
  return (window as any).__?.(txt) ?? txt
}

function appData(): AppData[] {
  return frappe?.boot?.app_data ?? []
}

function allWorkspaces(): Record<string, Workspace> {
  return frappe?.workspaces ?? {}
}

// Resolve a companion app to the host app it's pinned into (via the
// `add_app_to_rail` hook, surfaced as frappe.boot.app_rail_host). A companion
// app has no shell of its own — its workspaces live in the host app's rail — so
// its app context is the host's. Port of Sidebar.rail_host_app.
function railHostApp(appName: string): string {
  return frappe?.boot?.app_rail_host?.[appName] || appName
}

// The app that owns the sidebar currently on screen (port of
// Sidebar.get_sidebar_app). Custom (non-standard) workspaces belong to no app,
// so they carry no app context even if an older record has a stale `app` value.
function sidebarApp(sidebarName: string): AppData | null {
  if (!sidebarName) return null
  const workspace = allWorkspaces()[slug(sidebarName)]
  const data = sidebarData(sidebarName)
  const appName =
    workspace && !workspace.standard ? null : workspace?.app || data?.app || null
  if (!appName) return null
  return appData().find((a) => a.app_name === railHostApp(appName)) ?? null
}

// ---------------------------------------------------------------------------
// the workspace selector set (ports of the legacy Sidebar helpers)
// ---------------------------------------------------------------------------

// `frappe.boot.user_workspaces` is the user's personal selector preference
// (User.workspaces). When set it is authoritative and may include private
// workspaces too. Otherwise fall back to the app's workspaces plus any public
// custom (user-created, non-standard) workspaces — those belong to no app's
// list, so they'd otherwise never appear.
function publicWorkspaces(app: AppData | null): Workspace[] {
  const userWorkspaces: string[] = frappe?.boot?.user_workspaces ?? []
  let source: string[]

  if (userWorkspaces.length) {
    source = userWorkspaces
  } else {
    const appWorkspaces = app?.workspaces ?? []
    const applessCustom = Object.values(allWorkspaces())
      .filter((w) => w.public && !w.standard && !w.app)
      .map((w) => w.name)
    source = [...new Set([...appWorkspaces, ...applessCustom])]
  }

  return source.map((name) => allWorkspaces()[slug(name)]).filter(Boolean)
}

// The user's private workspaces. When they've curated a selection, any private
// workspaces they want are already part of it (via publicWorkspaces), so don't
// auto-append them again.
function privateWorkspaces(): Workspace[] {
  if ((frappe?.boot?.user_workspaces ?? []).length) return []
  return Object.values(allWorkspaces()).filter(
    (w) => !w.public && w.for_user === frappe?.session?.user
  )
}

// The workspace's own desk route — used when it has no sidebar items to land on.
function workspaceRoute(workspace: Workspace): string {
  const name = slug(workspace.name || workspace.title || '')
  return workspace.public ? `/${name}` : `/private/${name}`
}

// ---------------------------------------------------------------------------
// page-level opt-out (port of Sidebar.page_hides_dock)
// ---------------------------------------------------------------------------
//
// The rail is mounted in App.vue, above the router, so a page can't just not
// render it — it declares the opt-out instead and the rail reads it here. Pages
// register by id rather than flipping a single flag: during a route change the
// incoming PageShell mounts before the outgoing one unmounts, and a shared flag
// would let the outgoing page's teardown clear the incoming page's opt-out.
const railHiders = reactive(new Set<number>())
let nextHiderId = 1

/**
 * Hide the workspace rail while the calling component is mounted and `hide()`
 * reads true. Registration is scoped: it's dropped automatically on unmount.
 */
export function useHideWorkspaceRail(hide: () => boolean): void {
  const id = nextHiderId++
  watchEffect(() => {
    if (hide()) railHiders.add(id)
    else railHiders.delete(id)
  })
  onScopeDispose(() => railHiders.delete(id))
}

export function useWorkspaceRail() {
  // Also guarantees the sidebar layer is initialised (it owns the route hook).
  const { sidebar } = useWorkspaceSidebar()

  const app: ComputedRef<AppData | null> = computed(() => sidebarApp(sidebar.name))

  // The currently shown workspace is rendered like any other, just highlighted
  // (port of Sidebar.is_active_workspace).
  function isActive(workspace: Workspace): boolean {
    const active = slug(sidebar.name || '')
    return !!active && slug(workspace.name || workspace.title || '') === active
  }

  function toRailWorkspace(workspace: Workspace): RailWorkspace | null {
    const label = workspace.title || workspace.label || workspace.name
    if (!label) return null
    const name = workspace.name || label

    return {
      name,
      label,
      // Every icon keeps the same ink; active state is carried by the tile fill
      // and the left indicator bar alone (as the legacy dock did). gameplan greys
      // out inactive tiles, but that reads as disabled on monochrome icons.
      icon: resolveIcon(workspace.icon ?? null),
      to: getFirstSidebarRoute(name) || workspaceRoute(workspace),
      active: isActive(workspace),
      // Navigating to a workspace's first link lands on an entity that several
      // sidebars may serve, so name the sidebar explicitly instead of leaving it
      // to the route resolver (port of the dock's open_workspace -> select_sidebar).
      select: () => {
        if (sidebarData(name)) sidebar.setup(name)
      },
    }
  }

  // Full ordered set the rail renders: public then private (port of
  // Sidebar.collect_selector_workspaces), scoped to the shown sidebar's app.
  const workspaces: ComputedRef<RailWorkspace[]> = computed(() =>
    [...publicWorkspaces(app.value), ...privateWorkspaces()]
      .map(toRailWorkspace)
      .filter((w): w is RailWorkspace => !!w)
  )

  // App logo pinned to the top corner. Falls back to the first app's logo so the
  // corner is never empty while no app context is resolved (a custom workspace).
  const logo = computed(() => ({
    url: app.value?.app_logo_url || appData()[0]?.app_logo_url || '',
    title: app.value?.app_title || __('Apps'),
  }))

  // True while any mounted page opts out (see useHideWorkspaceRail).
  const hidden = computed(() => railHiders.size > 0)

  return { app, workspaces, logo, hidden }
}
