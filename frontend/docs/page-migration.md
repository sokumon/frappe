# Migrating the Frappe "Page" concept to Vue

Status: **Design** · Owner: vue-shell · Last updated: 2026-05-31

## 1. Background

In the legacy desk, the idea of a *page* is spread across four files. Every standard
view (Form, List, Report, Tree, Workspace) and every custom desk page is built on
top of them.

| File | Class / namespace | Responsibility |
|---|---|---|
| `frappe/public/js/frappe/views/container.js` | `frappe.views.Container` | Page **registry + switcher**. Keeps every page as a hidden `<div id="page-{route}">` under `#body`; `change_to(label)` hides the current page and shows the target, firing `show`/`hide`/`page-change`. Tracks `cur_page`, decides `has_sidebar()`. A manual, DOM-based router + keep-alive. |
| `frappe/public/js/frappe/views/pageview.js` | `frappe.views.Page`, `frappe.views.pageview` | Loader for **custom "Page" doctype** pages. `with_page` fetches/caches the Page doc; `show` injects `content`/`script`/`style` and fires `on_page_load`/`on_page_show`/`refresh`. Also `show_not_found` / `show_message_page`. |
| `frappe/public/js/frappe/ui/page.html` | — | The **chrome template**: head bar (title, breadcrumbs, indicator pill, menu dropdown, actions dropdown, primary/secondary buttons, filters, icon group) + body (sidebar, main-section, footer). |
| `frappe/public/js/frappe/ui/page.js` | `frappe.ui.Page`, `frappe.ui.make_app_page` | The **imperative API** every view uses to drive that chrome: `set_title`, `set_primary_action`, `add_menu_item`, `add_inner_button`, `add_action_icon`, `set_indicator`, `add_field`, `set_view`, … |

> `frappe/core/doctype/page/page.js` is the Page **doctype form controller** — unrelated
> form logic. It stays.

**Relationship:** Container decides *which* page div is visible → pageview/factory
create a page div and call `make_app_page` to build chrome inside it → the view holds a
`.page` reference and drives the chrome imperatively. `make_app_page` is consumed by
`form.js`, `factory.js`, `treeview.js`, `workspace.js`, `query_report.js`.

## 2. What the Vue shell already replaces

The `frontend/` app has already absorbed parts of this:

- **container.js** — superseded by vue-router + `src/router/compat.ts`. Mount/unmount =
  `add_page`/`change_to`; `router.afterEach` (`syncCompatState`) sets the `data-route` /
  `data-sidebar` body attrs and `cur_page` that `page-change` used to.
- **pageview.js (loader half)** — `src/pages/Page.vue` already ports the
  content/script/style injection and the `on_page_load`/`on_page_show`/`refresh` lifecycle.
- **Bridge pattern** — established by `OldDeskView.vue` (exposes a raw `el`) + `Form.vue`,
  which instantiates the legacy class into that `el` while reimplementing the chrome in
  Vue and monkeypatching `add_custom_button` / stubbing `page_api`.

So this is **not** a wholesale rewrite of `page.js`. It is: keep the imperative API
surface alive as a **bridge that writes into reactive state rendered by a shared Vue
chrome component.**

## 3. Target architecture

```
PageShell.vue            (props: PageOptions; owns reactive pageState)
 ├─ <Navbar>             ← always rendered; IS the .page-head
 │     ├─ title / breadcrumbs / indicator        (from pageState)
 │     └─ #container     ← configurable action region, filled two ways:
 │           • named slot  <template #navbar>…</template>   (new Vue views)
 │           • bridge      (legacy set_primary_action/add_inner_button → pageState)
 ├─ <Sidebar v-if="opts.sidebar">                ← layout-side-section, owned here
 │     <slot name="sidebar"/>
 └─ <main class="layout-main-section">
       <div ref="pageForm"/>   ← #page-form mount node (add_field target)
       <div ref="filters"/>    ← #filters mount node  (add_field target)
       <slot/>                 ← view body
```

