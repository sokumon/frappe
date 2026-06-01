<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import PageShell from '@/components/PageShell.vue'

defineProps<{ isPrivate?: boolean }>()

const route = useRoute()
const workspaceName = computed(
	() => (route.params.workspace as string) || (route.params.slug as string)
)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')

// Standard pages (frappe.standard_pages["Workspaces"]) expect a wrapper from
// frappe.container.add_page that already contains `.layout-main-section`.
// PageShell IS that wrapper, so we pre-register its element in frappe.pages
// before running the standard-page fn, then change_to to fire its "show" event.
onMounted(() => {
	const name = 'Workspaces'
	const page = shell.value?.page
	const wrapper = page?.state.refs.wrapper
	if (!wrapper)
		return // Make container.add_page(name) hand back this PageShell wrapper, carrying
		// the bridge page so make_app_page({ parent: wrapper }) reuses our chrome.
	;(wrapper as any).page = page
	frappe.pages[name] = wrapper

	// Build the standard page (add_page -> make_app_page -> new Workspace(...)).
	frappe.standard_pages[name]()

	// Fire the "show" event the standard page bound on the wrapper.
	frappe.container.change_to(name)
})
</script>

<template>
	<PageShell ref="shell" :title="workspaceName" />
</template>
