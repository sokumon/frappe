// Types for the Vue page shell + the `frappe.ui.Page` bridge.
// See frontend/docs/page-migration.md (§3–§5) for the design.

// ---------------------------------------------------------------------------
// Configurable options (page-migration.md §3.3)
// ---------------------------------------------------------------------------

export interface PageOptions {
	title?: string
	sidebar?: boolean // default true; configurable per view
	sidebarPosition?: 'Left' | 'Right'
	// Page-level opt-out for the workspace rail (WorkspaceRail.vue), the port of
	// the legacy Sidebar.page_hides_dock check. Independent of `sidebar`: a
	// single-column page still gets the rail; only a page that hides the whole
	// sidebar (or sets this outright) drops it — e.g. the apps/desktop screen.
	hideWorkspaceDock?: boolean

	// Legacy `make_app_page` options, kept so the bridge can map them. New code
	// should use the fields above instead.
	parent?: any
	single_column?: boolean
	hide_sidebar?: boolean
	hide_workspace_dock?: boolean
	sidebar_position?: 'Left' | 'Right'
	[key: string]: any
}

// ---------------------------------------------------------------------------
// Reactive state rendered by Navbar / PageShell (page-migration.md §3.1)
// ---------------------------------------------------------------------------

export interface PageIndicator {
	label: string
	color?: string
}

// Extra DOM event handlers registered via the T2 proxy's `.on(event, fn)`.
// Stored reactively so Navbar re-binds them with v-on on every render (a raw
// jQuery .on() would be lost when Vue patches the button).
export type PageListeners = Record<string, Array<(...args: any[]) => any>>

// A primary/secondary button. The jQuery fields (`disabled`, `visible`,
// `extraClass`) back the T2 proxy returned to legacy callers (§5).
export interface PageAction {
	label: string
	icon?: string
	workingLabel?: string
	onClick: (...args: any[]) => any
	disabled: boolean
	visible: boolean
	extraClass: string
	listeners?: PageListeners
}

// A menu / action dropdown entry.
export interface PageMenuItem {
	label: string
	onClick: (...args: any[]) => any
	shortcut?: string
	standard?: boolean
	icon?: string
	extraClass: string
	visible: boolean
	data: Record<string, any>
	// Marks a separator entry (page.js add_divider). The Navbar splits the menu
	// into frappe-ui groups at these markers rather than rendering them as items.
	divider?: boolean
}

// A custom button group in the inner toolbar (page.js add_custom_button_group):
// a labelled dropdown whose items are added later via add_custom_menu_item.
// `id` is the stable handle returned to callers so children can target it.
export interface PageCustomGroup {
	id: number
	label: string
	icon?: string
	parent?: string // host region: 'custom_actions' (default) etc.
	primary: boolean
	visible: boolean
	items: PageMenuItem[]
	// Attribute bag for the handle's `.attr()` (page.js set data-* on the group).
	data?: Record<string, any>
}

// An inner-toolbar button. `group` collects buttons into a `<Dropdown>`.
export interface PageInnerButton {
	label: string
	group?: string
	type: string
	icon?: string
	btnClass?: string
	onClick: (...args: any[]) => any
	disabled: boolean
	visible: boolean
	listeners?: PageListeners
}

export interface PageIcon {
	icon: string
	onClick?: (...args: any[]) => any
	tooltip?: string
	el?: HTMLElement
}

export interface PageState {
	title: string
	// Whether this page hides the workspace rail. Lives on the state (not just
	// PageShell's props) so the legacy bridge can set it on a shell page a page
	// script adopts via make_app_page.
	hideWorkspaceDock: boolean
	subtitle: string
	titleIcon: string
	indicator: PageIndicator | null
	innerMessage: string
	primaryAction: PageAction | null
	secondaryAction: PageAction | null
	menuItems: PageMenuItem[]
	actionItems: PageMenuItem[]
	// The actions dropdown (bulk operations) is hidden by default and only shown
	// when callers invoke show_actions_menu() — e.g. list view toggles it on row
	// selection. Mirrors the legacy `.actions-btn-group.hide` behaviour.
	actionsMenuVisible: boolean
	innerButtons: PageInnerButton[]
	customGroups: PageCustomGroup[]
	icons: PageIcon[]
	fields: Record<string, any>
	views: Record<string, any>
	currentView: string | null
	// DOM nodes set by PageShell on mount. `pageForm` / `filters` are the
	// add_field mount targets; the rest back the legacy `page.*` element refs
	// (page.js setup_page) that consumers append DOM into.
	refs: {
		wrapper: HTMLElement | null
		pageWrapper: HTMLElement | null
		pageHead: HTMLElement | null
		pageBody: HTMLElement | null
		main: HTMLElement | null
		sidebar: HTMLElement | null
		footer: HTMLElement | null
		pageForm: HTMLElement | null
		filters: HTMLElement | null
		secondaryBtn: HTMLElement | null
	}
}

// The object `createPage` returns — same method names as `frappe.ui.Page`.
export interface Page {
	state: PageState
	[method: string]: any
}
