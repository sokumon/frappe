import { render, h } from 'vue'
import { DatePicker } from 'frappe-ui'

export default function registerDate() {
	return class date extends frappe.ui.form.ControlData {
		make_input() {
			const me = this

			this.props = {
				modelValue: this.frm.doc[this.df.fieldname],
				'onUpdate:modelValue': (value) => {
					if (!value) return
					me.parse_validate_and_set_in_model(value)
				},
			}
			this.slots = {}
			let vnode = h(DatePicker, this.props, this.slots)
			render(vnode, this.$input_wrapper.get(0))
		}
	}
}
