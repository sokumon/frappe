<script setup lang="ts">
// Row renderer for the ⌘K palette. frappe-ui's stock CommandPaletteItem prints
// `item.title` as text, but every `frappe.search.utils` option carries markup in
// its label — the `<mark>` spans fuzzy_search wraps around the matched
// characters, plus the `<strong>`/field-name spans the recent-page and
// global-search builders emit. So this renders the label as HTML, sanitized
// (global-search descriptions interpolate raw document content, which the
// legacy make_description never escaped).
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import type { PaletteItem } from '@/search/commandPalette'

const props = defineProps<{ item: PaletteItem; active?: boolean }>()

const label = computed(() => DOMPurify.sanitize(props.item.html ?? props.item.title ?? ''))
const description = computed(() =>
	props.item.description ? DOMPurify.sanitize(props.item.description) : ''
)
</script>

<template>
	<div
		class="flex w-full min-w-0 items-center rounded px-2 py-2 text-base-medium text-ink-gray-8"
		:class="{ 'bg-surface-gray-2': active }"
	>
		<component :is="item.icon" v-if="item.icon" class="mr-3 size-4 shrink-0 text-ink-gray-7" />
		<span class="overflow-hidden text-ellipsis whitespace-nowrap" v-html="label" />
		<span
			v-if="description"
			class="ml-auto overflow-hidden text-ellipsis whitespace-nowrap pl-3 text-ink-gray-5"
			v-html="description"
		/>
	</div>
</template>

<style scoped>
/* fuzzy_search / global-search highlighting. The palette row already sets the
   surface, so <mark> only needs to carry weight + colour, not a block. */
:deep(mark) {
	background: transparent;
	color: var(--ink-gray-9, inherit);
	font-weight: 600;
}
</style>
