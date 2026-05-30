<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
	<div class="flex h-full w-full flex-col items-center justify-center gap-2">
		<div class="text-3xl">404</div>
		<div class="text-ink-gray-6">No page found for {{ route.path }}</div>
	</div>
</template>