`Navbar` and `Sidebar` are **standard, reusable components** (`src/components/`), not
page-specific wrappers — any view can use them directly, and PageShell composes them.
They are deliberately *not* named `PageNavbar`/`PageSidebar`.

### 3.1 `Navbar.vue` (standard component)

The `.page-head` from `page.html`, as a standalone reusable component. It "provides a
container": the action region is exposed **both** as a named slot (new Vue views inject
`<Button>`s directly) **and** as a bridge-driven render (legacy `set_primary_action` /
`add_inner_button` calls land in `pageState`; Navbar renders them). PageShell always
mounts exactly one Navbar — no view manages its own head bar.

Region mapping from `page.html`:

| `page.html` element | PageNavbar / pageState |
|---|---|
| `.title-area` / `.title-text` | `pageState.title` → breadcrumbs + `<h1>` |
| `.page-indicator-pill` | `pageState.indicator` → `<Badge :theme>` |
| `.primary-action` / `.btn-secondary` | `pageState.primaryAction` / `secondaryAction` → `<Button>` |
| `.menu-btn-group .dropdown-menu` | `pageState.menuItems[]` → `<Dropdown>` |
| `.actions-btn-group .dropdown-menu` | `pageState.actionItems[]` → `<Dropdown variant="solid">` |
| `.custom-actions` (inner toolbar) | `pageState.innerButtons[]` → buttons / grouped `<Dropdown>` |
| `.page-icon-group` | `pageState.icons[]` |
| `.filters` | `#filters` mount node |

### 3.2 `Sidebar.vue` (standard component, built on frappe-ui)

Owned by PageShell, gated by config. **Built on frappe-ui's `Sidebar`** — `Form.vue`
already imports `{ Sidebar } from 'frappe-ui'` and drives it with `:header` / `:sections`,
so our standard `Sidebar.vue` wraps that, supplying Frappe-specific defaults (module
header, workspace sections) while staying a thin, reusable layer. Replaces the
`add_main_section` branch (`page.js:97-128`) that chose `layout-main` vs
`layout-two-column`. `has_sidebar()` (`container.js:87`, currently a DOM probe) becomes
just `opts.sidebar`.

### 3.3 Configurable options

```ts
interface PageOptions {
  title?: string
  sidebar?: boolean            // default true; configurable per view
  sidebarPosition?: 'Left' | 'Right'
}
```

`make_app_page` maps legacy opts → new props so existing callers are untouched:

| Legacy opt | New prop |
|---|---|
| `single_column: true` | `sidebar: false` |
| (implicit two-column) | `sidebar: true` |
| `sidebar_position: "Right"` | `sidebarPosition: 'Right'` |
| `hide_sidebar` | folded into `sidebar: false` |
| `title` | `title` |
| `make_page()` cb | replaced by the view's `onMounted` |

```ts
frappe.ui.make_app_page = (opts) => (opts.parent.page =
  createPage({ ...opts,
               sidebar: !opts.single_column && !opts.hide_sidebar,
               sidebarPosition: opts.sidebar_position }))
```

## 4. The bridge — `createPage` / `usePage`

A factory exposing the **same method names** as `frappe.ui.Page`, each mutating a
reactive `pageState` instead of jQuery. `frappe.ui.make_app_page` is re-pointed at it so
all legacy consumers (`form.js`, `factory.js`, `treeview.js`, `workspace.js`,
`query_report.js`) keep working unchanged.

