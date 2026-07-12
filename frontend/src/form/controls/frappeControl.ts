// frappeControl.ts
//
// The Vue-backed control class hierarchy that reproduces the old
// `frappe.ui.form.Control → ControlInput → ControlData` contract, so the thousands
// of erpnext/frappe client scripts that read `frm.fields_dict[f]` keep working
// verbatim. The classes own DATA/MODEL behaviour; the Vue `<FormLayout>` owns
// RENDERING. Bodies are deliberately THIN: they delegate to the `ControlHost`
// (frm ↔ dialog), the reactive `df`, and the live Vue DOM, and skip the per-fieldtype
// client-side parse/validate/format that the Vue components + server already do.
//
// These are prefixed `FrappeControl*` and live in a separate namespace — they do NOT
// overwrite the legacy `frappe.ui.form.ControlData`, which `page/createPage.ts`
// still constructs via the real `make_control`.
import type { ControlHost } from './host'

declare const frappe: any
declare const is_null: (v: any) => boolean
declare const cint: (v: any) => number

export interface ControlOpts {
	df: any
	host: ControlHost
	/** The frm/grid the control sits in (legacy `this.layout`); mostly unused here. */
	layout?: any
}

// --- base: FrappeControl -----------------------------------------------------
export class FrappeControl {
	df: any
	host: ControlHost
	layout: any
	last_value: any
	grid: any = undefined
	only_input = false
	private _disp_status: string | undefined

	constructor(opts: ControlOpts) {
		this.df = opts.df
		this.host = opts.host
		this.layout = opts.layout
	}

	get fieldname(): string {
		return this.df.fieldname
	}
	get fieldtype(): string {
		return this.df.fieldtype
	}
	// LIVE, host-backed — never captured, so a doc (re)load is reflected.
	get doctype(): string | undefined {
		return this.host.doctype ?? this.df.parent
	}
	get docname(): string | undefined {
		return this.host.docname
	}
	get frm(): any {
		return this.host.frm
	}
	get doc(): any {
		return this.host.get_doc()
	}
	get perm(): any {
		return this.host.frm?.perm
	}

	// `value` reads/writes THROUGH the model (accepted fidelity gap: legacy kept a
	// stale JS cache on the control; here the model is the single source of truth).
	get value(): any {
		return this.host.get_value(this.fieldname)
	}
	set value(v: any) {
		this.host.set_value(this.fieldname, v)
	}

	// Lazy getter so an early read (before any refresh) sees "Write"/"Read" instead
	// of undefined; still settable (legacy assigns `disp_status` directly).
	get disp_status(): string {
		return (this._disp_status ??= this.get_status())
	}
	set disp_status(v: string) {
		this._disp_status = v
	}

	// "Write" | "Read" | "None". Thin: honours static df flags + delegates to
	// frappe.perm when a doc is present; does NOT evaluate depends_on-hidden (the
	// Vue layer resolves that at render — documented gap).
	get_status(explain?: boolean): string {
		if (this.df.get_status) return this.df.get_status(this)
		if ((!this.doctype && !this.docname) || this.df.is_web_form) {
			if (cint(this.df.hidden)) return 'None'
			if (this.df.read_only || this.df.is_virtual || this.df.fieldtype === 'Read Only')
				return 'Read'
			return 'Write'
		}
		return frappe.perm?.get_field_display_status
			? frappe.perm.get_field_display_status(this.df, this.doc, this.perm, explain)
			: 'Write'
	}

	// Rendering is driven by the reactive df (§2a), so refresh is a safe no-op for
	// the view — it only recomputes disp_status and re-syncs the reactive doc mirror
	// (scripts that mutate frm.doc then call refresh_field rely on the resync).
	refresh() {
		this._disp_status = this.get_status()
		this.host.refresh_view(this.fieldname)
	}
	refresh_input() {
		this.refresh()
	}

	// Visibility: mutate the reactive df in place → the layout computed rebuilds and
	// the field shows/hides on its own (legacy Control.toggle parity).
	toggle(show: boolean) {
		this.df.hidden = show ? 0 : 1
		this.refresh()
	}
	hide() {
		this.toggle(false)
	}

	set_focus(): boolean {
		const el = (this as any).$input?.get?.(0)
		if (el?.focus) {
			el.focus()
			return true
		}
		return false
	}

