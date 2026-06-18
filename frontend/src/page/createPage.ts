// The bridge (page-migration.md §4).
//
// `createPage` exposes the same method surface as the legacy `frappe.ui.Page`,
// but each method mutates a reactive `PageState` instead of jQuery. The chrome
// (Navbar / PageShell) renders that state. `installPageBridge` re-points
// `frappe.ui.make_app_page` / `frappe.ui.Page` at this factory so every legacy
// consumer (form.js, factory.js, treeview.js, workspace.js, query_report.js)
// keeps working unchanged.

import { reactive } from 'vue'
import type {
	Page,
	PageAction,
	PageCustomGroup,
	PageInnerButton,
	PageMenuItem,
	PageOptions,
	PageState,
} from './types'

// Monotonic id for custom button groups; the id is the handle returned to
// callers (add_custom_button_group) so children can target the group.
let nextGroupId = 1

function stripHtml(text: string): string {
	if (frappe?.utils?.strip_html) return frappe.utils.strip_html(text)
	return String(text ?? '').replace(/<[^>]*>/g, '')
}

// Legacy global translation helper `__`; falls back to the raw label.
function translate(text: string, _replace?: any, _context?: any): string {
	const fn = (window as any).__ as ((...a: any[]) => string) | undefined
	return fn ? fn(text, _replace, _context) : text
}

// Wrap a DOM node in jQuery (shipped globally by the desk bundles) so legacy
// `page.main.append()` / `page.sidebar.find()` chains keep working. A null node
// (ref not mounted yet) becomes an empty jQuery set rather than null, so the
// element refs stay non-null and chainable. Falls back to the raw node only if
// jQuery is unavailable.
//
// `page` is stamped back onto the returned object as `.page`, so a page script
// that receives an element from an event (e.g. on_page_load(main)) can reach
// the bridge page via `main.page` — jQuery wrapping otherwise drops the `.page`
// property set on the raw node.
//
// The wrapper is memoised per node: `$(node)` builds a fresh object every call,
// so a custom property a page script sets on `page.main` in on_page_load would
// be lost by the next access (refresh). Returning the same wrapper instance for
// a given node keeps those properties alive across events.
const wrapperCache = new WeakMap<HTMLElement, any>()

function $wrap(node: HTMLElement | null, page?: Page) {
	const jq = (window as any).$ || (window as any).jQuery
	if (!jq) return node
	if (!node) return jq(node) // empty set; nothing to cache against

	let wrapped = wrapperCache.get(node)
	if (!wrapped) {
		wrapped = jq(node)
		wrapperCache.set(node, wrapped)
	}
	if (page) wrapped.page = page
	return wrapped
}

// Reproduces page.js `btn_disable_enable` (:593): if the handler returns a
// promise, flip the action's reactive `disabled` until it resolves.
function wrap(
	target: { disabled: boolean },
	click?: (...args: any[]) => any,
): (...args: any[]) => any {
	return (...args: any[]) => {
		const result = click?.(...args)
		if (result && typeof result.then === 'function') {
			target.disabled = true
			Promise.resolve(result).finally(() => {
				target.disabled = false
			})
		}
		return result
	}
}

function makeAction(
	label: string,
	click?: (...args: any[]) => any,
	icon?: string,
	workingLabel?: string,
): PageAction {
	const action = reactive<PageAction>({
		label,
		icon,
		workingLabel,
		onClick: () => {},
		disabled: false,
		visible: true,
		extraClass: '',
		listeners: {},
	})
	action.onClick = wrap(action, click)
	return action
}

function makeMenuItem(
	label: string,
	click?: (...args: any[]) => any,
	shortcut?: string,
	standard?: boolean,
	icon?: string,
): PageMenuItem {
	return reactive<PageMenuItem>({
		label,
		onClick: (...args: any[]) => click?.(...args),
		shortcut,
		standard,
		icon,
		extraClass: '',
		visible: true,
		data: {},
	})
}

