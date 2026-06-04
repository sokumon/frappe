import { render, h } from 'vue'
import { Button, Dialog } from 'frappe-ui'

export default function dialog(params) {
	// frappe-ui v1 Dialog takes flat top-level props instead of the legacy
	// `options` blob; `open` is the canonical visibility prop.
	const props = {
		open: true,
		title: params.title,
		message: params.message ?? params.msg,
	}
	if (params.size) props.size = params.size

	const slots = {
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

	const vnode = h(Dialog, props, slots)
	render(vnode, document.body)
}
