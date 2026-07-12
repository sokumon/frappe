// Contract tests for the frappe.ui.keys bridge (boot/keys.ts): legacy combo
// strings must convert to frappe-ui ShortcutConfig shapes, add_shortcut must
// keep legacy replace/off/preventDefault semantics, and the on() population
// must keep the legacy all-handlers-fire dispatcher.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installKeys, shortcutEntries, shortcutsModalOpen } from '../keys'

const g: any = globalThis

let keydownHandler: ((e: any) => any) | undefined

function installGlobals() {
	keydownHandler = undefined
	const jq: any = (target: any) => ({
		on: (evt: string, fn: any) => {
			if (target === window && evt === 'keydown') keydownHandler = fn
		},
		trigger: () => {},
		length: 0,
		data: () => undefined,
	})
	jq.fn = {}
	g.$ = jq
	;(window as any).$ = jq

	const frappe: any = {
		provide(ns: string) {
			let cur: any = g
			for (const part of ns.split('.')) {
				cur[part] = cur[part] || {}
				cur = cur[part]
			}
		},
		utils: {
			to_title_case: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
			is_mac: () => false,
			escape_html: (s: string) => s,
		},
	}
	g.frappe = frappe
	;(window as any).frappe = frappe
}

function entry(combo: string, page: any = null) {
	return shortcutEntries.find((en) => en.combo === combo && en.page === page)
}

