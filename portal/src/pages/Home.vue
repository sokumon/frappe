<template>
	<div class="max-w-3xl py-12 mx-auto">Welcome to the Portal</div>
</template>

<script>
import { Dialog } from 'frappe-ui'

export default {
	name: 'Home',
	data() {
		return {
			showDialog: false,
		}
	},
	resources: {
		ping: {
			url: 'ping',
		},
	},
	components: {
		Dialog,
	},
}
</script>
