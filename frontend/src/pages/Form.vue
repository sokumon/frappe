<script setup lang="ts">
// Document form, rendered through PageShell.
//
// The form drives PageShell's bridge page: we hand `frappe.ui.form.Form` the
// page-body node (which carries the bridge `.page`), so the legacy make_app_page
// reuses the shell's page and the form renders into its `.layout-main-section`.
// The form Toolbar drives the page chrome through the bridge — the ⋯ menu,
// navigation icons, primary/secondary actions and the status indicator — all
// rendered by the Vue Navbar. Custom buttons from client scripts flow the same
// way (frm.add_custom_button -> page.add_inner_button).
//
// The document sidebar is fully Vue-native: FormSidebar.vue renders the widgets
// (image, title, assignments, attachments, tags, shared, likes, follow, meta) from
// the reactive docinfo, and the script-compat facades installed on the frm
// (frm.sidebar/attachments/assign_to/shared/tags — see form/sidebarFacades.ts) hold
// the data + actions so client scripts keep working. We still point the bridge
// `page.sidebar` ref at the `.layout-side-section` container so `frm.page.sidebar`
// references resolve.
//
// Loading mirrors the legacy `FormFactory` (formview.js): re-render fresh docs in
// place, fetch stale/missing ones, create-and-reroute for `new` names, and follow
// renames via frappe.model.new_names.
import {
	computed,
	onMounted,
	onUnmounted,
	provide,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
} from 'vue'
import PageShell from '@/components/PageShell.vue'
import FormSidebar from '@/components/FormSidebar.vue'
import { FormLayout, LinkQueryKey } from '@framework/ui/FormLayout'
import { useFormBridge } from '@/composables/useFormBridge'
import type { FormBridge } from '@/composables/useFormBridge'
import FormTimeline from '@/components/FormTimeline.vue'
import { sidebarVersion } from '@/form/sidebarStore'

// route params: doctype (url slug) and document name
const props = defineProps<{ doctype: string; name: string }>()

// the url carries the slug ("sales-order"); the form needs the real doctype
const doctype =
	frappe.router.routes?.[props.doctype]?.doctype || frappe.router.unslug(props.doctype)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')
const formSidebar = useTemplateRef<HTMLDivElement>('formSidebar')
const form = ref<any>(null)
// Expose the frm to FormLayout descendants (e.g. HtmlField adopts the DOM node a
// client script wrote into via `frm.fields_dict[f].$wrapper`). Provided as the ref
// so consumers read `frm.value` once it's constructed in onMounted.
provide('frm', form)

// Bridge `frm.set_query` to the Vue LinkField: it stashes a `get_query` callback —
// on `frm.fields_dict[fieldname]` for a top-level Link, or on the grid's per-field
// handle (`grid.get_field(fieldname).get_query`) for a child-table cell. The
// LinkField calls this resolver at fetch time (not cached) so it reflects the live
// doc, matching desk which re-runs get_query on every dropdown open.
provide(LinkQueryKey, (fieldname: string, row?: Record<string, any>) => {
	const frm = form.value
	if (!frm) return undefined
	let getQuery: any
	let doc: any
	let cdt: string | undefined
	let cdn: string | undefined
	if (row?.parentfield) {
		// Child-table cell: get_query lives on the parent grid's field handle, and
		// legacy invokes it `(frm.doc, cdt, cdn)` — erpnext scripts do
		// `function(doc, cdt, cdn) { let row = locals[cdt][cdn]; … }`, expecting the
		// PARENT doc as `doc` and the child's doctype/name as cdt/cdn.
		getQuery = frm.fields_dict?.[row.parentfield]?.grid?.get_field?.(fieldname)?.get_query
		doc = frm.doc
		cdt = row.doctype
		cdn = row.name
	} else {
		getQuery = frm.fields_dict?.[fieldname]?.get_query
		doc = frm.doc
		cdt = frm.doc?.doctype
		cdn = frm.doc?.name
	}
	if (!getQuery) return undefined
	// Normally a fn(doc, cdt, cdn) → {filters, query}; tolerate a plain object.
	const result = typeof getQuery === 'function' ? getQuery(doc, cdt, cdn) : getQuery
	return result || undefined
})

