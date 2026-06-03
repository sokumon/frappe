# Migrating the list filter bar — the inner-toolbar / scope problem

Status: **Blocked on a design decision** · Owner: vue-shell · Last updated: 2026-06-04

This documents why un-gating the last three `frappe.vue_shell` hacks in
`base_list.js` is not a mechanical change, the issues found while attempting it,
and the options for finishing it. It is a companion to
[`page-migration.md`](./page-migration.md).

## 1. Goal

Remove the three remaining `if (frappe.vue_shell) return;` gates in
`frappe/public/js/frappe/list/base_list.js`:

| Method | What it builds |
|---|---|
| `setup_filter_area()` | the filter bar — `new FilterArea(this)` |
| `setup_sort_selector()` | the sort dropdown — `new frappe.ui.SortSelector(...)` |
| `setup_list_filter_by()` | saved filters — `new ListFilter(this)` |

These are gated because they are **legacy jQuery widgets** that render into page
chrome and call jQuery-DOM methods (`.parent()`, `.append()`, `.find()`) on
whatever the bridge hands back. To un-gate them, the bridge has to satisfy what
they touch.

> Unlike the earlier `base_list.js` cleanups (`setup_page`, `setup_page_head`,
> `setup_view_menu`), these three are **not** dead code — they guard real,
> unmigrated UI.

## 2. The core blocker: reactive handles can't be traversed as DOM

The bridge's inner-toolbar methods (`add_inner_button`,
`add_custom_button_group`, `add_custom_menu_item`) returned the **T2 reactive
proxy** — an object exposing `addClass` / `prop` / `hide` that mutate reactive
state. It has **no DOM identity**: no `.parent()`, `.append()`, `.find()`.

The filter widgets are written against jQuery nodes:

```js
// list_filter.js (saved filters)
this.saved_filters_btn = this.list_view.page.add_inner_button("Filters", [], "Saved Filters");
// ...later...
const $menu = this.saved_filters_btn.parent();   // walk up to the dropdown
$menu.empty();                                    // inject saved-filter markup
```

`saved_filters_btn.parent()` is `undefined` on the proxy → `.empty()` throws.
The saved-filters dropdown fundamentally needs a **live DOM node** to walk up
from and append into.

Same shape elsewhere:

- `add_custom_button_group(label, icon, parent)` is called with a **real DOM
  node** as `parent` — `this.list_view.$filter_section`
  (`list_view_select.js:170`, the kanban switcher). It must render into the
  *filter section*, not the navbar. The reactive version ignored `parent`.
- `add_custom_menu_item(parent, …)` appends `<a class="dropdown-item">` into
  that group's `.dropdown-menu` node.

**Conclusion:** these consumers cannot be served by a reactive abstraction.
`add_inner_button` (and the whole custom-actions subsystem) has to return **real
jQuery DOM nodes**. That is the decision "return a jQuery object in
add_inner_button" — and it implies the inner-toolbar becomes imperative DOM, not
reactive Vue state.

## 3. The real obstacle: CSS scope vs. where the navbar lives

This is the issue that makes the correct fix awkward.

The desk SCSS is wrapped in:

```scss
// frappe/public/scss/desk/new_index.scss
@scope (.old-desk-view, .modal) to (.tw) { … }
```

So `.btn`, `.dropdown-menu`, `.inner-group-button`, `.custom-btn-group` styles
**only apply inside `.old-desk-view`**.

But the **Navbar is a Vue component, deliberately outside `.old-desk-view`**
(this is a hard constraint — the navbar is a desk-scope-free Vue zone).

Therefore, injecting legacy `.btn` / `.dropdown` markup into a navbar mount node
yields **unstyled buttons and a broken dropdown** — the desk button/dropdown CSS
never reaches it.

This is a genuine contradiction:

- the filter / group widgets emit **desk-classed jQuery markup** that needs
  `.old-desk-view` scope to look right, but
- the navbar **must not be** inside `.old-desk-view`.

