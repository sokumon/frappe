// MultiSelectDialog bridge.
//
// Re-points `frappe.ui.form.MultiSelectDialog` (the record picker behind
// ERPNext's "Get Items From" — erpnext.utils.map_current_doc) at the Vue
// `@framework/ui` <RecordPicker>. The legacy class composes a frappe.ui.Dialog
// but wires its search inputs with pre-mount jQuery `.find(...)` bindings that
// can't attach to Vue-rendered fields, so it gets a native component instead of
// riding the generic Dialog bridge.
//
// Legacy surface reproduced (everything the call sites use):
//   new MultiSelectDialog({ doctype, target, setters (array|object),
//     read_only_setters, data_fields, get_query, add_filters_group,
//     allow_child_item_selection, child_fieldname, child_columns, columns,
//     size, primary_action_label, action })
//   → action(selected_names, { ...setter values, ...data field values,
//     ...custom filter dict, filtered_children })
//   → `this.dialog.hide()` (called from inside `action`)
//   → secondary "Make {doctype}": route_options from setters + frappe.new_doc.

import { h, render } from 'vue'
import { RecordPicker } from '@framework/ui/RecordPicker'
import type { RecordPickerPayload } from '@framework/ui/RecordPicker'

// Legacy modal size → frappe-ui DialogSize (same table as createDialog.ts,
// with the picker's wider default).
const SIZE_MAP: Record<string, string> = {
	small: 'sm',
	large: '4xl',
	'extra-large': '6xl',
}

function translate(text: any, replace?: any, context?: any): string {
	const fn = (window as any).__ as ((...a: any[]) => string) | undefined
	return fn ? fn(text, replace, context) : String(text ?? '')
}

export class MultiSelectDialogBridge {
	[key: string]: any

	constructor(opts: any = {}) {
		Object.assign(this, opts)
		this.for_select = this.doctype == '[Select]'

		// '[Select]' mode (pick from provided values, no doctype) has no known
		// runtime call site in frappe/erpnext; keep it on the legacy class.
		const Legacy = (window as any).frappe?.ui?.form?.LegacyMultiSelectDialog
		if (this.for_select && Legacy) {
			return new Legacy(opts)
		}

		this.args = {}
		frappe.model.with_doctype(this.doctype, () => this.init())
	}

	init() {
		const setters = this.normalize_setters()

		let childDoctype: string | undefined
		if (this.allow_child_item_selection && this.child_fieldname) {
			childDoctype = frappe.meta.get_docfield(this.doctype, this.child_fieldname)?.options
		}

		// Exposed before `action` runs: call sites close the picker with
		// `d.dialog.hide()` from inside the action callback.
		this.dialog = {
			hide: () => this.hide(),
			show: () => this.show(),
		}

		this._open = false
		this._props = {
			doctype: this.doctype,
			title: translate('Select {0}', [translate(this.doctype)]),
			setters,
			dataFields: this.data_fields,
			getQuery: this.get_query,
			showFilters: !!this.add_filters_group,
			childFieldname: this.allow_child_item_selection ? this.child_fieldname : undefined,
			childDoctype,
			childColumns: this.child_columns,
			columns: this.columns,
			primaryActionLabel: this.primary_action_label || translate('Get Items'),
			secondaryActionLabel: translate('Make {0}', [translate(this.doctype)]),
			size: SIZE_MAP[this.size] || undefined,
			onPick: (payload: RecordPickerPayload) => {
				this.action?.(payload.selections, {
					...this.args,
					...payload.args,
				})
			},
			onMakeNew: (values: Record<string, any>) => {
				// Legacy make_new_document: seed the new form from the setters.
				frappe.route_options = {}
				for (const df of setters) {
					if (df.fieldname) {
						frappe.route_options[df.fieldname] = values[df.fieldname] || undefined
					}
				}
				this.hide()
				frappe.new_doc(this.doctype, true)
			},
		}

		this._container = document.createElement('div')
		document.body.appendChild(this._container)
		this.show()
	}

	// Legacy accepts setters as an array of dfs or a { fieldname: default }
	// object resolved against the doctype meta.
	normalize_setters(): any[] {
		const setters = this.setters || {}
		if (Array.isArray(setters)) return setters
		return Object.keys(setters).map((fieldname) => {
			const df = frappe.meta.docfield_map[this.doctype]?.[fieldname] || {}
			return {
				fieldtype: df.fieldtype || 'Data',
				label: df.label || fieldname,
				fieldname,
				options: df.options,
				read_only: this.read_only_setters?.includes(fieldname) ? 1 : 0,
				default: setters[fieldname],
			}
		})
	}

	// render() vnodes capture plain values, so every open/close re-renders with
	// the current flag (the picker itself is reactive internally).
	_render() {
		if (!this._container) return
		render(
			h(RecordPicker, {
				...this._props,
				open: this._open,
				'onUpdate:open': (open: boolean) => (open ? this.show() : this.hide()),
			}),
			this._container,
		)
	}

	show() {
		if (!this._container) return
		this._open = true
		this._render()
	}

	hide() {
		if (!this._container || !this._open) return
		this._open = false
		this._render()
		// Instances are throwaway (call sites construct one per click): unmount
		// after the Dialog's leave transition.
		setTimeout(() => {
			if (this._container) {
				render(null, this._container)
				this._container.remove()
				this._container = null
			}
		}, 300)
	}
}

export function installMultiSelectDialogBridge() {
	const f = (window as any).frappe
	if (!f?.ui?.form) return
	if (f.ui.form.MultiSelectDialog && f.ui.form.MultiSelectDialog !== MultiSelectDialogBridge) {
		f.ui.form.LegacyMultiSelectDialog = f.ui.form.MultiSelectDialog
	}
	f.ui.form.MultiSelectDialog = MultiSelectDialogBridge
}