	// --- value plumbing (canonical commit path → host.set_value) ---------------
	get_value(): any {
		return this.host.get_value(this.fieldname)
	}
	get_model_value(): any {
		return this.host.get_value(this.fieldname)
	}
	get_parsed_value(value: any): any {
		return (this as any).parse ? (this as any).parse(value) : value
	}
	set_model_value(value: any): Promise<any> | void {
		this.last_value = value
		return this.host.set_value(this.fieldname, value)
	}
	set_value(value: any, force_set_value = false): Promise<any> {
		return this.validate_and_set_in_model(value, null, force_set_value)
	}
	// The prototype seam (composables/date.js etc.): the Vue control commits via
	// `'onUpdate:modelValue': (v) => parse_validate_and_set_in_model(v)`.
	parse_validate_and_set_in_model(value: any, e?: any): Promise<any> {
		value = this.get_parsed_value(value)
		return this.validate_and_set_in_model(value, e)
	}
	validate_and_set_in_model(value: any, e?: any, force_set_value = false): Promise<any> {
		const is_same = this.get_model_value() === value
		if (is_same && !force_set_value) return Promise.resolve()

		const commit = (v: any): Promise<any> => {
			return Promise.resolve(this.set_model_value(v)).then(() => {
				// Fire the docfield inline change handler. On a FORM, host.set_value
				// (frappe.model.set_value) fires client scripts but NOT df.change, so we
				// fire it here (legacy parity). In a DIALOG, host.set_value
				// (dialog.set_value) already fires it — skip to avoid a double trigger.
				if (this.frm) {
					const handler = this.df.change || this.df.onchange
					if (handler) return handler.apply(this, [e])
				}
			})
		}
		const validated = (this as any).validate ? (this as any).validate(value) : value
		if (validated && typeof validated.then === 'function') return validated.then(commit)
		return commit(validated)
	}

	// --- DOM escape hatch (lazy) -----------------------------------------------
	get $wrapper(): any {
		return this.host.resolve_wrapper(this.df)
	}
	// Input controls expose the RAW node as `wrapper` (legacy); the container
	// control overrides this to a jQuery object (legacy Section.wrapper is jQuery).
	get wrapper(): any {
		return this.$wrapper?.get?.(0)
	}
	html(content?: string): any {
		return this.$wrapper?.html?.(content)
	}

	// --- property reads scripts do on the handle (not always via `.df`) ----------
	get options(): any {
		return this.df.options
	}
	get label(): any {
		return this.df.label
	}

	// --- UNIVERSAL mutators (present on EVERY control) ---------------------------
	// The old lightweight handle exposed these on every `fields_dict` entry, and
	// scripts rely on it across ALL fieldtypes — e.g. erpnext
	// `reset_currency_labels(["totals_section"])` calls `set_label` on a SECTION
	// BREAK (a container control, not a ControlData). So they live on the base:
	// bodies route through the reactive df / host (so they render) and are harmless
	// on valueless/container fields. Input-specific mutators (set_mandatory /
	// set_invalid / set_required / $input) stay on FrappeControlInput below.
	set_label(label?: string) {
		if (label !== undefined) this.host.set_df_property(this.fieldname, 'label', label)
	}
	set_description(description?: string) {
		if (description !== undefined)
			this.host.set_df_property(this.fieldname, 'description', description)
	}
	set_new_description(description: string) {
		this.host.set_df_property(this.fieldname, 'description', description)
	}
	set_empty_description() {
		this.host.set_df_property(this.fieldname, 'description', '')
	}
	set_input(value: any): Promise<any> | void {
		// No silent input-only path (accepted gap): writes through to the model.
		return this.host.set_value(this.fieldname, value)
	}
	set_empty() {}
}

// --- FrappeControlInput ------------------------------------------------------
export class FrappeControlInput extends FrappeControl {
	// Input-only mutators; set_mandatory/set_invalid toggle classes on the resolved
	// wrapper (cosmetic — the Vue control shows the real state). The label/description
	// mutators are on the base (universal — see above).
	set_mandatory(value?: any) {
		this.$wrapper?.toggleClass?.(
			'has-error-mandatory',
			Boolean(this.df.reqd && is_null(value))
		)
	}
	set_required() {
		this.$wrapper?.find?.('label')?.toggleClass?.('reqd', Boolean(this.df.reqd))
	}
	set_invalid() {
		this.$wrapper?.toggleClass?.('has-error-invalid', Boolean(this.df.invalid))
	}
	can_write(): boolean {
		return this.disp_status === 'Write'
	}

	get $input(): any {
		return this.$wrapper?.find?.('input, select, textarea')
	}
	// No `.control-input-wrapper` in the Vue markup; the wrapper itself is a safe
	// mount point for the prototype `render(h(component), $input_wrapper.get(0))` seam.
	get $input_wrapper(): any {
		return this.$wrapper
	}
	get disp_area(): any {
		return this.$wrapper?.find?.('.control-value')?.get?.(0)
	}
	get label_area(): any {
		return this.$wrapper?.find?.('label')?.get?.(0)
	}
}

// --- FrappeControlData (concrete base for most fieldtypes) -------------------
export class FrappeControlData extends FrappeControlInput {
	get_input_value(): any {
		return this.host.get_value(this.fieldname)
	}
	// Vue owns the input; formatting is a no-op here (the component formats).
	set_formatted_input(_value?: any) {}
	format_for_input(val: any): any {
		return val == null ? '' : val
	}
	parse(value: any): any {
		return value
	}
	validate(v: any): any {
		return v
	}
}

// --- container control (Section / Column / Tab / Fold breaks) ----------------
// Carries no value; exists so `frm.fields_dict.items_section.wrapper.addClass(...)`
// (erpnext purchase_order.js) resolves. Its `wrapper` is jQuery (legacy parity),
// and it always resolves to the detached sink (FormLayoutSection carries no
// data-fieldname, so the class writes are cosmetic no-ops — acceptable).
export class FrappeContainerControl extends FrappeControl {
	get wrapper(): any {
		return this.$wrapper
	}
	refresh() {}
	refresh_input() {}
}
