<script setup lang="ts">
// Document form, rendered through PageShell.
//
// The form drives PageShell's bridge page: we hand `frappe.ui.form.Form` the
// page-body node (which carries the bridge `.page`), so the legacy make_app_page
// reuses the shell's page and the form renders into its `.layout-main-section`.
// Custom buttons added by client scripts flow through the bridge
// (frm.add_custom_button -> page.add_inner_button) to the Navbar. The form
// Toolbar isn't created (the bridge doesn't back its desk-only chrome), so Save
// and the status indicator are driven from here. The document sidebar is the Vue
// `FormSidebar` in PageShell's `aside` slot (the right-hand panel).
//
// Loading mirrors the legacy `FormFactory` (formview.js): re-render fresh docs in
// place, fetch stale/missing ones, create-and-reroute for `new` names, and follow
// renames via frappe.model.new_names.
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { Button } from 'frappe-ui'
import PageShell from '@/components/PageShell.vue'
import FormSidebar from '@/components/FormSidebar.vue'

// route params: doctype (url slug) and document name
const props = defineProps<{ doctype: string; name: string }>()

// the url carries the slug ("sales-order"); the form needs the real doctype
const doctype =
	frappe.router.routes?.[props.doctype]?.doctype || frappe.router.unslug(props.doctype)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')
const form = ref<any>(null)

const title = computed(() =>
	props.name && !props.name.startsWith('new') ? props.name : frappe.unscrub(doctype)
)

function setIndicator(name: string) {
	const page = shell.value?.page
	const doc = frappe.get_doc(doctype, name)
	const indicator = doc && frappe.get_indicator(doc)
	if (indicator && indicator.length) page?.set_indicator(indicator[0], indicator[1])
	else page?.clear_indicator()
}

let dirtyBound = false

function renderDoc(name: string) {
	form.value.refresh(name)
	;(window as any).cur_frm = form.value

	// $wrapper exists only after the first refresh runs setup(); reflect the dirty
	// state in the navbar indicator (there's no Toolbar to do it). Bind once.
	if (!dirtyBound) {
		dirtyBound = true
		form.value.$wrapper.on('dirty', () => {
			shell.value?.page?.set_indicator('Not Saved', 'orange')
		})
	}

	setIndicator(name)
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

function save() {
	form.value?.save('Save')
}

onMounted(() => {
	// page-body carries the bridge page; hand it to the form as its parent so
	// make_app_page reuses this shell's page (layout_main = .layout-main-section).
	const pageBody = shell.value?.page?.state.refs.pageBody
	if (!pageBody) return

	frappe.model.with_doctype(doctype, () => {
		form.value = new frappe.ui.form.Form(doctype, pageBody, true, frappe.router.doctype_layout)
		;(window as any).cur_frm = form.value
		loadDoc(props.name)
	})
})

// Doc-to-doc navigation within the same doctype keeps this component mounted
// (FormOrPage keys the form by doctype), so re-load on name change.
watch(
	() => props.name,
	(name) => loadDoc(name)
)
</script>

<template>
	<PageShell ref="shell" :title="title">
		<template #navbar>
			<Button class="primary-action" variant="solid" @click="save">Save</Button>
		</template>

		<template #aside>
			<FormSidebar v-if="form" :frm="form" />
		</template>
	</PageShell>
</template>
