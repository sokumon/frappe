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
import { Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarSection } from 'frappe-ui'
import Navbar from './Navbar.vue'
import Footer from './Footer.vue'
import { createPage } from '@/page/createPage'
import { providePage } from '@/page/usePage'
import { useWorkspaceSidebar } from '@/composables/getSidebar'
import { useHideWorkspaceRail } from '@/composables/getWorkspaceRail'
import OldDeskView from './OldDeskView.vue'

// Only the render-relevant subset of PageOptions; the legacy passthrough fields
// live on PageOptions for the bridge, not on the component's props.
const props = withDefaults(
	defineProps<{
		title?: string
		sidebar?: boolean
		sidebarPosition?: 'Left' | 'Right'
		sidebarHeader?: Record<string, any>
		sidebarSections?: any[]
		// Hide the workspace rail (App.vue's WorkspaceRail) while this page is
		// on screen — the port of the legacy `hide_workspace_dock` page option.
		// Independent of `sidebar`: a single-column page keeps the rail; the
		// apps/desktop screen is what this is for.
		hideWorkspaceDock?: boolean
		// Apply the legacy desk SCSS scope (`old-desk-view`) to the main section.
		// Views rendering their own Vue UI into the default slot (e.g. the Form's
		// FormLayout) pass `false` so that SCSS doesn't bleed into them.
		legacyStyles?: boolean
	}>(),
	{
		sidebar: true,
		sidebarPosition: 'Left',
		sidebarSections: () => [],
		legacyStyles: true,
	}
)

// Each PageShell owns one page; descendants drive it via usePage().
const page = createPage(props)
providePage(page)

// The workspace rail lives in App.vue, above the router, so a page opts out by
// declaring it here rather than by not rendering it. Driven off the page state
// (not the prop) so a legacy page script that adopts this page via
// make_app_page({ hide_sidebar: 1 }) hides the rail too.
useHideWorkspaceRail(() => page.state.hideWorkspaceDock)

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
const pageBody = useTemplateRef<HTMLDivElement>('pageBody')
const main = useTemplateRef<HTMLElement>('main')
const footer = useTemplateRef<{ $el: HTMLElement }>('footer')
const pageForm = useTemplateRef<HTMLDivElement>('pageForm')
const filters = useTemplateRef<HTMLDivElement>('filters')
const navbar = useTemplateRef<{ $el: HTMLElement }>('navbar')
const sidebarRef = useTemplateRef<{ $el: HTMLElement }>('sidebarRef')

onMounted(() => {
	const refs = page.state.refs
	refs.wrapper = wrapper.value
	refs.pageWrapper = pageWrapper.value
	refs.pageHead = navbar.value?.$el ?? null
	refs.pageBody = pageBody.value
	refs.main = main.value
	refs.sidebar = sidebarRef.value?.$el ?? null
	refs.footer = footer.value?.$el ?? null
	refs.pageForm = pageForm.value
	refs.filters = filters.value

	// Stamp the real page onto the layout nodes a page script might pass back as
	// `parent` (it receives page.main in on_page_load). make_app_page resolves
	// `parent.page` from these, so it reuses this shell page instead of spawning
	// a detached one whose refs are null. page-body is the node that carries the
	// page identity (legacy add_page stamps id/data-page-route there).
	if (refs.pageBody) (refs.pageBody as any).page = page
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
		<!-- Composed rather than driven by Sidebar's `header`/`sections` props: that
			 config path is deprecated, and it doesn't forward `showLogo`, which is the
			 only way to drop the header's logo box (a falsy `logo` renders the
			 title-initial square instead of nothing). The body below mirrors what the
			 config path renders, minus the logo. -->
		<Sidebar v-if="sidebar" ref="sidebarRef" class="shrink-0" :class="sidebarOrder">
			<div class="flex h-full flex-col p-2">
				<SidebarHeader
					v-if="resolvedHeader"
					:title="resolvedHeader.title"
					:menu-items="resolvedHeader.menuItems"
					:show-logo="false"
				/>

				<div class="flex-1 overflow-y-auto overflow-x-hidden">
					<SidebarSection
						v-for="section in resolvedSections"
						:key="section.label"
						:label="section.label"
						:items="section.items"
						:collapsible="section.collapsible"
					/>
				</div>

				<div class="mt-auto">
					<SidebarCollapseToggle />
				</div>
			</div>
		</Sidebar>

		<div
			id="page-wrapper"
			ref="pageWrapper"
			class="flex flex-1 flex-col h-full overflow-hidden page-head"
		>
			<Navbar ref="navbar" :state="page.state">
				<template #navbar>
					<slot name="navbar" />
				</template>
			</Navbar>

			<!-- The body region: the main page-body plus an optional right-hand
				 panel (`aside` slot, used by the form for its document sidebar). The
				 flex row keeps the panel beside the scrolling body; with no `aside`
				 slot it collapses to just the body, identical to before. -->
			<div class="flex flex-1 overflow-hidden">
				<!-- page-body (page.html): page-wrapper > page-content holds the main
					 section; legacy code queries .page-content / .layout-main. -->
				<OldDeskView :legacy-styles="legacyStyles">
					<div ref="pageBody" class="page-body flex flex-1 flex-col overflow-hidden">
						<div class="page-toolbar hide" />
						<div class="page-wrapper flex flex-1 flex-col overflow-hidden">
							<div class="page-content flex flex-1 flex-col overflow-hidden">
								<div class="workflow-button-area btn-group pull-right hide" />
								<main ref="main" class="layout-main flex-1 overflow-auto">
									<div class="layout-main-section-wrapper">
										<div class="layout-main-section">
											<!-- Both start hidden (legacy page.js creates page_form
												 with `hide`); the bridge's show_form()/add_field
												 reveal them when a field is added. -->
											<div
												id="page-form"
												class="page-form row hide"
												ref="pageForm"
											/>
											<div id="filters" class="filters hide" ref="filters" />
											<slot />
										</div>
									</div>
								</main>
								<Footer ref="footer">
									<slot name="footer" />
								</Footer>
							</div>
						</div>
					</div>
				</OldDeskView>
				<slot name="aside" />
			</div>
		</div>
	</div>
</template>
