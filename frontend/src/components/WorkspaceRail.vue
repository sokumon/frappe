<script setup lang="ts">
// The workspace rail — the Vue recreation of `frappe.ui.WorkspaceDock`
// (frappe/public/js/frappe/ui/sidebar/workspace_dock.js), built on frappe-ui's
// `Rail` instead of hand-rolled jQuery DOM.
//
// It lists the current app's workspaces as icons with the app logo pinned to the
// top corner, and carries the shortcuts the legacy dock moved out of the page
// header: global search, notifications, and the user menu. The workspace set and
// the app context come from `useWorkspaceRail`, which derives both from whichever
// sidebar the route resolved — so the rail follows the sidebar, not the URL.
//
// The layout follows gameplan's AppRail: logo, then divider-separated groups
// (workspaces, then icon shortcuts), then a `flex-1` spacer that pushes the user
// avatar to the bottom edge. frappe-ui's Rail/RailItem *are* that design
// extracted into components — the tile treatment, the `-left-[11px]` active
// indicator bar and the ghost icon buttons all match — so the grouping below is
// the only part worth spelling out.
//
// Mounted once in App.vue (NOT in PageShell): the rail is app chrome that
// outlives any single page, and PageShell is re-created per route.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Avatar, Dropdown, Rail, RailItem } from 'frappe-ui'
import { resolveIcon } from '@/composables/getSidebar'
import { useWorkspaceRail } from '@/composables/getWorkspaceRail'
import { openCommandPalette } from '@/search/commandPalette'

const { workspaces, logo, hidden } = useWorkspaceRail()
const route = useRoute()

// `__` is seeded on window by boot/translate.ts and isn't a typed global
// (components alias it locally); resolve it per call.
const __ = (txt: string): string => (window as any).__?.(txt) ?? txt

// Rendered through the lucide sprite, the same way sidebar/workspace icons are.
const searchIcon = resolveIcon('search')
const bellIcon = resolveIcon('bell')

const isGuest = computed(() => frappe?.session?.user === 'Guest')

// The logo lights up on the home route, like gameplan's Home button.
const isHome = computed(() => route.path === '/')

// Both shortcuts honour the same desk settings the legacy dock checks before
// rendering them.
const showSearch = computed(() => !isGuest.value && !!frappe?.boot?.desk_settings?.search_bar)
const showNotifications = computed(
	() => !isGuest.value && !!frappe?.boot?.desk_settings?.notifications
)

// Seeded from boot, like the legacy dock. The live sync the old bell had came
// from the Notifications view, which has no Vue port yet — until it does, the
// bell links to the Notification Log list rather than opening a panel.
const unreadCount = computed(() => frappe?.boot?.notification_unread_count || 0)

const user = computed(() => {
	const name = frappe?.session?.user
	const info = frappe?.user_info?.(name) ?? {}
	return { name, fullname: info.fullname || name, image: info.image || '' }
})

// A subset of the legacy user menu: Settings and Manage Workspaces both open
// dialogs that aren't ported yet (user_settings_dialog.bundle / WorkspacePicker),
// so they're left out rather than stubbed.
const userMenuOptions = computed(() => [
	{
		label: __('My Profile'),
		icon: 'user',
		onClick: () => frappe.set_route('Form', 'User', user.value.name),
	},
	{
		label: __('Logout'),
		icon: 'log-out',
		onClick: logout,
	},
])

function logout() {
	frappe.call({ method: 'logout' }).then((r: any) => {
		if (r?.exc) return
		window.location.href = '/login'
	})
}

// No rail when there's nothing to switch between (guest, or setup not complete),
// or when the page on screen opts out (PageShell's `hideWorkspaceDock`, the port
// of the legacy page_hides_dock check).
const visible = computed(() => workspaces.value.length > 0 && !hidden.value)
</script>

<template>
	<Rail v-if="visible">
		<!-- App logo. The band is the navbar's own height and negates the Rail's top
			 padding, so the logo centers on the same 48px chrome band as PageShell's
			 Navbar (h-12) and frappe-ui's SidebarHeader (h-12) — and its rule lands on
			 exactly the navbar's border-b, both being border-box 48px.
			 `ghost` gives the logo gameplan's transparent-until-active Home button:
			 raised and shadowed on the route it points at. -->
		<div
			class="-mt-2.5 flex h-12 w-full shrink-0 items-center justify-center border-b border-outline-gray-2"
		>
			<RailItem :label="logo.title" variant="ghost" :active="isHome" to="/">
				<img
					v-if="logo.url"
					:src="logo.url"
					:alt="logo.title"
					class="size-7 rounded-[7px] object-contain"
				/>
			</RailItem>
		</div>

		<!-- Workspaces. Shrinks and scrolls on its own when an app has more of them
			 than the viewport fits, so the shortcuts and avatar stay reachable. The
			 divider above them is the logo band's border-b, so there's none here.
			 The box stretches out to the rail's edges (`-mx-[11px] px-[11px]`) because
			 RailItem's active bar is absolutely positioned at `-left-[11px]`, out in
			 the gutter: `overflow-y-auto` forces overflow-x from visible to auto, so a
			 box that stopped at the gutter would clip the indicator away. The
			 scrollbar is hidden — a 50px rail can't spare the width. -->
		<div
			class="-mx-[11px] flex h-full min-h-0 flex-col items-center gap-3 self-stretch overflow-y-auto px-[11px] pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			<RailItem
				v-for="workspace in workspaces"
				:key="workspace.name"
				:label="workspace.label"
				:icon="workspace.icon"
				:to="workspace.to"
				:active="workspace.active"
				@click="workspace.select()"
			/>
		</div>

		<!-- Icon shortcuts, in their own divider-separated group. -->
		<div
			v-if="showNotifications || showSearch"
			class="mt-3 mb-3 flex w-full shrink-0 flex-col items-center gap-0.5 border-t border-outline-gray-2 pt-3"
		>
			<RailItem
				v-if="showNotifications"
				:label="__('Notifications')"
				:icon="bellIcon"
				variant="ghost"
				:badge="unreadCount"
				badge-style="dot"
				to="/notification-log"
			/>
			<RailItem
				v-if="showSearch"
				:label="__('Search')"
				:icon="searchIcon"
				variant="ghost"
				@click="openCommandPalette()"
			/>
		</div>

		<div class="flex-1" />

		<!-- The avatar is a plain button, not a RailItem: Dropdown renders its
			 trigger `as-child`, and RailItem's root is a Tooltip that can't carry the
			 trigger's ref/handlers. gameplan's rail leaves it untooltipped too. -->
		<Dropdown v-if="!isGuest" :options="userMenuOptions" side="right" align="end">
			<template #default="{ open }">
				<button
					type="button"
					class="flex size-7 shrink-0 items-center justify-center rounded-full transition"
					:class="open ? 'ring-2 ring-outline-gray-4' : 'hover:opacity-90'"
					:aria-label="user.fullname"
				>
					<Avatar :image="user.image" :label="user.fullname" size="md" class="size-7" />
				</button>
			</template>
		</Dropdown>
	</Rail>
</template>