```ts
export function createPage(opts: PageOptions) {
  const state = reactive<PageState>({
    title: '', breadcrumbs: [], indicator: null,
    primaryAction: null, secondaryAction: null,
    menuItems: [], actionItems: [], innerButtons: [], icons: [],
    fields: {}, views: {}, currentView: null,
    refs: { pageForm: null, filters: null },   // set by PageShell on mount
  })

  return {
    state,
    set_title(t, icon, strip = true) { state.title = strip ? strip_html(t) : t; frappe.utils.set_title(t) },
    set_primary_action(label, click, icon, wl) { state.primaryAction = action(label, click, icon, wl); return ret(state.primaryAction) },
    set_secondary_action(label, click, icon, wl) { state.secondaryAction = action(label, click, icon, wl); return ret(state.secondaryAction) },
    clear_primary_action() { state.primaryAction = null },
    clear_actions() { state.primaryAction = state.secondaryAction = null },
    set_indicator(label, color) { state.indicator = { label, color } },
    clear_indicator() { state.indicator = null },
    add_menu_item(label, click, std, shortcut) { return ret(pushUnique(state.menuItems, item(label, click, shortcut))) },
    add_action_item(label, click) { return ret(push(state.actionItems, item(label, click))) },
    add_inner_button(label, fn, group, type = 'default') { return ret(push(state.innerButtons, { label, group, type, onClick: wrap(fn) })) },
    remove_inner_button(label, group) { state.innerButtons = state.innerButtons.filter(b => !(b.label === label && b.group === group)) },
    add_field(df, parent) {                                  // T3-mount, see §5
      const node = parent === 'filters' ? state.refs.filters : state.refs.pageForm
      const f = frappe.ui.form.make_control({ df, parent: node, only_input: df.fieldtype !== 'Check' })
      f.refresh(); state.fields[df.fieldname || df.label] = f; return f
    },
    // …show_menu/hide_menu/clear_menu toggle flags / empty arrays
  }
}
```

- `wrap(click)` reproduces `btn_disable_enable` (`page.js:593`): if the handler returns a
  promise, flip the action's reactive `disabled` until it resolves.
- `ret(item)` returns the **T2 proxy** (see §5) so the handful of callers that chain
  jQuery keep working.

## 5. Return-value audit

Most `.page.*` calls are fire-and-forget (**T0** — pure reactive state). The table below
is only the calls whose **return value is captured and used** — the set that can break
when `page.js` is deleted.

| # | Call site | Return used as | Tier | Bridge implication |
|---|---|---|---|---|
| 1 | `form.js:1555` `add_inner_button` | `if(btn) custom_buttons[label]=btn` | **T1** | any non-null handle. (Form.vue already overrides this method.) |
| 2 | `base_list.js:273` `add_menu_item` | `.addClass(item.class)` | **T2** | proxy `addClass` → `extraClass` |
| 3 | `base_list.js:243` `set_secondary_action` | `.addClass("hidden-xs"/"visible-xs")` | **T2** | proxy `addClass` |
| 4 | `toolbar.js:739` `set_secondary_action` | `.prop("disabled", true)` | **T2** | proxy `prop('disabled')` → `disabled` |
| 5 | `print_format…:18,21` `add_button` ×2 | `.hide()` / `.show()` | **T2** | proxy `hide/show` → `visible` |
| 6 | `list_view.js:173` `add_actions_menu_item` | `.addClass`, `.closest("li")`, `.toggle()` | **T2→T3** | migrate workflow-action lines (`list_view.js:175-179, 2280-2283`) to a reactive `visible` flag |
| 7 | `list_view.js:292` `set_primary_action` | `.append()`, `getBoundingClientRect()`, `.find("span").text()` (`_trim_primary_action_if_overflow`, `:332`) | **T3** | drop overflow-trim; let `Button` truncate via CSS |
| 8 | `form.js:1579` `is_in_group_button_dropdown` | `.parent().parent().next(".dropdown-divider").remove()` | **T3** | migrate `remove_custom_button` cleanup to a `menuItems` splice |
| 9 | `list_view_select.js:14` `add_custom_menu_item` | `.parent().attr("data-view", view)` | **T3** | model as `item.data = { view }`, render as attr |
| 10 | `list_view_select.js:170` `add_custom_button_group` | passed as `parent` to `add_custom_menu_item` | **T3** | return a group handle/id; children target it in state |
| 11 | `toolbar.js:208` `add_action_icon` | `.css()`, `.addClass()`, **`element.append()`** (into form title) | **T3-relocate** | not page chrome — render in Form title; bridge returns detached `<button>` during transition |
| 12 | `form_sidebar.js:103` `add_action_icon` | `.css()`, `.addClass()`, **`sidebar.find(".form-print").append()`** | **T3-relocate** | render in Form sidebar; same transition shim |
| 13 | `add_field` ×6 (`treeview.js:183-185`, `query_report.js:547-549`, `base_list.js:1157,1259`) | real control: `.get_value()`, `.set_input()`, `.$input` | **T3-mount** | real control mounted into `#filters`/`#page-form` (§4) |

