<script setup lang="ts">
// FrappeUIProvider mounts <Dialogs /> + <ToastProvider />, which the v1
// imperative dialog/toast APIs render into. <DialogHost> renders the
// frappe.ui.Dialog bridge stack (dialog/createDialog.ts). <ShortcutHost>
// renders the frappe.ui.keys bridge registry through useShortcut and mounts
// the Shift+/ shortcuts modal (boot/keys.ts).
import { FrappeUIProvider } from 'frappe-ui'
import DialogHost from '@/dialog/DialogHost.vue'
import ShortcutHost from '@/components/ShortcutHost.vue'
</script>

<template>
	<FrappeUIProvider>
		<div class="flex h-screen w-screen">
			<router-view />
		</div>
		<DialogHost />
		<ShortcutHost />
	</FrappeUIProvider>
</template>
