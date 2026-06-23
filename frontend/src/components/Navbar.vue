<script setup lang="ts">
// Standard, reusable page-head component (page-migration.md §3.1). It renders
// the action region two ways: the `#navbar` slot (new Vue views inject Buttons
// directly) AND the bridge-driven `pageState` (legacy set_primary_action /
// add_inner_button calls). PageShell always mounts exactly one Navbar.
import { computed } from 'vue'
import { Badge, Breadcrumbs, Button, Dropdown } from 'frappe-ui'
import { Icon } from 'frappe-ui/icons'
import type { PageInnerButton, PageMenuItem, PageState } from '@/page/types'
import { usePage } from '@/page/usePage'
import { useBreadcrumbs } from '@/composables/getBreadcrumbs'

const props = defineProps<{ state: PageState }>()

// Route-driven breadcrumbs (the Vue port of frappe.breadcrumbs). Shown in the
// title area in place of the bare page title when present.
const { breadcrumbs } = useBreadcrumbs()

// The legacy page bridge feeds icon names from frappe's old icon vocabulary:
// lucide ids (`square-pen`, `printer`, `ellipsis`), frappe sprite ids
// (`es-line-*`) and the odd feather name. frappe-ui's `Icon` <use>s the lucide
// sprite injected by spritePlugin (main.ts), so we alias the known non-lucide
// names to their lucide equivalents and normalize the rest (mirrors the sidebar
// icon handling in getSidebar.ts).
const ICON_ALIASES: Record<string, string> = {
	'es-line-reload': 'rotate-cw',
	'es-line-left-chevron': 'chevron-left',
	'es-line-right-chevron': 'chevron-right',
}

// Lazily snapshot the ids present in the injected sprite so an unknown name
// renders nothing instead of a blank `<use href="#missing">`.
let spriteIds: Set<string> | null = null
function lucideHas(name: string): boolean {
	if (!spriteIds) {
		const sprite = document.getElementById('lucide-sprite')
		if (!sprite) return true // can't verify yet; assume valid
		spriteIds = new Set(Array.from(sprite.querySelectorAll('symbol[id]')).map((s) => s.id))
	}
	return spriteIds.has(name)
}

function toLucideIcon(iconStr?: string): string | null {
	if (!iconStr) return null
	const raw = iconStr
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-')
	const name = ICON_ALIASES[raw] || raw
	return lucideHas(name) ? name : null
}

// `Button`'s `iconLeft` prop wants the prefixed `lucide-*` string form (a bare
// name is treated as a deprecated feather id), so wrap the resolved name.
function toLucideIconLeft(iconStr?: string): string | undefined {
	const name = toLucideIcon(iconStr)
	return name ? `lucide-${name}` : undefined
}

const titleLucide = computed(() => toLucideIcon(props.state.titleIcon))

// The owning page (always present — Navbar only renders inside a PageShell).
// Used to fire the actions-menu-show hook legacy code registers.
const page = usePage()

function onActionsMenuToggle(open: boolean) {
	if (open) page.fire_actions_menu_show?.()
}

// Frappe indicator colours -> frappe-ui Badge themes.
const BADGE_THEME: Record<string, string> = {
	green: 'green',
	red: 'red',
	orange: 'orange',
	yellow: 'orange',
	blue: 'blue',
	grey: 'gray',
	gray: 'gray',
}

const indicatorTheme = computed(() =>
	props.state.indicator ? BADGE_THEME[props.state.indicator.color || 'grey'] || 'gray' : 'gray'
)

const visibleInnerButtons = computed(() => props.state.innerButtons.filter((b) => b.visible))

// Inner buttons with a `group` collapse into one <Dropdown> per group; the rest
// render as standalone buttons. Insertion order is preserved.
const innerToolbar = computed(() => {
	const groups = new Map<string, PageInnerButton[]>()
	const out: Array<
		| { type: 'button'; button: PageInnerButton }
		| { type: 'group'; label: string; buttons: PageInnerButton[] }
	> = []
	for (const button of visibleInnerButtons.value) {
		if (!button.group) {
			out.push({ type: 'button', button })
			continue
		}
		if (!groups.has(button.group)) {
			const buttons: PageInnerButton[] = []
			groups.set(button.group, buttons)
			out.push({ type: 'group', label: button.group, buttons })
		}
		groups.get(button.group)!.push(button)
	}
	return out
})

function toOptions(items: { label: string; icon?: string; onClick: (...a: any[]) => any }[]) {
	return items.map((i) => ({ label: i.label, icon: i.icon, onClick: i.onClick }))
}

// Build dropdown options split into frappe-ui groups at divider markers (page.js
// add_divider). Consecutive groups are separated by the dropdown's `divide-y`, so
// each divider renders as a section separator instead of a clickable item.
function toMenuOptions(items: PageMenuItem[]) {
	const groups: Array<{ group: string; hideLabel: true; items: ReturnType<typeof toOptions> }> =
		[]
	let current: PageMenuItem[] = []
	const flush = () => {
		if (current.length) groups.push({ group: '', hideLabel: true, items: toOptions(current) })
		current = []
	}
	for (const item of items) {
		if (item.divider) flush()
		else current.push(item)
	}
	flush()
	return groups
}

// Turn a button's reactive `listeners` bag ({ click: [fn], mouseenter: [fn] })
// into a v-on object ({ onClick, onMouseenter }), so handlers registered via the
// bridge's `.on(event, fn)` re-bind on every render. Each emits a fresh fan-out
// over the current handler list.
function eventBindings(listeners?: Record<string, Array<(...a: any[]) => any>>) {
	const on: Record<string, (...a: any[]) => void> = {}
	if (!listeners) return on
	for (const event of Object.keys(listeners)) {
		const key = 'on' + event.charAt(0).toUpperCase() + event.slice(1)
		on[key] = (...args: any[]) => listeners[event].forEach((fn) => fn(...args))
	}
	return on
}

