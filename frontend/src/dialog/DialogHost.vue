<template>
	<!-- Renders the reactive dialog stack maintained by createDialog.ts: every
	     legacy `new frappe.ui.Dialog({...})` becomes a frappe-ui <Dialog> with a
	     <FormLayout> body. Multiple entries = legacy stacked dialogs. -->
	<Dialog
		v-for="d in dialogStack"
		:key="d.id"
		:open="d.open"
		:title="d.title"
		:size="d.size"
		:icon="dialogIcon(d)"
		:dismissible="!d.static"
		:show-close-button="!d.static && !d.noCancel"
		@update:open="(open: boolean) => !open && d.dialog.hide()"
		@after-leave="d.dialog._afterLeave()"
	>
		<div
			:ref="(el) => bindRoot(d, el)"
			class="dialog-bridge-body flex flex-col gap-3"
			@keydown="onKeydown(d, $event)"
		>
			<!-- set_alert: prepended banner, kept above both body modes -->
			<!-- eslint-disable-next-line vue/no-v-html -->
			<div v-if="d.alert" :class="`alert alert-${d.alert.cls}`" v-html="d.alert.text" />

			<!-- set_message replaces the field body (legacy modal-message) -->
			<div v-if="d.message" class="modal-message text-base text-ink-gray-7">
				{{ d.message }}
			</div>
			<template v-else>
				<FormLayout v-if="hasFields(d)" :layout="d.layout" v-model:doc="d.doc" />
				<!-- custom DOM appended by callers via d.body / d.$body -->
				<div :ref="(el) => adoptBody(d, el)" />
			</template>
		</div>

		<template v-if="hasActions(d)" #actions>
			<div class="flex w-full items-center gap-2">
				<Button
					v-for="(action, i) in d.customActions"
					:key="i"
					variant="subtle"
					:class="action.extraClass"
					:disabled="action.disabled"
					:loading="action.loading"
					@click="action.onClick?.()"
				>
					{{ action.label }}
				</Button>
				<div class="ml-auto flex flex-row-reverse gap-2">
					<Button
						v-if="d.primary.visible"
						variant="solid"
						:theme="actionTheme(d.primary)"
						:disabled="d.primary.disabled"
						:loading="d.primary.loading"
						@click="d.primary.onClick?.()"
					>
						{{ d.primary.label }}
					</Button>
					<Button
						v-if="d.secondary.visible"
						variant="outline"
						:disabled="d.secondary.disabled"
						@click="d.secondary.onClick?.()"
					>
						{{ d.secondary.label }}
					</Button>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { FormLayout } from '@framework/ui/FormLayout'
import { dialogStack, THEME_ICON } from './createDialog'
import type { DialogActionState } from './createDialog'
import type { ComponentPublicInstance } from 'vue'

function hasFields(d: any): boolean {
	return !!d.layout?.length
}

function hasActions(d: any): boolean {
	return d.primary?.visible || d.secondary?.visible || d.customActions?.length > 0
}

// indicator theme (blue/red/green/yellow) → header icon, like the msgprint bridge.
function dialogIcon(d: any) {
	if (!d.indicator) return undefined
	return { name: THEME_ICON[d.indicator], theme: d.indicator }
}

// frappe.warn() re-themes the legacy primary button by swapping btn-primary for
// btn-danger through the button proxy; honor it as the red theme.
function actionTheme(action: DialogActionState) {
	return action.extraClass?.includes('btn-danger') ? 'red' : undefined
}

// Stamp the rendered body element onto the state so the bridge can resolve
// $wrapper / field wrappers / focus targets against live DOM.
function bindRoot(d: any, el: Element | ComponentPublicInstance | null) {
	const node = el as HTMLElement | null
	d.rootEl = node ? (node.closest('[role="dialog"]') as HTMLElement) ?? node : null
}

// Adopt the detached custom-DOM container (populated via d.$body.append(...)
// before show()) into the rendered body.
function adoptBody(d: any, el: Element | ComponentPublicInstance | null) {
	const node = el as HTMLElement | null
	if (node && d.bodyEl && d.bodyEl.parentElement !== node) {
		node.appendChild(d.bodyEl)
	}
}

// Legacy catch_enter_as_submit: Enter in a text-ish input triggers the primary
// action unless the dialog opted out. Ctrl/Cmd+Enter triggers it from anywhere
// (QuickEntryForm's setup_cmd_enter_for_save binding, absorbed here since the
// bridge has no live wrapper to bind on before mount).
function onKeydown(d: any, event: KeyboardEvent) {
	if (event.key !== 'Enter') return
	const dialog = d.dialog
	if (!dialog?.has_primary_action) return

	const firePrimary = () => {
		if (d.primary.visible && !d.primary.disabled && !d.primary.loading) {
			d.primary.onClick?.()
		}
	}

	if (event.ctrlKey || event.metaKey) {
		event.preventDefault()
		firePrimary()
		return
	}

	if (dialog.no_submit_on_enter) return
	const target = event.target as HTMLInputElement | null
	if (!target) return
	const tag = target.tagName
	const textish = ['text', 'password', 'search', 'email', 'tel', 'url', 'number']
	if ((tag === 'INPUT' && textish.includes(target.type)) || tag === 'SELECT') {
		event.preventDefault()
		firePrimary()
	}
}
</script>