// T2 proxy (page-migration.md §5): the thin jQuery-ish handle the bridge hands
// back to the ~6 call sites that chain `.addClass()` / `.prop()` / `.hide()`.
// Each method maps to a reactive field and returns `this` for chaining.
function ret<T>(target: T): T {
	const item = target as Record<string, any>
	const proxy = {
		addClass(cls: string) {
			item.extraClass = [item.extraClass, cls].filter(Boolean).join(' ')
			return proxy
		},
		removeClass(cls: string) {
			item.extraClass = String(item.extraClass || '')
				.split(/\s+/)
				.filter((c) => c && c !== cls)
				.join(' ')
			return proxy
		},
		prop(name: string, value: any) {
			if (name === 'disabled') item.disabled = value
			return proxy
		},
		attr(name: string, value: any) {
			item.data = { ...(item.data || {}), [name]: value }
			return proxy
		},
		// legacy `$el.parent()` walked from an <a> to its wrapping <li>; the flat
		// menu item has no wrapper, so `.parent()` returns the same proxy and a
		// following `.attr()` tags the item's data bag (e.g. ListViewSelect's
		// add_view_to_menu `data-view` marker).
		parent() {
			return proxy
		},
		hide() {
			item.visible = false
			return proxy
		},
		show() {
			item.visible = true
			return proxy
		},
		toggle(show?: boolean) {
			item.visible = show === undefined ? !item.visible : show
			return proxy
		},
		// jQuery-style `.on('click', fn)`. Handlers are stored reactively and
		// bound by the renderer with v-on, so they survive Vue re-renders (a raw
		// node-level .on() would be dropped when the button is patched). Space-
		// separated event names are supported, mirroring jQuery.
		on(events: string, handler: (...args: any[]) => any) {
			const bag = (item.listeners ||= {})
			for (const event of events.split(/\s+/).filter(Boolean)) {
				;(bag[event] ||= []).push(handler)
			}
			return proxy
		},
		off(events?: string, handler?: (...args: any[]) => any) {
			if (!item.listeners) return proxy
			if (!events) {
				item.listeners = {}
				return proxy
			}
			for (const event of events.split(/\s+/).filter(Boolean)) {
				if (!handler) delete item.listeners[event]
				else if (item.listeners[event]) {
					item.listeners[event] = item.listeners[event].filter((h: any) => h !== handler)
				}
			}
			return proxy
		},
	}
	return proxy as unknown as T
}

// page.js `add_custom_button_group` returns the jQuery `.dropdown-menu` element.
// Legacy callers (ListViewSelect) both pass that return value back as the
// `parent` of `add_custom_menu_item` AND chain jQuery-ish ops on it
// (`.parent()`, `.attr()`, `.find()`, `.empty()`). This proxy reproduces that
// surface over the reactive group, so no legacy JS edits are needed. `__group`
// lets `get_custom_button_group` resolve the handle back to its group; same
// T2-proxy spirit as ret() (page-migration.md §5).
function menuHandle(group: PageCustomGroup) {
	const proxy: any = {
		__group: group,
		get id() {
			return group.id
		},
		// The `.dropdown-menu` and its `.custom-btn-group` wrapper both collapse to
		// the one group here, so walking up/into the tree returns the same proxy —
		// and the proxy is itself a valid `add_custom_menu_item` parent.
		parent() {
			return proxy
		},
		find() {
			return proxy
		},
		attr(name: string, value?: any) {
			if (value === undefined) return group.data?.[name]
			group.data = { ...(group.data || {}), [name]: value }
			return proxy
		},
		empty() {
			group.items = []
			return proxy
		},
		append() {
			return proxy
		},
		addClass() {
			return proxy
		},
		// page.js toggles the `hide` class on the group wrapper to show/hide it.
		removeClass(cls?: string) {
			if (cls === 'hide') group.visible = true
			return proxy
		},
		toggleClass(cls: string, on?: boolean) {
			if (cls === 'hide') group.visible = on === undefined ? !group.visible : !on
			return proxy
		},
		hide() {
			group.visible = false
			return proxy
		},
		show() {
			group.visible = true
			return proxy
		},
	}
	return proxy
}

function push<T>(list: T[], item: T): T {
	list.push(item)
	return item
}

function pushUnique(list: PageMenuItem[], item: PageMenuItem): PageMenuItem {
	const existing = list.find((i) => i.label === item.label)
	if (existing) return existing
	list.push(item)
	return item
}

