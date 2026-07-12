// boot/keys.ts
//
// frappe.ui.keys — port of frappe/public/js/frappe/ui/keyboard.js (a
// desk.bundle/list.bundle file that never loads in the Vue shell). Loaded
// legacy code still calls this API at runtime: controls (comment.js,
// text_editor.js use get_key; phone/grid_row/multiselect use frappe.ui.keyCode),
// erpnext POS pages (add_shortcut/on), print_format_builder, and client scripts.
//
// The API is split across two dispatch systems:
//
// 1. `add_shortcut` entries are CONVERTED to frappe-ui's useShortcut system
//    (PR frappe/frappe-ui#728): each call pushes a BridgeEntry into the
//    reactive `shortcutEntries`; <ShortcutHost> (App.vue) mounts one headless
//    registrar per entry whose setup() calls useShortcut — that is what buys
//    dispatch, lifecycle cleanup, and a row in <KeyboardShortcutsModal>.
//
// 2. `on()/off()` handlers keep a verbatim legacy dispatcher (own window
//    keydown listener, keyCode-based get_key). Deliberate: legacy on() runs
//    EVERY handler for a combo (frappe-ui fires first-match-only), has no
//    input/dialog guards, and its handlers have no descriptions — routing
//    them through useShortcut would both change semantics and render blank
//    rows in the shortcuts modal.
//
// Shift+/ opens frappe-ui's <KeyboardShortcutsModal> (via shortcutsModalOpen)
// instead of the legacy HTML-table dialog. get_shortcut_groups /
// generate_shortcuts_html are still ported for legacy consumers
// (user_settings_dialog.js reads them).
//
// Not ported (legacy-desk-only, their consumers don't load in the shell):
// alt_keyboard_shortcuts (Alt-accelerator underlines — get_shortcut_group is
// stubbed so callers don't crash) and the shift+t DropdownConsole.
import { shallowReactive, ref } from 'vue'
import type { ShortcutConfig } from 'frappe-ui'

export interface BridgeEntry {
	id: number
	combo: string // normalized (lowercase) legacy combo string
	page: any // legacy page/frm scoping object, or null for global
	config: ShortcutConfig
}

// Rendered by <ShortcutHost>; splicing an entry unmounts its registrar, which
// runs useShortcut's onBeforeUnmount cleanup (the only unregister path the
// composable offers). shallowReactive, not reactive: entries are immutable
// (only add/remove needs tracking), and a deep proxy would break the
// `en.page === page` identity checks that replace/off rely on.
export const shortcutEntries = shallowReactive<BridgeEntry[]>([])
export const shortcutsModalOpen = ref(false)

let next_entry_id = 1

// ---------------------------------------------------------------------------
// Legacy combo string -> frappe-ui ShortcutConfig fields
// ---------------------------------------------------------------------------

// Legacy names (from key_map / caller convention) -> KeyboardEvent.key
const KEY_NAME_MAP: Record<string, string> = {
	esc: 'Escape',
	escape: 'Escape',
	enter: 'Enter',
	return: 'Enter',
	tab: 'Tab',
	backspace: 'Backspace',
	space: ' ',
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	right: 'ArrowRight',
	del: 'Delete',
	delete: 'Delete',
}
for (let i = 1; i <= 12; i++) KEY_NAME_MAP[`f${i}`] = `F${i}`

// Legacy key_map names the PHYSICAL key: 188 -> "<" (comma), 190 -> ">"
// (period), 191 -> "/". e.key reports the produced character, so the name
// must be re-mapped depending on whether shift is part of the combo.
const SHIFTED: Record<string, string> = { '/': '?', ',': '<', '.': '>' }
const UNSHIFTED: Record<string, string> = { '<': ',', '>': '.' }

function parse_shortcut_string(shortcut: string) {
	let ctrl = false
	let shift = false
	let alt = false
	let key = ''
	for (const raw of String(shortcut).toLowerCase().split('+')) {
		const part = raw.trim()
		if (part === 'ctrl' || part === 'cmd' || part === 'meta') ctrl = true
		else if (part === 'shift') shift = true
		else if (part === 'alt' || part === 'option') alt = true
		else key = part
	}
	key = KEY_NAME_MAP[key] ?? key
	key = (shift ? SHIFTED[key] : UNSHIFTED[key]) ?? key
	return { key, ctrl, shift, alt }
}

