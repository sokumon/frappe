// linkSelect.ts — Link / Dynamic Link / Select controls (thin extras over ControlData).
import { FrappeControlData } from './frappeControl'

declare const frappe: any

export class FrappeControlLink extends FrappeControlData {
	// `frm.set_query(...)` / `frm.fields_dict[f].get_query = fn` stash the runtime
	// query here; Form.vue's LinkQueryKey resolver reads it at fetch time.
	get_query: any = undefined
	// No Awesomplete instance in the Vue control — documented gap. Scripts that
	// probe `field.awesomplete` get `undefined` instead of a crash.
	awesomplete: any = undefined

	get_options(): string {
		return this.df.options
	}
	get_reference_doctype(): string | null {
		if (this.doctype) return this.doctype
		return frappe.get_route && frappe.get_route()[0] === 'List' ? frappe.get_route()[1] : null
	}
	// The Vue LinkField resolves get_query at fetch time, so this is a thin marker
	// kept for scripts that call it directly off the handle.
	set_custom_query(_args?: any) {}
}

export class FrappeControlDynamicLink extends FrappeControlLink {
	// Runtime options: the `options` df names another field that holds the target
	// doctype (e.g. `reference_doctype`).
	get_options(): string {
		if (this.df.get_options) return this.df.get_options(this)
		const doc = this.doc
		return doc ? doc[this.df.options] : this.df.options
	}
}

export class FrappeControlSelect extends FrappeControlData {
	get_options(): string {
		return this.df.options
	}
	// Update the newline-separated option list; writing the reactive df re-renders
	// the Vue SelectField's choices. With no arg it's a no-op (df already carries them).
	set_options(options?: string) {
		if (options !== undefined) this.host.set_df_property(this.fieldname, 'options', options)
	}
}
