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
// frappe.container.add_page that contains `.layout-main-section`. The page-body
// is that node; we pre-register it in frappe.pages so add_page reuses it (and
// stamps id/data-page-route on it), then change_to fires its "show" event.
onMounted(() => {
	const name = 'Workspaces'
	const page = shell.value?.page
	const pageBody = page?.state.refs.pageBody
	if (!pageBody)
		return // Carry the bridge page on page-body so make_app_page({ parent: pageBody })
		// reuses our chrome instead of spawning a detached page.
	;(pageBody as any).page = page
	frappe.pages[name] = pageBody

	// Build the standard page (add_page -> make_app_page -> new Workspace(...)).
	frappe.standard_pages[name]()

	// Fire the "show" event the standard page bound on the wrapper.
	frappe.container.change_to(name)
})
</script>

<template>
	<PageShell ref="shell" :title="workspaceName" />
</template>