export function createPage(opts: PageOptions = {}): Page {
	const state = reactive<PageState>({
		title: opts.title ?? '',
		subtitle: '',
		titleIcon: '',
		indicator: null,
		innerMessage: '',
		primaryAction: null,
		secondaryAction: null,
		menuItems: [],
		actionItems: [],
		actionsMenuVisible: false,
		innerButtons: [],
		customGroups: [],
		icons: [],
		fields: {},
		views: {},
		currentView: null,
		refs: {
			wrapper: null,
			pageWrapper: null,
			pageHead: null,
			pageBody: null,
			main: null,
			sidebar: null,
			footer: null,
			pageForm: null,
			filters: null,
		},
	})

	// Handlers registered via on_actions_menu_show; Navbar calls
	// page.fire_actions_menu_show() when the actions dropdown opens (the vue
	// equivalent of Bootstrap's show.bs.dropdown).
	const actionsMenuShowHandlers: Array<() => void> = []

	const page: Page = {
		state,

		// --- DOM element refs (page.js setup_page) ----------------------------
		// Real layout nodes, wrapped in jQuery for legacy `.append()`/`.find()`
		// chains. Populated by PageShell on mount. The chrome action bits
		// (buttons / menu / indicator / icon group) are rendered reactively from
		// `state` and driven via the methods below — they are intentionally NOT
		// exposed here as raw nodes.
		get wrapper() {
			return $wrap(state.refs.wrapper, page)
		},
		// The #page-wrapper column (navbar + main + footer) — the closest analog
		// to the legacy page div handed to on_page_load(wrapper).
		get page_wrapper() {
			return $wrap(state.refs.pageWrapper, page)
		},
		get page_head() {
			return $wrap(state.refs.pageHead, page)
		},
		// The .page-body element (page.html) — the node that carries the page
		// identity (id / data-page-route) and the show/hide events.
		get page_body() {
			return $wrap(state.refs.pageBody, page)
		},
		// page.js: this.body = this.main = this.wrapper.find(".layout-main-section")
		// Resolve the section from the wrapper so main/body always point at the
		// real .layout-main-section, falling back to the tracked ref.
		get main() {
			const section = state.refs.wrapper?.querySelector<HTMLElement>('.layout-main-section')
			return $wrap(section ?? state.refs.main, page)
		},
		get body() {
			return this.main
		},
		get container() {
			return $wrap(state.refs.wrapper, page)
		},
		get sidebar() {
			return $wrap(state.refs.sidebar, page)
		},
		get footer() {
			return $wrap(state.refs.footer, page)
		},
		get page_form() {
			return $wrap(state.refs.pageForm, page)
		},
		get filters() {
			return $wrap(state.refs.filters, page)
		},

		// --- title / indicator -------------------------------------------------
		set_title(title: string, icon?: string, strip = true) {
			state.title = strip ? stripHtml(title) : title
			if (icon) state.titleIcon = icon
			frappe?.utils?.set_title?.(title)
		},
		get_title() {
			return state.title
		},
		set_indicator(label: string, color?: string) {
			state.indicator = { label, color }
		},
		clear_indicator() {
			state.indicator = null
		},

		// --- primary / secondary actions --------------------------------------
		set_primary_action(
			label: string,
			click?: (...args: any[]) => any,
			icon?: string,
			workingLabel?: string,
		) {
			state.primaryAction = makeAction(label, click, icon, workingLabel)
			return ret(state.primaryAction)
		},
		set_secondary_action(
			label: string,
			click?: (...args: any[]) => any,
			icon?: string,
			workingLabel?: string,
		) {
			state.secondaryAction = makeAction(label, click, icon, workingLabel)
			return ret(state.secondaryAction)
		},
		clear_primary_action() {
			state.primaryAction = null
		},
		clear_secondary_action() {
			state.secondaryAction = null
		},
		clear_actions() {
			state.primaryAction = null
			state.secondaryAction = null
		},

		// --- menu / action dropdowns ------------------------------------------
		add_menu_item(
			label: string,
			click?: (...args: any[]) => any,
			standard?: boolean,
			shortcut?: string,
		) {
			return ret(pushUnique(state.menuItems, makeMenuItem(label, click, shortcut, standard)))
		},
		add_action_item(label: string, click?: (...args: any[]) => any) {
			return ret(push(state.actionItems, makeMenuItem(label, click)))
		},
		clear_menu() {
			state.menuItems = []
		},
		show_menu() {},
		hide_menu() {},

		// --- inner toolbar buttons --------------------------------------------
		add_inner_button(
			label: string,
			fn?: (...args: any[]) => any,
			group?: string,
			type = 'default',
		) {
			const button = reactive<PageInnerButton>({
				label,
				group,
				type,
				onClick: () => {},
				disabled: false,
				visible: true,
			})
			button.onClick = wrap(button, fn)
			return ret(push(state.innerButtons, button))
		},
		// page.js add_button(label, click, opts): a standalone custom-action
		// button with optional icon / btn classes. Legacy also mirrors it as a
		// `hidden-xl` menu item for mobile; the Vue chrome has no responsive
		// hidden-xl switch yet, so that mirror is omitted to avoid a permanent
		// duplicate in the menu (see page-migration.md §8, mobile open question).
		add_button(label: string, click?: (...args: any[]) => any, opts: any = {}) {
			const button = reactive<PageInnerButton>({
				label,
				type: 'default',
				icon: opts.icon,
				btnClass: [opts.btn_class, opts.btn_size].filter(Boolean).join(' ') || undefined,
				onClick: () => {},
				disabled: false,
				visible: true,
			})
			button.onClick = wrap(button, click)
			return ret(push(state.innerButtons, button))
		},
		remove_inner_button(label: string, group?: string) {
			state.innerButtons = state.innerButtons.filter(
				(b) => !(b.label === label && b.group === group),
			)
		},
		clear_inner_toolbar() {
			state.innerButtons = []
		},
		// page.js: custom_actions.addClass("hide").empty() — the inner toolbar IS
		// custom_actions, so this clears the same reactive list.
		clear_custom_actions() {
			state.innerButtons = []
		},
		// page.js change_inner_button_type(label, group, type): retag a standalone
		// inner button, or an item inside a custom group, to a new btn type.
		change_inner_button_type(label: string, group: string | undefined, type: string) {
			if (group) {
				const g = state.customGroups.find((cg) => cg.label === group)
				const item = g?.items.find((i) => i.label === label)
				if (item) item.extraClass = `btn-${type}`
				return
			}
			const button = state.innerButtons.find((b) => b.label === label && !b.group)
			if (button) {
				button.type = type
				button.btnClass = `btn-${type}`
			}
		},

		// --- custom button groups (page.js add_custom_button_group, §5 #10) ----
		// page.js returns the jQuery `.dropdown-menu`; we return a menuHandle proxy
		// over the reactive group that matches that surface — usable as an
		// add_custom_menu_item `parent` AND chainable (.parent()/.attr()/.find()/
		// .empty()), so ListViewSelect works unchanged.
		add_custom_button_group(label: string, icon?: string, parent?: string) {
			const existing = state.customGroups.find((g) => g.label === label && g.parent === parent)
			if (existing) return menuHandle(existing)
			const group = reactive<PageCustomGroup>({
				id: nextGroupId++,
				label,
				icon,
				parent,
				primary: false,
				visible: true,
				items: [],
			})
			state.customGroups.push(group)
			return menuHandle(group)
		},
		// Resolve a group by the menuHandle returned from add_custom_button_group,
		// or (back-compat) by its numeric id or label.
		get_custom_button_group(parent: number | string | { __group?: PageCustomGroup }) {
			if (parent && typeof parent === 'object') {
				return parent.__group
			}
			return state.customGroups.find((g) => g.id === parent || g.label === parent)
		},
		add_custom_menu_item(
			parent: number | string | { __group?: PageCustomGroup },
			label: string,
			click?: (...args: any[]) => any,
			standard?: boolean,
			shortcut?: string,
			icon?: string,
		) {
			const group = this.get_custom_button_group(parent)
			if (!group) return ret(makeMenuItem(label, click, shortcut, standard, icon))
			return ret(pushUnique(group.items, makeMenuItem(label, click, shortcut, standard, icon)))
		},
		set_inner_btn_group_as_primary(label: string) {
			const group = state.customGroups.find((g) => g.label === label)
			if (group) group.primary = group.items.length > 0
		},
		add_divider_to_button_group(group: string) {
			const g = state.customGroups.find((cg) => cg.label === group)
			if (g) push(g.items, makeMenuItem('---'))
		},

		// --- generic dropdown item (page.js add_dropdown_item) -----------------
		// `parent` may be a custom-group handle/label, or one of the named
		// regions 'menu' / 'actions'. Routes the item to the right reactive list.
		add_dropdown_item(opts: {
			label: string
			click?: (...args: any[]) => any
			standard?: boolean
			parent: number | string | { __group?: PageCustomGroup }
			shortcut?: string
			icon?: string
		}) {
			const { label, click, standard, parent, shortcut, icon } = opts
			if (parent === 'menu') return this.add_menu_item(label, click, standard, shortcut)
			if (parent === 'actions') return this.add_action_item(label, click)
			return this.add_custom_menu_item(parent, label, click, standard, shortcut, icon)
		},

		// --- visibility toggles (page.js show_/hide_*) -------------------------
		// The icon group is v-if'd on list length in Navbar, so these stay no-ops
		// kept for API parity; callers that truly need to force-hide a populated
		// group should clear it instead. The actions menu, however, is hidden by
		// default and gated on actionsMenuVisible (list view shows it only while
		// rows are selected).
		show_icon_group() {},
		hide_icon_group() {},
		show_actions_menu() {
			state.actionsMenuVisible = true
		},
		hide_actions_menu() {
			state.actionsMenuVisible = false
		},
		// The actions dropdown trigger element, for legacy code that binds to it.
		get actions_btn_group() {
			return $wrap(
				state.refs.pageHead?.querySelector<HTMLElement>('.actions-btn-group') ?? null,
				page,
			)
		},
		// Register a handler fired when the actions dropdown opens (replaces the
		// legacy `actions_btn_group.on("show.bs.dropdown")`). Navbar calls
		// fire_actions_menu_show() on open.
		on_actions_menu_show(handler: () => void) {
			actionsMenuShowHandlers.push(handler)
		},
		fire_actions_menu_show() {
			actionsMenuShowHandlers.forEach((fn) => fn())
		},
		add_actions_menu_item(label: string, click?: (...args: any[]) => any) {
			return this.add_action_item(label, click)
		},
		clear_actions_menu() {
			state.actionItems = []
		},
		// page.js clear_user_actions: remove non-standard (user-added) menu items.
		clear_user_actions() {
			state.menuItems = state.menuItems.filter((i) => i.standard)
		},

		// --- icons -------------------------------------------------------------
		add_action_icon(icon: string, click?: (...args: any[]) => any, tooltip?: string) {
			return ret(push(state.icons, reactive({ icon, onClick: click, tooltip })))
		},
		// page.js: icon_group.addClass("hide").empty() — emptying the reactive
		// list hides the (v-if'd) group, so no separate "hide" flag is needed.
		clear_icons() {
			state.icons = []
		},

		// --- fields (T3-mount, §4) --------------------------------------------
		// `page_form` / `filters` are the real mount nodes (set by PageShell);
		// `fields_dict` mirrors legacy page.js so callers reading
		// `page.fields_dict[name]` keep working.
		get fields_dict() {
			return state.fields
		},

		// page.js toggles a `hide` class on page_form; mirror that on the node.
		show_form() {
			$wrap(state.refs.pageForm, page).removeClass?.('hide')
		},
		hide_form() {
			$wrap(state.refs.pageForm, page).addClass?.('hide')
		},
		// page.js restyle_field: relax a field's grid styling when it lives in
		// the filter bar (narrower select, nudged select-icon).
		restyle_field(f: any) {
			const jq = (window as any).$ || (window as any).jQuery
			if (!jq || !f?.wrapper) return
			jq(f.wrapper).removeClass('col-md-2').css('margin', '0px')
			jq(f.wrapper).find('select').css('width', '140px')
			jq(f.wrapper).find('.select-icon').css('top', '2px')
		},
		clear_fields() {
			$wrap(state.refs.pageForm, page).empty?.()
			state.fields = {}
		},
		get_form_values() {
			const values: Record<string, any> = {}
			for (const fieldname in state.fields) {
				values[fieldname] = state.fields[fieldname].get_value()
			}
			return values
		},

		// page::form helpers (page.js add_label/add_select/.../add_field) ------
		add_label(label: string) {
			this.show_form()
			return $wrap(state.refs.pageForm, page).append(
				`<label class='col-md-1 page-only-label'>${label} </label>`,
			)
		},
		add_select(label: string, options: any[]) {
			const field = this.add_field({ label, fieldtype: 'Select' })
			return field.$wrapper.find('select').empty().add_options(options)
		},
		add_data(label: string) {
			const field = this.add_field({ label, fieldtype: 'Data' })
			return field.$wrapper.find('input').attr('placeholder', label)
		},
		add_date(label: string, date?: string) {
			const field = this.add_field({ label, fieldtype: 'Date', default: date })
			return field.$wrapper.find('input').attr('placeholder', label)
		},
		add_check(label: string) {
			const jq = (window as any).$ || (window as any).jQuery
			return jq(
				`<div class='checkbox'><label><input type='checkbox'>${label}</label></div>`,
			)
				.appendTo($wrap(state.refs.pageForm, page))
				.find('input')
		},
		add_break() {
			$wrap(state.refs.pageForm, page).append('<div class="clearfix invisible-xs"></div>')
		},
		add_field(df: any, parent?: HTMLElement | null) {
			this.show_form()

			if (!df.placeholder) df.placeholder = df.label
			df.input_class = 'input-xs'

			const parentNode = parent || state.refs.pageForm
			const f = frappe.ui.form.make_control({
				df,
				parent: parentNode,
				only_input: df.fieldtype !== 'Check',
			})
			f.refresh()

			const jq = (window as any).$ || (window as any).jQuery
			jq(f.wrapper)
				.addClass('col-md-2')
				.attr('title', translate(df.label, null, df.parent))
				.tooltip?.({ delay: { show: 600, hide: 100 }, trigger: 'hover' })

			if (parentNode === state.refs.filters) this.restyle_field?.(f)

			// HTML fields in the toolbar are display-only.
			if (df.fieldtype === 'HTML') return

			// hidden fields don't have $input
			if (!f.$input) f.make_input()
			f.$input.attr('placeholder', translate(df.label, null, df.parent))

			if (df.fieldtype === 'Check') {
				jq(f.wrapper).find(':first-child').removeClass('col-md-offset-4 col-md-8')
			}
			if (df.fieldtype === 'Button') {
				jq(f.wrapper).find('.page-control-label').html('&nbsp;')
				f.$input.addClass('btn-xs').css({ width: '100%', 'margin-top': '-1px' })
			}

			if (df['default']) f.set_input(df['default'])
			state.fields[df.fieldname || df.label] = f
			return f
		},
		get_field(fieldname: string) {
			return state.fields[fieldname]
		},

		// --- views (page.js add_view/set_view, §8 open question) --------------
		// Mounts a view's element into the main section and toggles between
		// named views. Only set_view("main") has a live consumer (toolbar.js).
		add_view(name: string, html: any) {
			const jq = (window as any).$ || (window as any).jQuery
			const element = typeof html === 'string' && jq ? jq(html) : html
			const host = $wrap(state.refs.main, page)
			element?.appendTo?.(host)
			state.views[name] = element
			if (!state.currentView) {
				state.currentView = name
			} else {
				element?.toggle?.(false)
			}
			return element
		},
		set_view(name: string) {
			if (state.currentView === name) return
			state.views[state.currentView as string]?.toggle?.(false)
			state.currentView = name
			state.views[name]?.toggle?.(true)
			$wrap(state.refs.wrapper, page).trigger?.('view-change')
		},

		// --- title extras (page.js set_title_sub/get_title_area/get_main_icon) -
		set_title_sub(txt: string) {
			state.subtitle = txt || ''
		},
		get_title_area() {
			return $wrap(state.refs.pageHead, page)
		},
		get_main_icon(icon: string) {
			state.titleIcon = icon
			return state.titleIcon
		},
		// page.js add_help_button is itself a no-op; kept for API parity.
		add_help_button(_txt?: string) {},

		// --- inner-toolbar message (page.js add_inner_message) -----------------
		add_inner_message(message: string) {
			state.innerMessage = message
			return message
		},

		// --- dropdown button: delegate to the legacy toolbar helper ------------
		add_dropdown_button(parent: any, label: string, click: any, icon?: string) {
			return frappe?.ui?.toolbar?.add_dropdown_button?.(parent, label, click, icon)
		},

		// --- empty state (page.js get_empty_state) -----------------------------
		get_empty_state(title: string, message: string, primaryAction?: string) {
			const jq = (window as any).$ || (window as any).jQuery
			const html = `<div class="page-card-container">
				<div class="page-card">
					<div class="page-card-head">
						<span class="indicator blue">${title}</span>
					</div>
					<p>${message}</p>
					<div>
						<button class="btn btn-primary btn-sm">${primaryAction ?? ''}</button>
					</div>
				</div>
			</div>`
			return jq ? jq(html) : html
		},
	}

	return page
}