describe('frappe.ui.keys bridge', () => {
	beforeEach(() => {
		shortcutEntries.splice(0, shortcutEntries.length)
		shortcutsModalOpen.value = false
		installGlobals()
		installKeys()
	})

	it('registers the keyboard.js global shortcuts through the bridge', () => {
		for (const combo of ['ctrl+s', 'ctrl+k', 'ctrl+g', 'shift+/', 'shift+ctrl+r']) {
			expect(entry(combo), combo).toBeTruthy()
		}
	})

	it('converts legacy combo strings to frappe-ui key/modifier fields', () => {
		const keys = g.frappe.ui.keys
		expect(entry('shift+ctrl+r')!.config).toMatchObject({ key: 'r', ctrl: true, shift: true, alt: false })
		// shift-produced character: legacy "shift+/" fires with e.key === "?"
		expect(entry('shift+/')!.config).toMatchObject({ key: '?', shift: true })

		keys.add_shortcut({ shortcut: 'Ctrl+Y', action: () => {} })
		expect(entry('ctrl+y')!.config).toMatchObject({ key: 'y', ctrl: true })

		keys.add_shortcut({ shortcut: 'ctrl+up', action: () => {} })
		expect(entry('ctrl+up')!.config).toMatchObject({ key: 'ArrowUp', ctrl: true })

		// legacy key_map named the comma key "<"; unshifted it reports ","
		keys.add_shortcut({ shortcut: 'ctrl+<', action: () => {} })
		expect(entry('ctrl+<')!.config).toMatchObject({ key: ',', ctrl: true })
		keys.add_shortcut({ shortcut: 'shift+ctrl+>', action: () => {} })
		expect(entry('shift+ctrl+>')!.config).toMatchObject({ key: '>', ctrl: true, shift: true })
	})

	it('opts out of frappe-ui defaults the way legacy dispatch behaved', () => {
		const cfg: any = entry('ctrl+s')!.config
		expect(cfg.allowInDialog).toBe(true)
		expect(cfg.preventDefault).toBe(false)
		expect(cfg.allowInInput).toBe(true) // registered with ignore_inputs: true

		g.frappe.ui.keys.add_shortcut({ shortcut: 'ctrl+j', action: () => {} })
		expect((entry('ctrl+j')!.config as any).allowInInput).toBe(false)
	})

	it('prevents default when the action returns undefined/true, not on false', () => {
		const keys = g.frappe.ui.keys
		const run = (action: any) => {
			keys.add_shortcut({ shortcut: 'ctrl+m', action })
			const e = { preventDefault: vi.fn() } as any
			;(entry('ctrl+m')!.config as any).handler(e)
			return e.preventDefault
		}
		expect(run(() => undefined)).toHaveBeenCalled()
		expect(run(() => true)).toHaveBeenCalled()
		expect(run(() => false)).not.toHaveBeenCalled()
	})

	it('display-only entries (no action) never consume the event', () => {
		g.frappe.ui.keys.add_shortcut({ shortcut: 'tab', description: 'Next field', page: {} })
		const e = { preventDefault: vi.fn() } as any
		shortcutEntries.find((en) => en.combo === 'tab')!.config.handler!(e)
		expect(e.preventDefault).not.toHaveBeenCalled()
	})

	it('re-registering the same combo for the same page replaces the entry', () => {
		const keys = g.frappe.ui.keys
		const page = {}
		keys.add_shortcut({ shortcut: 'ctrl+b', page, action: () => {} })
		keys.add_shortcut({ shortcut: 'ctrl+b', page, action: () => {} })
		expect(shortcutEntries.filter((en) => en.combo === 'ctrl+b')).toHaveLength(1)

		const other = {}
		keys.add_shortcut({ shortcut: 'ctrl+b', page: other, action: () => {} })
		expect(shortcutEntries.filter((en) => en.combo === 'ctrl+b')).toHaveLength(2)
	})

	it('off(combo, page) removes only that page; off(combo) removes all', () => {
		const keys = g.frappe.ui.keys
		const page = {}
		keys.add_shortcut({ shortcut: 'ctrl+b', page, action: () => {} })
		keys.add_shortcut({ shortcut: 'ctrl+b', page: {}, action: () => {} })
		keys.off('ctrl+b', page)
		expect(shortcutEntries.filter((en) => en.combo === 'ctrl+b')).toHaveLength(1)
		keys.off('ctrl+b')
		expect(shortcutEntries.filter((en) => en.combo === 'ctrl+b')).toHaveLength(0)
	})

	it("condition gates on the user condition and the page's visibility", () => {
		const keys = g.frappe.ui.keys
		let allowed = false
		keys.add_shortcut({ shortcut: 'ctrl+i', action: () => {}, condition: () => allowed })
		const cond = (entry('ctrl+i')!.config as any).condition
		expect(cond()).toBe(false)
		allowed = true
		expect(cond()).toBe(true)

		const page = { wrapper: { is: (sel: string) => false } }
		keys.add_shortcut({ shortcut: 'ctrl+e', page, action: () => {} })
		expect((entry('ctrl+e', page)!.config as any).condition()).toBe(false)
		page.wrapper.is = () => true
		expect((entry('ctrl+e', page)!.config as any).condition()).toBe(true)
	})

	it('get_key builds legacy combo strings from keyCode events', () => {
		const keys = g.frappe.ui.keys
		expect(keys.get_key({ keyCode: 83, ctrlKey: true })).toBe('ctrl+s')
		expect(keys.get_key({ keyCode: 191, shiftKey: true })).toBe('shift+/')
		expect(keys.get_key({ keyCode: 27 })).toBe('escape')
	})

	it('on() keeps legacy all-handlers-fire + return-false dispatch', () => {
		const keys = g.frappe.ui.keys
		const first = vi.fn()
		const second = vi.fn(() => false)
		keys.on('ctrl+q', first)
		keys.on('ctrl+q', second)
		expect(keydownHandler).toBeTypeOf('function')
		const out = keydownHandler!({ keyCode: 81, ctrlKey: true })
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
		expect(out).toBe(false)
	})

	it('escape keydown routes through the ported handler without crashing', () => {
		expect(() => keydownHandler!({ keyCode: 27 })).not.toThrow()
	})

	it('show_keyboard_shortcut_dialog opens the frappe-ui modal', () => {
		g.frappe.ui.keys.show_keyboard_shortcut_dialog()
		expect(shortcutsModalOpen.value).toBe(true)
	})

	it('get_shortcut_label title-cases combos (non-mac)', () => {
		expect(g.frappe.ui.keys.get_shortcut_label('ctrl+s')).toBe('Ctrl+S')
	})

	it('keeps frappe.ui.keyCode for legacy control code', () => {
		expect(g.frappe.ui.keyCode.ESCAPE).toBe(27)
		expect(g.frappe.ui.keyCode.ENTER).toBe(13)
	})
})
