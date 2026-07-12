// codeEditor.ts — Code / Text Editor / Markdown controls.
//
// The rich editor instance (ACE `editor` / Quill `quill`) lives inside the Vue
// component, not on the control — so these are `undefined` here (documented gap).
// `set_focus` targets the rendered editable node rather than an `<input>`.
import { FrappeControlData } from './frappeControl'

export class FrappeControlCode extends FrappeControlData {
	editor: any = undefined

	set_focus(): boolean {
		const el = this.$wrapper?.find?.('textarea, [contenteditable], input')?.get?.(0)
		el?.focus?.()
		return !!el
	}
}

export class FrappeControlTextEditor extends FrappeControlData {
	quill: any = undefined

	set_focus(): boolean {
		const el = this.$wrapper?.find?.('[contenteditable], textarea, input')?.get?.(0)
		el?.focus?.()
		return !!el
	}
}
