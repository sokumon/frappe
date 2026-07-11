<script setup lang="ts">
// FrappeUIProvider mounts <Dialogs /> + <ToastProvider />, which the v1
// imperative dialog/toast APIs render into. <DialogHost> renders the
// frappe.ui.Dialog bridge stack (dialog/createDialog.ts).
import { FrappeUIProvider } from 'frappe-ui'
import DialogHost from '@/dialog/DialogHost.vue'
</script>

<template>
	<FrappeUIProvider>
		<div class="flex h-screen w-screen">
			<router-view />
		</div>
		<DialogHost />
	</FrappeUIProvider>
</template>