// The Vue field view. The legacy `frm` stays the engine (script_manager, toolbar,
// sidebar, save, watch_model_updates); `useFormBridge` renders its fields through
// `<FormLayout>` and routes edits through `frappe.model.set_value` so legacy
// `frappe.ui.form.on(...)` scripts keep firing. The legacy `.std-form-layout` is
// hidden (kept in the DOM so fields_dict/refresh_field/set_df_property still work).
const bridge = shallowRef<FormBridge | null>(null)
const formSchema = computed(() => bridge.value?.layout.value ?? [])
const formDoc = computed(() => bridge.value?.doc ?? null)

// The docname the activity timeline renders for — set only once the doc is loaded
// and saved (null for new/unsaved/loading), so FormTimeline never mounts with an
// empty docname (get_docinfo/get_activity_timeline would fail on ''). Keyed by it
// so the timeline reconstructs per document.
const timelineName = ref<string | null>(null)

// Hide the whole document sidebar on new/unsaved docs (parity with the legacy
// Sidebar.refresh, which toggled the sidebar off when `doc.__islocal`). The aside
// slot collapses when empty, so the form takes the full width until the doc is saved.
// Read the REAL frm.doc (the reactive field mirror drops meta keys like name/
// __islocal), made reactive via the sidebar store version — `frm.sidebar.refresh()`
// bumps it on every refresh_header, so this re-evaluates after each (re)load.
const showSidebar = computed(() => {
	sidebarVersion() // reactive dep (bumped on every form refresh)
	const doc = form.value?.doc
	return !!doc && !!doc.name && !doc.__islocal
})

const title = computed(() =>
	props.name && !props.name.startsWith('new') ? props.name : frappe.unscrub(doctype)
)

function renderDoc(name: string) {
	// Clear meta-script ops so this render's `refresh` re-applies them cleanly
	// (set_df_property/toggle_* run on every refresh); then refresh() runs setup()
	// (first time) and refresh_header(), which drives the Toolbar -> bridge ->
	// Navbar (primary action, ⋯ menu, indicator) and fires the refresh script.
	bridge.value?.resetOps()
	form.value.refresh(name)
	;(window as any).cur_frm = form.value
	// Mirror the freshly-loaded doc (defaults + values scripts set on refresh) into
	// the reactive doc the Vue FormLayout renders.
	bridge.value?.seed()
	// Show the timeline only for a loaded, saved doc (docname now set on the frm).
	const doc = form.value.doc
	timelineName.value = doc && !doc.__islocal ? form.value.docname : null
}

// formview.js render_new_doc: build a fresh local doc and reroute to its name.
function renderNewDoc(name: string) {
	const newName = frappe.model.make_new_doc_and_get_name(doctype, true)
	if (newName === name) {
		renderDoc(name)
	} else {
		frappe.route_flags = frappe.route_flags || {}
		frappe.route_flags.replace_route = true
		frappe.set_route('Form', doctype, newName)
	}
}

// formview.js show_doc / fetch_and_render: render in place when the doc is fresh,
// otherwise fetch it (handling new docs, renames and 403s).
function loadDoc(name: string) {
	if (!form.value) return

	if (frappe.model.new_names[name]) {
		// document has been renamed, reroute
		frappe.set_route('Form', doctype, frappe.model.new_names[name])
		return
	}

	const doc = frappe.get_doc(doctype, name)
	if (
		doc &&
		frappe.model.get_docinfo(doctype, name) &&
		(doc.__islocal || frappe.model.is_fresh(doc))
	) {
		renderDoc(name)
		return
	}

	frappe.model.with_doc(doctype, name, (_n: string, r: any) => {
		if (r && r['403']) return // not permitted
		if (!(window as any).locals?.[doctype]?.[name]) {
			if (name && name.slice(0, 3) === 'new') renderNewDoc(name)
			else frappe.show_not_found?.(name)
			return
		}
		renderDoc(name)
	})
}

onMounted(() => {
	// page-body carries the bridge page; hand it to the form as its parent so
	// make_app_page reuses this shell's page (layout_main = .layout-main-section).
	const pageBody = shell.value?.page?.state.refs.pageBody
	if (!pageBody) return

	// Hide the legacy field layout, scoped to this form's page-body (kept in the
	// DOM so the legacy fields_dict/refresh_field/set_df_property still resolve).
	pageBody.classList.add('vue-form-active')

	frappe.model.with_doctype(doctype, () => {
		form.value = new frappe.ui.form.Form(doctype, pageBody, true, frappe.router.doctype_layout)
		;(window as any).cur_frm = form.value
		// Build the bridge (wrap set_df_property/toggle_*, build the base schema from
		// pristine meta) BEFORE the first refresh, so meta-script ops from the very
		// first `refresh` are captured too.
		bridge.value = useFormBridge(form.value)
		loadDoc(props.name)
	})
})