// Re-point the legacy entry points at the bridge (page-migration.md §3.3).
// Call once after the desk bundles have defined `frappe.ui`.
export function installPageBridge() {
	const f = window.frappe
	if (!f) return
	f.ui = f.ui || {}

	f.ui.make_app_page = (opts: PageOptions = {}) => {
		// `parent` may be a DOM node or a jQuery object — page scripts get
		// page.main (jQuery-wrapped) in on_page_load. Resolve to the element so
		// the `.page` PageShell stamped on it is found.
		const parent = opts.parent
		const parentEl = parent?.jquery ? parent.get(0) : parent

		// If the node already has a page (PageShell bound one before the script
		// ran), reuse it so the script drives that chrome instead of a detached
		// page no Navbar renders.
		const existing = parentEl?.page || parent?.page
		if (existing) return existing

		const page = createPage({
			...opts,
			sidebar: !opts.single_column && !opts.hide_sidebar,
			sidebarPosition: opts.sidebar_position,
		})

		// Legacy parity: `this.wrapper = $(this.parent)`. PageShell-hosted pages
		// get their refs from onMounted, but a plain `parent` (the detached
		// add_page fallback / any non-Vue host) has none — seed wrapper + main
		// from it so `page.wrapper` is a real jQuery element, not an empty set.
		if (parentEl instanceof HTMLElement && !page.state.refs.wrapper) {
			page.state.refs.wrapper = parentEl
			page.state.refs.pageBody = parentEl
			page.state.refs.main =
				parentEl.querySelector<HTMLElement>('.layout-main-section') ?? parentEl
		}

		if (parentEl) parentEl.page = page
		else if (parent) parent.page = page
		return page
	}

	// Legacy `new frappe.ui.Page(opts)` — returning an object from the
	// constructor replaces `this`, so callers get the bridge page.
	f.ui.Page = function (this: any, opts: PageOptions = {}) {
		return f.ui.make_app_page(opts)
	} as any

	installContainer(f)
}

