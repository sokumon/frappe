<script setup lang="ts">
// FrappeUIProvider mounts <Dialogs /> + <ToastProvider />, which the v1
// imperative dialog/toast APIs render into. <DialogHost> renders the
// frappe.ui.Dialog bridge stack (dialog/createDialog.ts). <ShortcutHost>
// renders the frappe.ui.keys bridge registry through useShortcut and mounts
// the Shift+/ shortcuts modal (boot/keys.ts). <CommandPalette> is the ⌘K
// palette (search/commandPalette.ts) — mounted here so the shortcut is live on
// every route, and so its own window ⌘K listener is always registered.
import { FrappeUIProvider } from 'frappe-ui'
import DialogHost from '@/dialog/DialogHost.vue'
import ShortcutHost from '@/components/ShortcutHost.vue'
// <WorkspaceRail> is the workspace dock (components/WorkspaceRail.vue): app
// chrome that sits left of every page, so it lives here rather than inside
// PageShell, which is re-created per route.
import CommandPalette from '@/components/CommandPalette.vue'
import WorkspaceRail from '@/components/WorkspaceRail.vue'
</script>

<template>
	<FrappeUIProvider>
		<div class="flex h-screen w-screen">
			<WorkspaceRail class="border-r" />
			<router-view />
		</div>
		<DialogHost />
		<ShortcutHost />
		<CommandPalette />
	</FrappeUIProvider>
</template>
