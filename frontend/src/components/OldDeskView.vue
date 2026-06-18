<template>
	<div ref="el" class="main-section old-desk-view overflow-auto flex-1"><slot /></div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'

const el = useTemplateRef<HTMLDivElement>('el')
defineExpose({ el })
</script>
