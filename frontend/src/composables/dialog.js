import { reactive, h, render, defineComponent } from 'vue'
import { Button, Dialog, dialog } from 'frappe-ui'

// Bridge for legacy frappe.msgprint / hide_msgprint / update_msgprint ->
// frappe-ui's <Dialog> (v1), driven imperatively. Unlike frappe-ui's
// dialog.confirm() (plain-text message, one dialog per call), msgprint needs:
//   - raw HTML bodies (server validation, as_list/as_table, links)
//   - a singleton dialog that stacks successive messages with <hr>
//   - indicator colors + primary/secondary actions
//   - hide_msgprint / update_msgprint helpers
// so we render the bare <Dialog> component into a standalone container instead
// of going through the <Dialogs> provider. Wired onto frappe.* in main.ts.

// msgprint indicator color -> frappe-ui DialogTheme (only red/yellow/blue/green
// exist; everything unknown falls back to blue, matching the legacy default).
const INDICATOR_THEME = {
	blue: 'blue',
	red: 'red',
	green: 'green',
	orange: 'yellow',
	yellow: 'yellow',
}

// DialogTheme -> header icon (mirrors frappe-ui's THEME_DEFAULT_ICON).
const THEME_ICON = {
	red: 'lucide-alert-triangle',
	yellow: 'lucide-alert-triangle',
	blue: 'lucide-info',
	green: 'lucide-check-circle',
}

// Button has no `yellow` theme; fall back to the default solid button there.
function buttonTheme(theme) {
	return theme === 'yellow' ? undefined : theme
}

const state = reactive({
	open: false,
	title: '',
	message: '', // accumulated HTML across stacked msgprint() calls
	theme: 'blue',
	wide: false,
	primary_action: null, // { label, action }
	secondary_action: null, // { label, action }
	custom_onhide: null, // re_route hook, run once on close
})

let mounted = false

// Mount the singleton dialog component once. It reads `state` reactively, so
// every subsequent msgprint() just mutates `state` and the dialog re-renders.
function ensureMounted() {
	if (mounted) return
	const container = document.createElement('div')
	document.body.appendChild(container)

	const component = defineComponent({
		name: 'MsgprintDialog',
		setup() {
			return () => {
				const slots = {
					// class "msgprint" is relied on by tests; keep it.
					default: () => h('div', { class: 'msgprint', innerHTML: state.message }),
				}

				const actions = []
				if (state.secondary_action) {
					actions.push(
						h(
							Button,
							{
								variant: 'outline',
								onClick: () => state.secondary_action.action?.(),
							},
							() => state.secondary_action.label
						)
					)
				}
				if (state.primary_action) {
					actions.push(
						h(
							Button,
							{
								variant: 'solid',
								theme: buttonTheme(state.theme),
								onClick: () => state.primary_action.action?.(),
							},
							() => state.primary_action.label
						)
					)
				}
				if (actions.length) {
					slots.actions = () =>
						h('div', { class: 'flex flex-row-reverse gap-2' }, actions)
				}

				return h(
					Dialog,
					{
						open: state.open,
						'onUpdate:open': (val) => {
							if (!val) doHide()
						},
						title: state.title,
						icon: { name: THEME_ICON[state.theme], theme: state.theme },
						size: state.wide ? 'xl' : 'sm',
						onAfterLeave: () => {
							// Reset content only after the close animation finishes.
							state.message = ''
						},
					},
					slots
				)
			}
		},
	})

	render(h(component), container)
	mounted = true
}

function doHide() {
	if (!state.open) return
	state.open = false
	if (state.custom_onhide) {
		const cb = state.custom_onhide
		state.custom_onhide = null
		cb()
	}
}

// Minimal handle returned to callers that keep the dialog reference.
const handle = {
	hide: () => doHide(),
	get_message: () => state.message,
}

// Translate primary_action.{server_action,client_action} into a callable, same
// as the legacy implementation.
function resolvePrimaryAction(pa) {
	if (pa.server_action && typeof pa.server_action === 'string') {
		return () =>
			frappe.call({
				method: pa.server_action,
				args: pa.args,
				callback() {
					if (pa.hide_on_success) hide_msgprint()
				},
			})
	}
	if (pa.client_action && typeof pa.client_action === 'string') {
		let obj = window
		for (const part of pa.client_action.split('.')) obj = obj[part]
		return () => {
			if (typeof obj === 'function') obj(pa.args)
		}
	}
	return pa.action
}

