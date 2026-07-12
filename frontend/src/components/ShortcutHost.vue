<script setup lang="ts">
// Dispatch host for the frappe.ui.keys bridge (boot/keys.ts).
//
// useShortcut must run inside a component setup() — its unregister path is
// onBeforeUnmount, and the internal registry isn't otherwise writable. So
// each bridge entry gets its own headless registrar component: splicing the
// entry out of `shortcutEntries` unmounts the registrar, which unregisters
// the shortcut from frappe-ui's dispatcher and the shortcuts modal.
//
// <KeyboardShortcutsModal> replaces the legacy Shift+/ HTML-table dialog; it
// reads the useShortcut registry itself, no wiring beyond the open flag.
import { defineComponent, watch, type PropType } from 'vue'
import { KeyboardShortcutsModal, useShortcut, type ShortcutConfig } from 'frappe-ui'
import { shortcutEntries, shortcutsModalOpen } from '@/boot/keys'

const ShortcutRegistrar = defineComponent({
	props: {
		config: { type: Object as PropType<ShortcutConfig>, required: true },
	},
	setup(props) {
		useShortcut(props.config)
		return () => null
	},
})

// keyboard.js kept an is_dialog_shown flag; mirror it for legacy readers.
watch(shortcutsModalOpen, (open) => {
	if ((window as any).frappe?.ui?.keys) {
		;(window as any).frappe.ui.keys.is_dialog_shown = open
	}
})
</script>

<template>
	<ShortcutRegistrar v-for="entry in shortcutEntries" :key="entry.id" :config="entry.config" />
	<KeyboardShortcutsModal v-model:open="shortcutsModalOpen" />
</template>