// Legacy visibility gate: `!page || page.wrapper.is(":visible")`. The Vue page
// bridge's wrapper proxy may not implement .is(), so fall back to the DOM node
// and stay permissive when the shape is unknown.
function page_visible(page: any): boolean {
	if (!page) return true
	try {
		const w = page.wrapper
		if (w && typeof w.is === 'function') return !!w.is(':visible')
		const el = w?.[0] ?? w
		if (el instanceof HTMLElement) return el.isConnected && el.offsetParent !== null
	} catch (e) {
		// unknown wrapper shape — treat as visible
	}
	return true
}

function remove_entries(pred: (entry: BridgeEntry) => boolean) {
	for (let i = shortcutEntries.length - 1; i >= 0; i--) {
		if (pred(shortcutEntries[i])) shortcutEntries.splice(i, 1)
	}
}

export function installKeys() {
	const w = window as any
	const __ = (t: string) => (w.__ ? w.__(t) : t)

	frappe.provide('frappe.ui.keys.handlers')
	const keys = frappe.ui.keys

	// -----------------------------------------------------------------------
	// Verbatim legacy core: key_map / get_key / on / off / setup
	// -----------------------------------------------------------------------

	keys.key_map = {
		8: 'backspace',
		9: 'tab',
		13: 'enter',
		16: 'shift',
		17: 'ctrl',
		91: 'meta',
		18: 'alt',
		27: 'escape',
		37: 'left',
		39: 'right',
		38: 'up',
		40: 'down',
		32: 'space',
		112: 'f1',
		113: 'f2',
		114: 'f3',
		115: 'f4',
		116: 'f5',
		191: '/',
		188: '<',
		190: '>',
	} as Record<number, string>
	'abcdefghijklmnopqrstuvwxyz'.split('').forEach((letter, i) => {
		keys.key_map[65 + i] = letter
	})

	keys.get_key = function (e: any) {
		const keycode = e.keyCode || e.which
		let key = keys.key_map[keycode] || String.fromCharCode(keycode)
		if (e.ctrlKey || e.metaKey) key = 'ctrl+' + key
		if (e.shiftKey) key = 'shift+' + key
		if (e.altKey) key = 'alt+' + key
		return key.toLowerCase()
	}

	keys.on = function (key: string, handler: (e: any) => any) {
		if (!keys.handlers[key]) keys.handlers[key] = []
		keys.handlers[key].push(handler)
	}

	keys.off = function (key: string, page?: any) {
		const handlers = keys.handlers[key]
		if (handlers?.length) {
			keys.handlers[key] = handlers.filter((h: any) => {
				if (!page) return false
				return h.page !== page
			})
		}
		// also drop converted add_shortcut entries (legacy kept both
		// populations in the same handlers dict)
		const combo = String(key).toLowerCase()
		remove_entries((en) => en.combo === combo && (page ? en.page === page : true))
	}

	keys.setup = function () {
		w.$?.(window).on('keydown', function (e: any) {
			const key = keys.get_key(e)
			if (keys.handlers[key]) {
				let out = null
				for (const handler of [...keys.handlers[key]]) {
					const _out = handler.apply(this, [e])
					if (_out === false) out = _out
				}
				return out
			}
		})
	}

	// -----------------------------------------------------------------------
	// add_shortcut — converted to frappe-ui useShortcut
	// -----------------------------------------------------------------------

	const standard_shortcuts: any[] = []
	keys.standard_shortcuts = standard_shortcuts

	keys.get_shortcut_label = function (shortcut: string) {
		let label = shortcut.split('+').map(frappe.utils.to_title_case).join('+')
		if (frappe.utils.is_mac()) {
			label = label.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧')
		}
		return label
	}

	keys.add_shortcut = ({
		shortcut,
		action,
		description,
		page,
		target,
		condition,
		ignore_inputs = false,
	}: any = {}) => {
		if (!shortcut) return
		if (target) {
			// legacy accepted a jQuery target to click
			const t = target
			action = () => (t[0] ?? t)?.click?.()
		}
		if (!condition) condition = () => true

		const combo = String(shortcut).toLowerCase()
		const parsed = parse_shortcut_string(combo)
		const scope_page = page ?? null

		// legacy: re-registering the same combo for the same page replaces it
		remove_entries((en) => en.combo === combo && en.page === scope_page)

		// Legacy modal sections were Global/Page/Grid, resolved against
		// cur_page at open time; here the page_visible() condition hides
		// inactive pages' entries, so a static group label is enough.
		const group = !scope_page
			? __('Global Shortcuts')
			: scope_page.fields_dict
			? __('Grid Shortcuts')
			: __('Page Shortcuts')

		shortcutEntries.push({
			id: next_entry_id++,
			combo,
			page: scope_page,
			config: {
				...parsed,
				description: description ?? '',
				group,
				condition: () => condition() && page_visible(scope_page),
				// legacy shortcuts fired inside dialogs (ctrl+s submits the
				// open dialog), and preventDefault is decided by the action's
				// return value, so both frappe-ui defaults are opted out of
				allowInDialog: true,
				allowInInput: !!ignore_inputs,
				preventDefault: false,
				handler: (e: KeyboardEvent) => {
					if (!action) return // display-only entry (e.g. grid docs)
					const out = action(e)
					// legacy: prevent default when true or nothing is returned
					if (out || out === undefined) e.preventDefault()
				},
			},
		})

		// keep the legacy list for get_shortcut_groups consumers
		const existing = standard_shortcuts.findIndex((s) => s.shortcut === shortcut)
		const new_shortcut = { shortcut, action, description, page, condition }
		if (existing === -1) standard_shortcuts.push(new_shortcut)
		else standard_shortcuts[existing] = new_shortcut
	}

	// -----------------------------------------------------------------------
	// Legacy shortcut-dialog helpers, kept for user_settings_dialog.js
	// -----------------------------------------------------------------------

	keys.get_shortcut_groups = () => {
		const page_name = w.cur_page?.page?.page
		const frm_name = w.cur_page?.page?.frm
		return [
			{ heading: __('Global Shortcuts'), shortcuts: standard_shortcuts.filter((s) => !s.page) },
			{
				heading: __('Page Shortcuts'),
				shortcuts: standard_shortcuts.filter((s) => s.page && s.page === page_name),
			},
			{
				heading: __('Grid Shortcuts'),
				shortcuts: standard_shortcuts.filter((s) => s.page && s.page === frm_name),
			},
		]
	}

	keys.generate_shortcuts_html = (shortcuts: any[], heading: string) => {
		if (!shortcuts.length) return ''
		const deduped: any[] = []
		const seen: Record<string, number> = {}
		shortcuts
			.filter((s) => (s.condition ? s.condition() : true))
			.filter((s) => !!s.description)
			.forEach((shortcut) => {
				if (seen[shortcut.description] !== undefined) {
					deduped[seen[shortcut.description]].keys.push(shortcut.shortcut)
				} else {
					seen[shortcut.description] = deduped.length
					deduped.push({ ...shortcut, keys: [shortcut.shortcut] })
				}
			})
		const rows = deduped
			.map((shortcut) => {
				const label = shortcut.keys
					.map(
						(k: string) =>
							`<kbd>${frappe.utils.escape_html(keys.get_shortcut_label(k))}</kbd>`
					)
					.join(' / ')
				const description = frappe.utils.escape_html(shortcut.description || '')
				return `<tr><td width="40%">${label}</td><td width="60%">${description}</td></tr>`
			})
			.join('')
		if (!rows) return ''
		return `<h5 style="margin: 0;">${heading}</h5>
			<table style="margin-top: 10px;" class="table table-bordered">${rows}</table>`
	}

	keys.show_keyboard_shortcut_dialog = () => {
		shortcutsModalOpen.value = true
	}

	// Alt-accelerator API (alt_keyboard_shortcuts.js) is not ported — the Vue
	// shell renders menus natively. Stub it so legacy callers don't crash.
	const alt_group_stub = { add() {}, remove() {} }
	keys.get_shortcut_group = () => alt_group_stub
	keys.bind_shortcut_group_event = () => {}

	// -----------------------------------------------------------------------
	// frappe.ui.keyCode + $.fn.enterKey (verbatim)
	// -----------------------------------------------------------------------

	frappe.ui.keyCode = {
		ESCAPE: 27,
		LEFT: 37,
		RIGHT: 39,
		UP: 38,
		DOWN: 40,
		ENTER: 13,
		TAB: 9,
		SPACE: 32,
		BACKSPACE: 8,
	}

	if (w.$?.fn) {
		w.$.fn.enterKey = function (fnc: (ev: any) => void) {
			return this.each(function (this: any) {
				w.$(this).keypress(function (this: any, ev: any) {
					const keycode = ev.keyCode ? ev.keyCode : ev.which
					if (keycode == '13') fnc.call(this, ev)
				})
			})
		}
	}

	// -----------------------------------------------------------------------
	// Global shortcuts from keyboard.js
	// -----------------------------------------------------------------------

	// app.js's trigger_primary_action, guarded for the Vue shell (frappe.app
	// may not define it; the page-bridge button proxies may lack .is()).
	function trigger_primary_action() {
		if (typeof frappe.app?.trigger_primary_action === 'function') {
			return frappe.app.trigger_primary_action()
		}
		;(document.activeElement as HTMLElement | null)?.blur?.()
		setTimeout(() => {
			const d = w.cur_dialog
			const frm = w.cur_frm
			if (d && d.display && !d.is_minimized) {
				d.get_primary_btn?.()?.trigger?.('click')
			} else if (frm?.page?.btn_primary?.is?.(':visible')) {
				frm.page.btn_primary.trigger('click')
			} else if (frm?.save) {
				frm.save()
			}
		}, 100)
	}

	keys.add_shortcut({
		shortcut: 'ctrl+s',
		action: function (e: KeyboardEvent) {
			trigger_primary_action()
			e.preventDefault()
			return false
		},
		description: __('Trigger primary action'),
		ignore_inputs: true,
	})

	keys.add_shortcut({
		shortcut: 'ctrl+k',
		action: function (e: KeyboardEvent) {
			const fn = frappe.search?.open_awesomebar_from_global_search_shortcut
			if (!fn) return false // keep the browser default when there's no awesomebar
			return fn(e)
		},
		description: __('Open Awesomebar'),
		ignore_inputs: true,
	})

	keys.add_shortcut({
		shortcut: 'ctrl+g',
		action: function (e: KeyboardEvent) {
			const fn = frappe.search?.open_global_search_from_navbar_shortcut
			if (!fn) return false
			return fn(e)
		},
		description: __('Open Global Search'),
		ignore_inputs: true,
	})

	keys.add_shortcut({
		shortcut: 'shift+/',
		action: function () {
			keys.show_keyboard_shortcut_dialog()
		},
		description: __('Show keyboard shortcuts'),
	})

	keys.add_shortcut({
		shortcut: 'shift+ctrl+r',
		action: function () {
			if (frappe.ui.toolbar?.clear_cache) return frappe.ui.toolbar.clear_cache()
			frappe.assets?.clear_local_storage?.()
			window.location.reload()
		},
		description: __('Clear cache and reload'),
	})

	// The legacy handler also cancelled cur_dialog; in the Vue shell the
	// frappe-ui <Dialog> owns its own Escape, so only the grid-row/blur/event
	// halves are kept (double-cancelling caused the dialog to close twice).
	function handle_escape_key() {
		const open_row = w.$?.('.grid-row-open')
		if (open_row?.length) {
			open_row.data('grid_row')?.toggle_view(false)
		}
		;(document.activeElement as HTMLElement | null)?.blur?.()
		w.$?.(document).trigger('escape')
	}

	keys.on('escape', handle_escape_key)
	keys.on('esc', handle_escape_key)

	keys.on('enter', function () {
		// legacy frappe.confirm dialogs (confirm_dialog flag) submit on Enter
		if (w.cur_dialog && w.cur_dialog.confirm_dialog) {
			w.cur_dialog.get_primary_btn?.()?.trigger?.('click')
		}
	})

	keys.on('ctrl+down', function (e: KeyboardEvent) {
		const grid_row = frappe.ui.form?.get_open_grid_form?.()
		if (grid_row?.has_next()) {
			grid_row.toggle_view(false, function () {
				grid_row.open_next()
			})
		} else {
			e.preventDefault()
		}
	})

	keys.on('ctrl+up', function (e: KeyboardEvent) {
		const grid_row = frappe.ui.form?.get_open_grid_form?.()
		if (grid_row?.has_prev()) {
			grid_row.toggle_view(false, function () {
				grid_row.open_prev()
			})
		} else {
			e.preventDefault()
		}
	})

	// desk.js (which called setup()) doesn't load in the shell — attach the
	// on()-dispatcher listener here instead.
	keys.setup()
}
