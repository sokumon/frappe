<script setup lang="ts">
import { computed, onMounted, watch, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import PageShell from '@/components/PageShell.vue'

const route = useRoute()
const reportName = computed(() => route.params.reportName as string)

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')

const PAGE = 'query-report'

// Standard pages (frappe.standard_pages["query-report"]) expect a wrapper from
// frappe.container.add_page that already contains `.layout-main-section`.
// PageShell IS that wrapper, so we pre-register its element in frappe.pages
// before running the standard-page fn, then change_to to fire its "show" event.
onMounted(() => {
	const page = shell.value?.page
	const wrapper = page?.state.refs.wrapper
	if (!wrapper)
		return // Make container.add_page(name) hand back this PageShell wrapper, carrying
		// the bridge page so make_app_page({ parent: wrapper }) reuses our chrome.
	;(wrapper as any).page = page
	frappe.pages[PAGE] = wrapper

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
