<script setup lang="ts">
const props = defineProps(['doctype', 'view'])
</script>

<template>
	<div class="flex h-full w-full flex-col items-center justify-center gap-1 text-2xl">
		<div>Report</div>
		<div class="text-base text-ink-gray-6">
			doctype: {{ props.doctype }} · view: {{ props.view }}
		</div>
	</div>
</template>
