<template>
	<!-- Not a scroll container itself: the inner `main.layout-main` (overflow-auto)
		 is the single scroller. This was previously `overflow-auto` *without* being
		 a flex container, so the page-body chain stayed content-height and THIS
		 element scrolled — leaving the inner `main.layout-main` unbounded, so form
		 tabs' `position: sticky` (resolved against it) never moved. Becoming a flex
		 column makes the page-body fill and bound the chain, so `main.layout-main`
		 is the real, bounded scroller. `min-h-0`/`min-w-0` let it shrink to enable
		 that scrolling instead of overflowing. -->
	<div
		ref="el"
		class="main-section overflow-hidden flex flex-col flex-1 min-h-0 min-w-0"
		:class="{ 'old-desk-view': legacyStyles }"
	>
		<slot />
	</div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'

// `old-desk-view` scopes the legacy desk SCSS (form controls, grids, etc.). Views
// that render their own Vue UI into the main section (e.g. the Form's FormLayout)
// opt out with `:legacy-styles="false"` so that SCSS doesn't bleed into them; the
// structural flex/scroll classes above always apply.
withDefaults(defineProps<{ legacyStyles?: boolean }>(), { legacyStyles: true })

const el = useTemplateRef<HTMLDivElement>('el')
defineExpose({ el })
</script>
