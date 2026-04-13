import { render, h, ref } from 'vue'
import { Button, Dialog } from 'frappe-ui'

export default function dialog(params) {
	let props = {}
	props['open'] = true
	params['message'] = params.msg
	props['options'] = params

	let slots = {
		actions: ({ close }) =>
			h('div', { class: 'flex flex-row-reverse gap-2' }, [
				h(
					Button,
					{ variant: 'solid', onClick: params.primary_action },
					() => params.primary_action_label
				),
				h(
					Button,
					{ variant: 'outline', onClick: close },
					() => params.secondary_action_label
				),
			]),
	}

	let vnode = h(Dialog, props, slots)
	render(vnode, document.body)
}
