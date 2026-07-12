// check.ts — Check control (0/1 input value).
import { FrappeControlData } from './frappeControl'

declare const cint: (v: any) => number

export class FrappeControlCheck extends FrappeControlData {
	// Legacy returns `this.input.checked ? 1 : 0`; here the model value coerced.
	get_input_value(): number {
		return cint(this.host.get_value(this.fieldname)) ? 1 : 0
	}
}
