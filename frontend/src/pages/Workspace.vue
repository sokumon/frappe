<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

defineProps<{ isPrivate?: boolean }>()

const route = useRoute()
const workspaceName = computed(
	() => (route.params.workspace as string) || (route.params.slug as string)
)
</script>

<template>
	<div class="flex h-full w-full items-center justify-center text-2xl">
		Workspace: {{ workspaceName }}
	</div>
</template>