const visibleMenuItems = computed(() => props.state.menuItems.filter((i) => i.visible))
// The ⋯ menu options, grouped at divider markers (empty when only dividers exist).
const menuGroups = computed(() => toMenuOptions(visibleMenuItems.value))
// The actions dropdown is hidden by default; show_actions_menu() flips
// actionsMenuVisible (list view does this on row selection). Still require items
// to exist so an empty menu never renders.
const visibleActionItems = computed(() =>
	props.state.actionsMenuVisible ? props.state.actionItems.filter((i) => i.visible) : []
)

// Custom button groups (add_custom_button_group): labelled dropdowns whose
// items arrive later via add_custom_menu_item. Shown once they have items.
const visibleCustomGroups = computed(() =>
	props.state.customGroups.filter((g) => g.visible && g.items.length)
)

// add_action_icon() icons that still belong in the navbar — i.e. those a caller
// hasn't relocated elsewhere (the form sidebar moves print / edit-title into its
// own DOM, giving their `el` a parentNode). Rendered as subtle frappe-ui buttons
// from the icon data; the raw `el` exists only for callers that relocate it.
const navbarIcons = computed(() => props.state.icons.filter((ic: any) => !ic.el?.parentNode))
</script>

<template>
	<nav
		class="bg-surface-white border-b px-2 py-2.5 h-12 flex items-center justify-between w-full"
	>
		<!-- title-area -->
		<div class="flex items-center gap-2 min-w-0">
			<Breadcrumbs
				v-if="breadcrumbs.visible && breadcrumbs.items.length"
				:items="breadcrumbs.items"
			>
				<template #prefix="{ item }">
					<component :is="item.icon" v-if="item.icon" class="size-4" />
				</template>
			</Breadcrumbs>
			<div v-else class="flex items-baseline gap-2 min-w-0">
				<h1 class="text-lg font-semibold truncate flex items-center gap-1">
					<Icon v-if="titleLucide" :name="titleLucide" class="h-4 w-4" />
					{{ state.title }}
				</h1>
				<span v-if="state.subtitle" class="text-sm text-ink-gray-5 truncate">
					{{ state.subtitle }}
				</span>
			</div>
			<Badge v-if="state.indicator" :theme="indicatorTheme" size="lg">
				{{ state.indicator.label }}
			</Badge>
			<span v-if="state.innerMessage" class="text-sm text-ink-gray-5 truncate">
				{{ state.innerMessage }}
			</span>
		</div>

		<!-- action region -->
		<div class="flex items-center gap-2">
			<!-- page-icon-group: add_action_icon() icons, rendered as subtle buttons
			     from the icon data. Icons a caller relocated (e.g. the form sidebar's
			     print / edit-title) are filtered out so they don't double-render. -->
			<Button
				v-for="(icon, i) in navbarIcons"
				:key="`icon-${i}`"
				variant="subtle"
				:icon="toLucideIconLeft(icon.icon)"
				:title="icon.tooltip"
				@click="icon.onClick?.()"
			/>

			<!-- custom-actions / inner toolbar -->
			<template v-for="(entry, i) in innerToolbar" :key="`inner-${i}`">
				<Dropdown v-if="entry.type === 'group'" :options="toOptions(entry.buttons)">
					<Button>{{ entry.label }}</Button>
				</Dropdown>
				<Button
					v-else
					:theme="entry.button.type === 'primary' ? 'gray' : undefined"
					:icon-left="toLucideIconLeft(entry.button.icon)"
					:disabled="entry.button.disabled"
					:class="entry.button.btnClass"
					@click="entry.button.onClick()"
				>
					{{ entry.button.label }}
				</Button>
			</template>

			<!-- custom button groups (add_custom_button_group) -->
			<Dropdown
				v-for="group in visibleCustomGroups"
				:key="`group-${group.id}`"
				:options="toOptions(group.items.filter((it) => it.visible))"
			>
				<Button
					:theme="group.primary ? 'gray' : undefined"
					:icon-left="toLucideIconLeft(group.icon)"
				>
					{{ group.label }}
				</Button>
			</Dropdown>

			<!-- new Vue views inject buttons here -->
			<slot name="navbar" />

			<!-- menu-btn-group -->
			<Dropdown v-if="menuGroups.length" :options="menuGroups">
				<Button icon="lucide-more-horizontal" />
			</Dropdown>

			<!-- actions-btn-group -->
			<Dropdown
				v-if="visibleActionItems.length"
				class="actions-btn-group"
				:options="toOptions(visibleActionItems)"
			>
				<template #default="{ open }">
					<Button variant="solid" @click="onActionsMenuToggle(!open)">Actions</Button>
				</template>
			</Dropdown>

			<!-- secondary / primary -->
			<Button
				v-if="state.secondaryAction && state.secondaryAction.visible"
				:ref="(el: any) => { state.refs.secondaryBtn = el?.$el ?? null }"
				:disabled="state.secondaryAction.disabled"
				:class="state.secondaryAction.extraClass"
				v-on="eventBindings(state.secondaryAction.listeners)"
				@click="state.secondaryAction.onClick()"
			>
				{{ state.secondaryAction.label }}
			</Button>
			<Button
				v-if="state.primaryAction && state.primaryAction.visible"
				variant="solid"
				:disabled="state.primaryAction.disabled"
				:class="state.primaryAction.extraClass"
				v-on="eventBindings(state.primaryAction.listeners)"
				@click="state.primaryAction.onClick()"
			>
				{{ state.primaryAction.label }}
			</Button>
		</div>
	</nav>
</template>
