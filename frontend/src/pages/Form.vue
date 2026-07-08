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
// The document sidebar is split: FormSidebar.vue renders the template (chrome),
// and the legacy `frappe.ui.form.Sidebar` (created in form.js render_form) drives
// the dynamic widgets by binding to that markup. It renders into `page.sidebar`,
// so we point that bridge ref at the `.layout-side-section` container here (which
// holds FormSidebar) — wrapped in `.old-desk-view` so the scoped sidebar SCSS
// applies.
//
// Loading mirrors the legacy `FormFactory` (formview.js): re-render fresh docs in
// place, fetch stale/missing ones, create-and-reroute for `new` names, and follow
// renames via frappe.model.new_names.
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import PageShell from '@/components/PageShell.vue'
import FormSidebar from '@/components/FormSidebar.vue'
import { FormLayout } from '@framework/ui/FormLayout'
import { useFormBridge } from '@/composables/useFormBridge'
import type { FormBridge } from '@/composables/useFormBridge'

// route params: doctype (url slug) and document name
const props = defineProps<{ doctype: string; name: string }>()

// the url carries the slug ("sales-order"); the form needs the real doctype
const doctype =
	frappe.router.routes?.[props.doctype]?.doctype || frappe.router.unslug(props.doctype)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')
const formSidebar = useTemplateRef<HTMLDivElement>('formSidebar')
const form = ref<any>(null)

// The Vue field view. The legacy `frm` stays the engine (script_manager, toolbar,
// sidebar, save, watch_model_updates); `useFormBridge` renders its fields through
// `<FormLayout>` and routes edits through `frappe.model.set_value` so legacy
// `frappe.ui.form.on(...)` scripts keep firing. The legacy `.std-form-layout` is
// hidden (kept in the DOM so fields_dict/refresh_field/set_df_property still work).
const bridge = shallowRef<FormBridge | null>(null)
const formSchema = computed(() => bridge.value?.layout.value ?? [])
const formDoc = computed(() => bridge.value?.doc ?? null)

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

	// Point the bridge `page.sidebar` at the form's side-section so the legacy
	// Sidebar (created in render_form) renders into it instead of the workspace
	// nav. Set before the form is built so the first refresh wires it.
	if (formSidebar.value) shell.value!.page.state.refs.sidebar = formSidebar.value

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

onUnmounted(() => bridge.value?.dispose())

// Doc-to-doc navigation within the same doctype keeps this component mounted
// (FormOrPage keys the form by doctype), so re-load on name change.
watch(
	() => props.name,
	(name) => loadDoc(name)
)
</script>

<template>
	<PageShell ref="shell" :title="title">
		<!-- The Vue field view, rendered into PageShell's main section
			 (.layout-main-section). The legacy .std-form-layout renders alongside but
			 is hidden via `.vue-form-active` (added to page-body in onMounted). -->
		<FormLayout
			v-if="formDoc"
			:layout="formSchema"
			:doc="formDoc"
			class="vue-form-layout max-w-[1000px] p-0 m-0 rounded-0 w-max"
		/>

		<template #aside>
			<!-- The legacy frappe.ui.form.Sidebar renders into this
				 `.layout-side-section` (bridge page.sidebar). `.old-desk-view` scopes
				 the form-sidebar SCSS; the inline width matches --form-sidebar-width. -->
			<div class="old-desk-view h-full shrink-0 overflow-auto">
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
</style>
