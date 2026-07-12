// makeControl.ts — factory parity with the legacy `frappe.ui.form.make_control`.
//
// Picks the class by `"Control" + df.fieldtype.replace(/ /g,"")` from an internal
// registry (NOT `frappe.ui.form.Control*`, so the legacy classes stay intact for
// page/createPage.ts). Returns `undefined` for an unknown fieldtype — preserving the
// `layout.js:262` null-return contract so a bogus/absent fieldtype makes no
// fields_dict entry.
import { FrappeControl, FrappeControlData, FrappeContainerControl } from './frappeControl'
import type { ControlOpts } from './frappeControl'
import { FrappeControlLink, FrappeControlDynamicLink, FrappeControlSelect } from './linkSelect'
import { FrappeControlCheck } from './check'
import { FrappeControlCode, FrappeControlTextEditor } from './codeEditor'
import { FrappeControlAttach } from './attach'
import { FrappeControlHTML } from './htmlField'
import { FrappeControlTable, FrappeControlTableMultiSelect } from './frappeGrid'

type ControlClass = new (opts: ControlOpts) => any

const REGISTRY: Record<string, ControlClass> = {
	// Concrete subclasses.
	ControlData: FrappeControlData,
	ControlLink: FrappeControlLink,
	ControlDynamicLink: FrappeControlDynamicLink,
	ControlSelect: FrappeControlSelect,
	ControlCheck: FrappeControlCheck,
	ControlCode: FrappeControlCode,
	ControlTextEditor: FrappeControlTextEditor,
	ControlMarkdownEditor: FrappeControlCode,
	ControlHTMLEditor: FrappeControlCode,
	ControlAttach: FrappeControlAttach,
	ControlAttachImage: FrappeControlAttach,
	ControlHTML: FrappeControlHTML,
	ControlTable: FrappeControlTable,
	ControlTableMultiSelect: FrappeControlTableMultiSelect,

	// Layout breaks → lightweight container control (jQuery `wrapper`).
	ControlSectionBreak: FrappeContainerControl as ControlClass,
	ControlColumnBreak: FrappeContainerControl as ControlClass,
	ControlTabBreak: FrappeContainerControl as ControlClass,
	ControlFold: FrappeContainerControl as ControlClass,

	// Valueless display controls → thin base.
	ControlButton: FrappeControl as ControlClass,
	ControlHeading: FrappeControl as ControlClass,

	// Everything else data-bearing → ControlData (the concrete base). Registering
	// them as aliases keeps the factory resolving every fieldtype scripts may probe.
	ControlInt: FrappeControlData,
	ControlFloat: FrappeControlData,
	ControlCurrency: FrappeControlData,
	ControlPercent: FrappeControlData,
	ControlReadOnly: FrappeControlData,
	ControlDate: FrappeControlData,
	ControlDatetime: FrappeControlData,
	ControlTime: FrappeControlData,
	ControlDateRange: FrappeControlData,
	ControlDuration: FrappeControlData,
	ControlText: FrappeControlData,
	ControlSmallText: FrappeControlData,
	ControlLongText: FrappeControlData,
	ControlPassword: FrappeControlData,
	ControlColor: FrappeControlData,
	ControlRating: FrappeControlData,
	ControlPhone: FrappeControlData,
	ControlBarcode: FrappeControlData,
	ControlIcon: FrappeControlData,
	ControlGeolocation: FrappeControlData,
	ControlSignature: FrappeControlData,
	ControlJSON: FrappeControlData,
	ControlAutocomplete: FrappeControlData,
	ControlImage: FrappeControlData,
}

export interface MakeControlOpts {
	df: any
	host: ControlOpts['host']
	layout?: any
}

export function makeControl(opts: MakeControlOpts): any {
	const df = opts.df
	if (!df?.fieldtype) return undefined
	const class_name = 'Control' + String(df.fieldtype).replace(/ /g, '')
	const Cls = REGISTRY[class_name]
	if (!Cls) return undefined
	return new Cls(opts)
}
