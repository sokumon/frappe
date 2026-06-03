<script setup lang="ts">
import { computed, onMounted, watch, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import PageShell from '@/components/PageShell.vue'

const route = useRoute()
const reportName = computed(() => route.params.reportName as string)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')

const PAGE = 'query-report'

// Standard pages (frappe.standard_pages["query-report"]) expect a wrapper from
// frappe.container.add_page that contains `.layout-main-section`. The page-body
// is that node; we pre-register it in frappe.pages so add_page reuses it (and
// stamps id/data-page-route on it), then change_to fires its "show" event.
onMounted(() => {
	const page = shell.value?.page
	const pageBody = page?.state.refs.pageBody
	if (!pageBody)
		return // Carry the bridge page on page-body so make_app_page({ parent: pageBody })
		// reuses our chrome instead of spawning a detached page.
	;(pageBody as any).page = page
	debugger
	frappe.pages[PAGE] = pageBody

	// Build the standard page (add_page -> make_app_page -> new QueryReport(...)).
	frappe.standard_pages[PAGE]()

	// Fire the "show" event the standard page bound on the wrapper; QueryReport
	// reads the report name from the current route inside show().
	frappe.container.change_to(PAGE)
})

// Unlike Workspace, navigating between reports keeps this component mounted
// (route name stays "query-report", only :reportName changes), so re-fire the
// wrapper's "show" so QueryReport reloads for the new route.
watch(reportName, () => {
	if (frappe.pages[PAGE]) frappe.container.change_to(PAGE)
})
</script>

<template>
	<PageShell ref="shell" :title="reportName" />
</template>