onUnmounted(() => {
	// Order matters: drop the bridge's model mirrors first, then tear down the frm
	// (removes watch_model_updates listeners, releases detached wrapper sinks, and
	// clears cur_frm if it's this instance) — otherwise navigating between forms
	// leaks the frm graph and can double-fire client scripts.
	bridge.value?.dispose()
	form.value?.teardown?.()
})

// Doc-to-doc navigation within the same doctype keeps this component mounted
// (FormOrPage keys the form by doctype), so re-load on name change.
watch(
	() => props.name,
	(name) => loadDoc(name)
)

// Keep the bridge `page.sidebar` pointed at the form's side-section whenever it's
// mounted (it's gated on `showSidebar`, so it appears/disappears as the doc is
// saved/new), so any `frm.page.sidebar` reference resolves to this container.
watch(formSidebar, (el) => {
	if (el && shell.value) shell.value.page.state.refs.sidebar = el
})
</script>

<template>
	<!-- legacy-styles=false: the field view is the Vue FormLayout, so keep the
		 legacy desk SCSS (`old-desk-view`) off the main section. The document sidebar
		 in #aside is fully Vue-native and only shown for saved docs (showSidebar). -->
	<PageShell ref="shell" :title="title" :legacy-styles="false">
		<!-- The Vue field view, rendered into PageShell's main section
			 (.layout-main-section). The legacy .std-form-layout renders alongside but
			 is hidden via `.vue-form-active` (added to page-body in onMounted). -->
		<FormLayout
			v-if="formDoc"
			:layout="formSchema"
			:doc="formDoc"
			class="vue-form-layout h-full rounded-none border-none"
		/>

		<!-- Document activity feed (parity with the legacy form_timeline.js footer).
			 The full-width wrapper carries the form/feed divider on tabless forms
			 (see the `.form-timeline-region` rule below); the inner column matches
			 the tabless sections' content column so the two align. -->
		<div v-if="timelineName" class="form-timeline-region">
			<FormTimeline
				:key="timelineName"
				:frm="form"
				class="mx-auto w-full max-w-4xl px-4 pb-8 pt-6 sm:px-6"
			/>
		</div>

		<template #aside>
			<!-- The Vue-native FormSidebar renders into this `.layout-side-section`
				 (bridge page.sidebar); the inline width matches --form-sidebar-width.
				 Hidden for new/unsaved docs — the empty aside slot collapses the column. -->
			<div v-if="showSidebar" class="h-full shrink-0 overflow-auto border-l">
				<div
					ref="formSidebar"
					class="layout-side-section h-full"
					style="width: var(--form-sidebar-width)"
				>
					<FormSidebar :frm="form" />
				</div>
			</div>
		</template>
	</PageShell>
</template>

<!-- Not scoped: the legacy `.std-form-layout` is built by form.js into the bridge
	 page-body, outside this component's template, so a scoped rule can't reach it.
	 The `.vue-form-active` marker (added to page-body only while a Vue form is
	 mounted) keeps the rule from leaking to non-form desk pages. -->
<style>
.vue-form-active .std-form-layout {
	display: none !important;
}
/* The legacy form footer (form_footer.html: comment box + `.new-timeline`
   Activity feed) is appended next to the section by form.js, outside
   `.std-form-layout`. Hide it — the Vue FormTimeline replaces it — so the form
   doesn't show two Activity sections. */
.vue-form-active .form-footer {
	display: none !important;
}

/* Tabless forms (FormLayout's `no-tabs` hook) drop the tab card, so the bare
   sections would otherwise hug the page edges. Instead: sections stay full
   width so their top-border dividers run edge-to-edge across the main section,
   while each section's inner content is constrained to the same centered
   column as the timeline below (max-w-4xl + px-4/sm:px-6). */
.vue-form-layout.no-tabs {
	padding-top: 1.25rem;
	padding-bottom: 1.5rem;
}
.vue-form-layout.no-tabs .section > div {
	width: 100%;
	max-width: 56rem;
	margin-inline: auto;
	padding-inline: 1rem;
}
@media (min-width: 640px) {
	.vue-form-layout.no-tabs .section > div {
		padding-inline: 1.5rem;
	}
}
/* Full-bleed divider between a tabless form and the activity feed. */
.vue-form-layout.no-tabs + .form-timeline-region {
	border-top: 1px solid var(--outline-elevation-2);
}
</style>
