<script setup lang="ts">
// Doctype list view, rendered through PageShell.
//
// The legacy `frappe.views.ListView` builds its own DOM (.frappe-list, result
// rows, …) into `this.page.main`. We hand it PageShell's page-body as `parent`;
// because page-body carries the bridge `.page`, the legacy `setup_page` takes
// the bridge branch (`this.page = this.parent.page`) and its page chrome
// (Add button, menus, view switcher) renders on the real Navbar.
import { computed, onMounted, onUnmounted, useTemplateRef } from 'vue'
import PageShell from '@/components/PageShell.vue'

// route params: doctype (url slug), view and rest (from the route or the
// /:slug dispatcher).
const props = defineProps<{ doctype: string; view?: string; rest?: string }>()

// the url carries the slug ("sales-order"); the list needs the real doctype
const doctype =
	frappe.router.routes?.[props.doctype]?.doctype || frappe.router.unslug(props.doctype)

const title = computed(() => {
	const fn = (window as any).__ as ((s: string) => string) | undefined
	const name = frappe.router.doctype_layout || doctype
	return fn ? fn(name) : name
})

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')
let listView: any = null

onMounted(() => {
	frappe.realtime?.init?.()

	const pageBody = shell.value?.page?.state.refs.pageBody
	if (!pageBody) return

	// ListView's constructor calls show() (async); it renders into page.main and
	// drives the Navbar via the bridge page on page-body.
	listView = new frappe.views.ListView({ doctype, parent: pageBody })
	;(window as any).cur_list = listView
})

onUnmounted(() => {
	// Tear down the legacy list before the keyed remount builds a new one, so
	// realtime subscriptions don't leak across doctypes.
	listView?.disable_realtime_updates?.()
	if ((window as any).cur_list === listView) (window as any).cur_list = null
	listView = null
})
</script>

<template>
	<PageShell ref="shell" :title="title" />
</template>
