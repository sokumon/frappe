import { render, h } from 'vue'
import { Select } from 'frappe-ui'

export default function registerSelect() {
	return class select extends frappe.ui.form.ControlData {
		make_input() {
			const me = this
			// super.make_input()
			var options = this.df.options || []

			if (typeof this.df.options === 'string') {
				options = this.df.options.split('\n')
			}

			// nothing changed
			if (JSON.stringify(options) === this.last_options) {
				return
			}
			this.last_options = JSON.stringify(options)
			let options_prop = []
			options.forEach((opt) => {
				options_prop.push({
					label: opt,
					value: opt,
				})
			})

			this.props = {
				// modelValue: this.frm.doc[this.df.fieldname],
				'onUpdate:modelValue': (value) => {
					me.parse_validate_and_set_in_model(value)
				},
				options: options_prop,
			}
			let modelValue = this.get_model_value()
			if (modelValue) {
				this.props.modelValue = this.get_model_value()
			}
			let vnode = h(Select, this.props)
			this.$wrapper.find('.control-input').html('')
			render(vnode, this.$wrapper.find('.control-input').get(0))
		}
	}
}
