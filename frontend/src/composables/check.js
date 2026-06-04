import { render, h, ref } from 'vue'
import { Checkbox } from 'frappe-ui'

export default function registerCheck() {
	return class check extends frappe.ui.form.ControlData {
		make_input() {
			const me = this
			super.make_input()
			const test = ref('asdf')
			this.props = {
				label: this.df.label,
				// frappe-ui v1 Checkbox uses `v-model` (defineModel) — it no longer
				// reads the `checked` prop, so the value must come in via modelValue.
				modelValue: this.frm.doc[this.df.fieldname],
				'onUpdate:modelValue': (value) => {
					me.parse_validate_and_set_in_model(value)
				},
			}
			this.slots = {}
			let vnode = h(Checkbox, this.props, this.slots)
			render(vnode, this.$wrapper.get(0))
			this.$wrapper.get(0).lastChild.classList.add('tw')
		}
		set_label() {}
		make_wrapper() {
			this.$wrapper = $(`<div class=" form-group frappe-control"></div>`).appendTo(
				this.parent
			)
		}
	}
}
