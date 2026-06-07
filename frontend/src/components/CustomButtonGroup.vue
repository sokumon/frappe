<template>
	<div class="custom-btn-group">
		<Button variant="subtle">{{ label }}</Button>
		<ul class="dropdown-menu"></ul>
	</div>
</template>

<script setup>
import { Button } from 'frappe-ui'

const props = defineProps({
	label: {
		type: String,
		default: 'Button Group',
	},
})
</script>
