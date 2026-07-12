// modelEvents.ts
//
// `frappe.model.on(dt, field, fn)` pushes onto a plain array in
// `frappe.model.events[dt][field]` and there is NO `off` API — nothing removes
// entries. Every Form.vue mount registers listeners (watch_model_updates + the
// bridge mirror), each strongly holding the whole frm graph, so navigating
// A → B → A would accumulate dead form graphs unboundedly AND double-fire client
// scripts when a stale instance's docname matches again.
//
// This tracker records the `[dt, field, fn]` tuples it registers and splices them
// back out on teardown. Both `VueForm.watch_model_updates` (removed by
// `frm.teardown()`) and `useFormBridge` (removed by `bridge.dispose()`) use one.
declare const frappe: any

export interface ModelListeners {
	on(doctype: string, field: string, fn: (...args: any[]) => any): void
	offAll(): void
}

export function makeModelListeners(): ModelListeners {
	const tuples: Array<[string, string, Function]> = []
	return {
		on(doctype, field, fn) {
			frappe.model.on(doctype, field, fn)
			tuples.push([doctype, field, fn])
		},
		offAll() {
			for (const [doctype, field, fn] of tuples) {
				const arr = frappe.model.events?.[doctype]?.[field]
				if (!arr) continue
				const i = arr.indexOf(fn)
				if (i > -1) arr.splice(i, 1)
			}
			tuples.length = 0
		},
	}
}