### Tiers

- **T0/T1 — plain reactive handle.** Default; the handle is the object in
  `state.menuItems`/`primaryAction`/etc.
- **T2 — thin proxy** the bridge returns instead of bare state, exposing only the jQuery
  methods callers actually chain — `addClass`, `prop`, `hide/show` — each setting a
  reactive field (`extraClass`, `disabled`, `visible`). ~6 sites, one ~15-line factory.
- **T3 — real DOM / migrate the consumer.** ~8 sites:
  - **mount** (`add_field`): real node — already in the plan.
  - **relocate** (`add_action_icon`, #11–12): **does not belong in PageShell** — both
    consumers append the icon into the *form's* title/sidebar. Render natively in Form's
    own components; have the bridge return a detached real `<button>` so legacy `.append()`
    works during transition, then delete `add_action_icon`.
  - **rewrite** (#7,8,9,10): each is one localized jQuery idiom; migrate the ~4 consumers
    to reactive state.

**Net risk surface for deleting `page.js`: ~8 sites, 2 of which (`add_action_icon`)
shouldn't go through page chrome at all.**

## 6. pageview.js + container.js retirement

**container.js** — already gone in spirit (vue-router). Remaining:

1. **Keep-alive parity.** Legacy *hid* page divs, preserving DOM/JS state on
   back-navigation; Vue destroys components. Wrap `<router-view>` in `<keep-alive>` in
   `App.vue` *only where a view depends on it* (list filters, report state). Map legacy
   `show`/`hide` → `onActivated`/`onDeactivated`.
2. **`has_sidebar()`** → declarative `opts.sidebar` / presence of `#sidebar` slot; sets
   the `data-sidebar` body attr from that prop.

**pageview.js** — loader/lifecycle already in `Page.vue`. Remaining:

- Wrap `Page.vue`'s body in `PageShell` so a custom page's script calling
  `make_app_page` lands on the bridge; register `frappe.pages[name]`.
- `show_not_found` / `show_not_permitted` / `show_message_page` → a small
  `MessagePage.vue` (or extend `NotFound.vue`) with `{ message, img }` props; deletes the
  `repl()` string builders.

## 7. Phased plan

1. **PageShell + components.** Standard `Navbar.vue` and `Sidebar.vue` (the latter on top
   of frappe-ui's `Sidebar`), then `PageShell.vue` + `PageOptions`.
2. **Bridge.** `createPage` + T2 proxy; re-point `frappe.ui.make_app_page` and
   `frappe.ui.Page`. Legacy views now render through Vue chrome while still importing the
   old files.
3. **Prove it on Form.vue.** Refactor its ad-hoc `<nav>` onto `PageShell`; move
   print/edit icons to native Vue (retires #11–12).
4. **Wire the rest.** `Page.vue`, `ListView`, `QueryReport`, `Workspace`, `treeview`
   through PageShell; migrate the T3-rewrite consumers (#7–10).
5. **Keep-alive + MessagePage.**
6. **Delete** `page.html`, `container.js`, `pageview.js`, `page.js` once a grep confirms
   zero references to `page.html`, `frappe.views.Container`, `frappe.views.pageview`.

## 8. Open questions

- Keep-alive: opt-in per route, or global with explicit `onDeactivated` cleanup?
- `set_view`/`add_view` (1 consumer, `toolbar.js:794`): bridge as a DOM mount like
  `add_field`, or rewrite that single caller?
- Do we preserve the mobile-specific behaviours (`hidden-xl` menu mirroring of inner
  buttons, mobile awesomebar) or redesign them in the Vue chrome?
