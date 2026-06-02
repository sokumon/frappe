<script setup lang="ts">
// The page layout (page-migration.md §3). Owns the reactive page state (via the
// `createPage` bridge), always mounts exactly one Navbar, owns the sidebar, and
// exposes the `#page-form` / `#filters` mount nodes that `add_field` writes into.
//
// The sidebar is frappe-ui's `Sidebar`, rendered here and gated by `sidebar`.
// Its content defaults to the workspace sidebar resolved for the current route
// (useWorkspaceSidebar / frappe.app.sidebar); the `sidebarHeader` /
// `sidebarSections` props override that when a caller supplies them.
import { computed, onMounted, useTemplateRef } from 'vue'
import { Sidebar } from 'frappe-ui'
import Navbar from './Navbar.vue'
import { createPage } from '@/page/createPage'
import { providePage } from '@/page/usePage'
import { useWorkspaceSidebar } from '@/composables/getSidebar'

// Only the render-relevant subset of PageOptions; the legacy passthrough fields
// live on PageOptions for the bridge, not on the component's props.
const props = withDefaults(
	defineProps<{
		title?: string
		sidebar?: boolean
		sidebarPosition?: 'Left' | 'Right'
		sidebarHeader?: Record<string, any>
		sidebarSections?: any[]
	}>(),
	{
		sidebar: true,
		sidebarPosition: 'Left',
		sidebarSections: () => [],
	}
)

// Each PageShell owns one page; descendants drive it via usePage().
const page = createPage(props)
providePage(page)

// The shared workspace sidebar, resolved from the current route (and published
// as frappe.app.sidebar). Explicit `sidebarHeader`/`sidebarSections` props win;
// otherwise we render whatever the route resolved to.
const { sidebar: workspaceSidebar } = useWorkspaceSidebar()
const resolvedHeader = computed(() => props.sidebarHeader ?? workspaceSidebar.header ?? undefined)
const resolvedSections = computed(() =>
	props.sidebarSections.length ? props.sidebarSections : workspaceSidebar.sections
)

const wrapper = useTemplateRef<HTMLDivElement>('wrapper')
const pageWrapper = useTemplateRef<HTMLDivElement>('pageWrapper')
const main = useTemplateRef<HTMLElement>('main')
const footer = useTemplateRef<HTMLDivElement>('footer')
const pageForm = useTemplateRef<HTMLDivElement>('pageForm')
const filters = useTemplateRef<HTMLDivElement>('filters')
const navbar = useTemplateRef<{ $el: HTMLElement }>('navbar')
const sidebarRef = useTemplateRef<{ $el: HTMLElement }>('sidebarRef')

onMounted(() => {
	const refs = page.state.refs
	refs.wrapper = wrapper.value
	refs.pageWrapper = pageWrapper.value
	refs.pageHead = navbar.value?.$el ?? null
	refs.main = main.value
	refs.sidebar = sidebarRef.value?.$el ?? null
	refs.footer = footer.value
	refs.pageForm = pageForm.value
	refs.filters = filters.value

	// Stamp the real page onto the layout nodes a page script might pass back as
	// `parent` (it receives page.main in on_page_load). make_app_page resolves
	// `parent.page` from these, so it reuses this shell page instead of spawning
	// a detached one whose refs are null.
	if (refs.wrapper) (refs.wrapper as any).page = page
	if (refs.main) (refs.main as any).page = page
})

// `order-first` keeps the sidebar on the left; `order-last` flips it right
// without reordering the DOM.
const sidebarOrder = computed(() =>
	props.sidebarPosition === 'Right' ? 'order-last' : 'order-first'
)

defineExpose({ page })
</script>

<template>
	<div ref="wrapper" class="flex h-full w-full overflow-hidden">
		<Sidebar
			v-if="sidebar"
			ref="sidebarRef"
			:header="resolvedHeader"
			:sections="resolvedSections"
			class="shrink-0"
			:class="sidebarOrder"
		/>

		<div
			id="page-wrapper"
			ref="pageWrapper"
			class="flex flex-1 flex-col h-full overflow-hidden"
		>
			<Navbar ref="navbar" :state="page.state">
				<template #navbar>
					<slot name="navbar" />
				</template>
			</Navbar>

			<main
				ref="main"
				class="layout-main layout-main-section flex-1 overflow-auto old-desk-view"
			>
				<div id="page-form" class="page-form row" ref="pageForm" />
				<div id="filters" class="filters" ref="filters" />
				<slot />
			</main>

			<footer ref="footer" class="layout-footer" />
		</div>
	</div>
</template>
