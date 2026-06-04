<script setup lang="ts">
import { useTemplateRef, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import PageShell from '@/components/PageShell.vue'

const props = defineProps<{ name?: string }>()

// An empty name means "home" – resolve it to the configured home page,
// mirroring legacy frappe.views.pageview.show("").
const pageName = computed(() => props.name || frappe.boot?.home_page || '')
const container = useTemplateRef<HTMLDivElement>('container')
const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')

let loadedPage = ''
let styleEl: HTMLStyleElement | null = null

function triggerPageEvent(eventName: string) {
	const el = container.value as any
	// The handler is registered on the container (frappe.pages[name] = el), but
	// legacy page scripts expect the page wrapper (#page-wrapper) as the argument.
	if (el?.[eventName]) el[eventName](shell.value?.page?.page_wrapper)
}

// Optional translation helper (legacy global `__`); falls back to identity.
const translate = ((window as any).__ as ((s: string) => string) | undefined) ?? ((s: string) => s)

function teardown() {
	triggerPageEvent('on_page_hide')
	if (container.value) container.value.innerHTML = ''
	styleEl?.remove()
	styleEl = null
}

async function loadPage(name: string) {
	if (!name || !container.value) return

	teardown()

	await new Promise<void>((resolve) => {
		frappe.model.with_doctype('Page', () => {
			frappe.views.pageview.with_page(name, () => {
				const pagedoc = (window as any).locals?.Page?.[name]
				const el = container.value!

				// No such page doc -> show the not-found view (legacy
				// frappe.views.Page: `frappe.show_not_found(name)`).
				if (!pagedoc) {
					frappe.show_not_found?.(name)
					loadedPage = name
					resolve()
					return
				}

				// Register in frappe.pages so the page script can find its wrapper
				// via frappe.pages["page-name"].on_page_load = function(wrapper) { ... }
				frappe.pages[name] = el as any
				;(el as any).page_name = pagedoc.name

				// Expose PageShell's bridge page on the wrapper so the page script
				// drives the Vue chrome — via `wrapper.page` directly or via
				// `make_app_page({ parent: wrapper })` (the bridge reuses it).
				;(el as any).page = shell.value?.page

				// Drive the Navbar title from the page doc (legacy __(pagedoc.title)).
				shell.value?.page?.set_title(translate(pagedoc.title) || pagedoc.name)

				if (pagedoc.content) el.innerHTML = pagedoc.content

				if (pagedoc.style) {
					styleEl = document.createElement('style')
					let styleContent = frappe.dom.scope_page_css(pagedoc.style)
					styleEl.textContent = styleContent
					document.head.appendChild(styleEl)
				}

				// Eval the page script — this sets on_page_load / on_page_show on el
				frappe.dom.eval(pagedoc.__script || pagedoc.script || '')

				triggerPageEvent('on_page_load')

				loadedPage = name
				resolve()
			})
		})
	})

	// legacy `$(wrapper).on("show")` cleared the current form before showing.
	;(window as any).cur_frm = null
	triggerPageEvent('on_page_show')
	triggerPageEvent('refresh')
}

onMounted(() => loadPage(pageName.value))

watch(pageName, (name) => {
	if (name && name !== loadedPage) loadPage(name)
})

onBeforeUnmount(teardown)
</script>

<template>
	<PageShell ref="shell" :sidebar="false" :title="pageName">
		<!-- `contents` removes this wrapper's own box so injected page content
			 lays out directly inside PageShell's <main>; the node still exists as
			 the mount target / event host (frappe.pages[name], on_page_load). -->
		<div ref="container" class="contents" />
	</PageShell>
</template>
