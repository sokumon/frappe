// htmlField.ts — HTML control (a DOM escape hatch).
//
// The host resolves an HTML field's `$wrapper` to a stable, eager detached node
// that `HtmlField.vue` adopts on mount — so a client script's
// `frm.fields_dict[f].$wrapper.html(...)` (e.g. erpnext Item render_item_prices)
// renders in the Vue form and later `.html()` calls update it in place.
import { FrappeControl } from './frappeControl'

export class FrappeControlHTML extends FrappeControl {
	// Valueless: reads are undefined, writes are ignored (the content lives in the
	// adopted node, written via `html()` / `$wrapper.html()`).
	get_value(): any {
		return undefined
	}
	set_value(): Promise<any> {
		return Promise.resolve()
	}
	// `frm.fields_dict[f].html(content)` — legacy exposed this directly on the field.
	html(content?: string): any {
		return this.$wrapper?.html?.(content)
	}
}