// Legacy `frappe.container` shim (replaces views/container.js). Standard pages
// (`frappe.standard_pages[name]`) call `add_page(name)` to get their wrapper,
// render into `wrapper.find(".layout-main-section")`, bind a "show" handler, and
// rely on `change_to(name)` to fire it. In the vue shell the wrapper is the
// PageShell element the view pre-registers in `frappe.pages`; `add_page` returns
// that (falling back to a detached div for any caller without a Vue host).
function installContainer(f: any) {
	f.pages = f.pages || {}
	f.container = f.container || {}
	if (f.container.page === undefined) f.container.page = null

	f.container.add_page = (label: string) => {
		// A view (e.g. Workspace.vue) may have pre-registered its PageShell
		// wrapper in frappe.pages[label]; reuse that. Otherwise build the legacy
		// detached container with a main section so `wrapper.find(".layout-
		// main-section")` still resolves.
		let page = f.pages[label]
		if (!page) {
			page = document.createElement('div')
			page.className = 'content page-container'
			const main = document.createElement('div')
			main.className = 'layout-main-section'
			page.appendChild(main)
			f.pages[label] = page
		}
		// legacy add_page stamps these on every wrapper it returns — whether the
		// fresh div above or the pre-registered PageShell wrapper (workspaces).
		debugger
		page.id = page.id || 'page-' + label
		page.setAttribute?.('data-page-route', label)
		page.label = label
		page.page_name = page.page_name || label
		return page
	}

	f.container.change_to = (label: any) => {
		const jq = (window as any).$ || (window as any).jQuery
		const page = label?.tagName ? label : f.pages[label]
		if (!page) return
		// hide the previously shown page, then show + trigger the new one
		if (f.container.page && f.container.page !== page) {
			jq?.(f.container.page).trigger('hide')
		}
		f.container.page = page
		jq?.(page).trigger('show')
		return page
	}
}
