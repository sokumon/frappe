<template>
	<div ref="el" class="old-desk-view"><slot /></div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'

const el = useTemplateRef<HTMLDivElement>('el')
defineExpose({ el })
</script>
