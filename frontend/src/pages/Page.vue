<script setup lang="ts">
import { useTemplateRef, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const container = useTemplateRef<HTMLDivElement>('container')

let loadedPage = ''
let styleEl: HTMLStyleElement | null = null

function triggerPageEvent(eventName: string) {
	const el = container.value as any
	if (el?.[eventName]) el[eventName](el)
}

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

				// Register in frappe.pages so the page script can find its wrapper
				// via frappe.pages["page-name"].on_page_load = function(wrapper) { ... }
				frappe.pages[name] = el as any
				;(el as any).page_name = name

				if (pagedoc?.content) el.innerHTML = pagedoc.content

				if (pagedoc?.style) {
					styleEl = document.createElement('style')
					styleEl.textContent = pagedoc.style
					document.head.appendChild(styleEl)
				}

				// Eval the page script — this sets on_page_load / on_page_show on el
				frappe.dom.eval(pagedoc?.__script || pagedoc?.script || '')

				triggerPageEvent('on_page_load')

				loadedPage = name
				resolve()
			})
		})
	})

	triggerPageEvent('on_page_show')
	triggerPageEvent('refresh')
}

onMounted(() => loadPage(route.params.doctype as string))

watch(
	() => route.params.doctype,
	(name) => {
		if (name && name !== loadedPage) loadPage(name as string)
	}
)

onBeforeUnmount(teardown)
</script>

<template>
	<div ref="container" class="w-full h-full overflow-auto" />
</template>