Hosting a `.custom-actions` node in the navbar gives the bridge a node to fill,
but its contents render unstyled. The two requirements ("host the buttons in the
Navbar" + "Navbar stays outside `.old-desk-view`") are each reasonable, but
together they leave the injected markup with no styling source. **This is the
unresolved part.**

### 3a. Bootstrap dropdown behaviour (same root)

Group buttons use `data-toggle="dropdown"` (Bootstrap's dropdown JS). The JS is
in the `libs` bundle (loaded), so the *behaviour* exists — but the open /
positioning still relies on Bootstrap dropdown CSS that lives under the desk
scope. Same root cause as §3.

## 4. Mechanical issues (solvable, just large)

### 4a. Missing bridge nodes
FilterArea reads `page.custom_actions` (`base_list.js:635`); toolbar code reads
`page.inner_toolbar` / `page.custom_actions` as jQuery nodes. The bridge had **no
such getters**, so even before styling the code hits `undefined.removeClass(...)`.
(For the default list path `hide_page_form` is falsy, so FilterArea uses
`page_form`, not `custom_actions` — but the group / inner-button paths still need
the node.)

### 4b. Blast radius of going imperative-DOM
Once `add_inner_button` + groups return DOM, the **reactive inner-toolbar
disappears**, cascading:

- `PageInnerButton` / `PageCustomGroup` types become dead → remove from
  `PageState`, the `reactive()` init, and imports.
- `Navbar.vue`'s `innerToolbar` computed, `visibleCustomGroups` computed and the
  two `v-for` blocks get deleted, replaced by one `.custom-actions` mount `<div>`.
- `change_inner_button_type`, `remove_inner_button`,
  `set_inner_btn_group_as_primary`, `clear_inner_toolbar`,
  `add_divider_to_button_group`, `add_dropdown_item`, `add_custom_menu_item` are
  all rewritten from reactive-state mutation to jQuery DOM (near-verbatim
  `page.js` ports).

So "return jQuery from `add_inner_button`" is really a **rewrite of the whole
custom-actions subsystem** across `types.ts`, `createPage.ts`, and `Navbar.vue`.

### 4c. Split model in `add_dropdown_item`
The old `add_dropdown_item({ parent })` treated `parent` as
`'menu'`/`'actions'`/group-id and routed to reactive lists. In the DOM model,
`parent` is a **`.dropdown-menu` node** and it builds `<li><a class="grey-link
dropdown-item">` with the `user-action` / divider logic from `page.js`.

But `add_menu_item` / `add_action_item` (the navbar `⋯` and **Actions**
dropdowns) **stay reactive**. The result is a **split model**: navbar menu /
actions are reactive Vue dropdowns, while custom-groups / inner-buttons are
jQuery DOM. Workable, but a real source of confusion — `add_dropdown_item({parent:
'menu'})` and `add_dropdown_item({parent: someNode})` behave completely
differently.

## 5. Summary

- **Mechanical (§4):** solvable, just verbose — port `page.js` faithfully, return
  jQuery nodes, delete the reactive inner-toolbar, fix the type / Navbar cascade.
- **The real blocker (§3):** returning jQuery nodes makes `ListFilter.parent()`
  etc. *work functionally*, but the injected `.btn` / `.dropdown` /
  `.inner-group-button` markup renders **unstyled**, because the navbar is outside
  `.old-desk-view` by design.

The crux: **the filter / group widgets are desk-scoped jQuery, and the navbar is
deliberately a desk-scope-free Vue zone** — and we were trying to host one inside
the other.

## 6. Options

1. **Render the filter/sort widgets into `page.page_form` (inside the main
   section / `.old-desk-view`), not the navbar.** FilterArea already targets
   `page_form` for the default list. Keep inner-buttons / groups out of the
   navbar entirely; then desk CSS applies and the navbar stays clean Vue.
   Trade-off: the filter bar sits in the page body, not the head.
   **(Recommended — sidesteps the scope contradiction and matches where legacy
   actually renders the filter bar.)**
2. **Give the navbar's `.custom-actions` node a scoped styling exception** — wrap
   just that subtree so desk `.btn` / `.dropdown` rules reach it. Contradicts
   "navbar outside `.old-desk-view`", but only for that node.
3. **Re-skin the injected markup with tailwind / frappe-ui classes** instead of
   relying on desk `.btn` CSS. Most work; cleanest visual result; keeps the
   navbar consistent with the rest of the Vue chrome.

## 7. What is / isn't done

- The `base_list.js` `setup_page` / `setup_page_head` / `setup_view_menu` cleanups
  are **done** (see `page-migration.md`).
- The three filter gates (`setup_filter_area`, `setup_sort_selector`,
  `setup_list_filter_by`) are **still gated**, pending the §6 decision.
- An attempt to convert the inner-toolbar to imperative DOM was started and
  **reverted** — it is not in the tree. Re-attempt only after §6 is chosen.