export function msgprint(msg, title, is_minimizable, re_route) {
	if (!msg) return
	let data
	if ($.isPlainObject(msg)) {
		data = msg
	} else if (typeof msg === 'string' && msg.substr(0, 1) === '{') {
		// passed as JSON
		data = JSON.parse(msg)
	} else {
		data = { message: msg, title: title, re_route: re_route }
	}

	if (!data.indicator) {
		data.indicator = 'blue'
	}

	if (data.as_list) {
		const list_rows = data.message.map((m) => `<li>${m}</li>`).join('')
		data.message = `<ul style="padding-left: 20px">${list_rows}</ul>`
	}

	if (data.as_table) {
		const rows = data.message
			.map((row) => {
				const cols = row.map((col) => `<td>${col}</td>`).join('')
				return `<tr>${cols}</tr>`
			})
			.join('')
		data.message = `<table class="table table-bordered" style="margin: 0;">${rows}</table>`
	}

	if (data.message instanceof Array) {
		let messages = data.message
		const exceptions = messages
			.map((m) => (typeof m == 'string' ? JSON.parse(m) : m))
			.filter((m) => m.raise_exception)

		// only show exceptions if any exceptions exist
		if (exceptions.length) {
			messages = exceptions
		}

		messages.forEach((m) => msgprint(m))
		return
	}

	if (data.alert || data.toast) {
		frappe.show_alert(data)
		return
	}

	ensureMounted()

	// re_route: navigate back to the previous route once the dialog closes.
	if (data.re_route) {
		state.custom_onhide = () => {
			frappe.route_flags.replace_route = true
			let prev_route = frappe.get_prev_route()
			if (prev_route.length == 0) frappe.set_route('')
			frappe.set_route(prev_route)
		}
	}

	// primary / secondary actions
	if (data.primary_action) {
		state.primary_action = {
			label: __(data.primary_action.label) || __(data.primary_action_label) || __('Done'),
			action: resolvePrimaryAction(data.primary_action),
		}
	} else {
		state.primary_action = null
	}

	if (data.secondary_action) {
		state.secondary_action = {
			label: __(data.secondary_action.label) || __('Close'),
			action: data.secondary_action.action,
		}
	} else {
		state.secondary_action = null
	}

	if (data.message == null) {
		data.message = ''
	}

	if (data.message.search(/<br>|<p>|<li>/) == -1) {
		data.message = frappe.utils.replace_newlines(data.message)
	}

	if (data.clear) {
		state.message = ''
	}
	const msg_exists = !data.clear && !!state.message

	if (data.title || !msg_exists) {
		// set title only if it is explicitly given
		// and no existing message exists
		state.title = data.title || __('Message', null, 'Default title of the message dialog')
	}

	state.theme = INDICATOR_THEME[data.indicator] || 'blue'
	state.wide = !!data.wide

	if (msg_exists) {
		// append a separator if another message is already shown
		state.message += '<hr>' + data.message
	} else {
		state.message = data.message
	}

	state.open = true
	return handle
}

export function hide_msgprint() {
	state.message = ''
	doHide()
}

// update html in the existing msgprint (or open a new one if not visible)
export function update_msgprint(html) {
	if (!state.open) {
		msgprint(html)
	} else {
		state.message = html
	}
}

// frappe.confirm -> frappe-ui's canonical imperative dialog.confirm(). Unlike
// msgprint this needs neither HTML bodies nor stacking, so it goes through the
// <Dialogs> provider (mounted by <FrappeUIProvider> in App.vue). reject_action
// fires only on cancel/dismiss (i.e. not after confirm), matching the legacy
// "no if closed without primary action" behavior.
export function confirm(message, confirm_action, reject_action, primary_label, secondary_label) {
	const handle = dialog.confirm({
		title: __('Confirm', null, 'Title of confirmation dialog'),
		message,
		confirmLabel: primary_label
			? __(primary_label)
			: __('Yes', null, 'Approve confirmation dialog'),
		cancelLabel: secondary_label
			? __(secondary_label)
			: __('No', null, 'Dismiss confirmation dialog'),
		onConfirm: () => {
			confirm_action && confirm_action()
		},
		onCancel: () => {
			reject_action && reject_action()
		},
	})
	// Legacy callers expect a dialog with .hide(); alias it onto the handle.
	handle.hide = handle.close
	return handle
}
