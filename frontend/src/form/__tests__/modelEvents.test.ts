// The model-listener tracker must actually splice its handlers back out of
// `frappe.model.events` on teardown — this is the fix for the leak + double-fire on
// form-to-form navigation (there is no `frappe.model.off`).
import { describe, it, expect, beforeEach } from 'vitest'
import { installFrappeStub } from '../controls/__tests__/frappeStub'
import type { FrappeStub } from '../controls/__tests__/frappeStub'
import { makeModelListeners } from '../modelEvents'

describe('makeModelListeners', () => {
	let stub: FrappeStub
	beforeEach(() => {
		stub = installFrappeStub()
	})

	it('registers via frappe.model.on and splices back out on offAll', () => {
		const { frappe, setDoc } = stub
		const calls: string[] = []
		const listeners = makeModelListeners()
		listeners.on('ToDo', '*', () => calls.push('a'))
		listeners.on('ToDo', 'status', () => calls.push('b'))
		expect(frappe.model.events.ToDo['*']).toHaveLength(1)

		setDoc({ doctype: 'ToDo', name: 't1', status: 'Open' })
		frappe.model.set_value('ToDo', 't1', 'status', 'Closed')
		expect(calls).toEqual(['b', 'a']) // field handler then '*'

		listeners.offAll()
		expect(frappe.model.events.ToDo['*']).toHaveLength(0)
		expect(frappe.model.events.ToDo.status).toHaveLength(0)

		calls.length = 0
		frappe.model.set_value('ToDo', 't1', 'status', 'Reopened')
		expect(calls).toEqual([]) // no double-fire from a stale listener
	})

	it('offAll only removes its own tuples, leaving other listeners intact', () => {
		const { frappe } = stub
		const other: string[] = []
		frappe.model.on('ToDo', '*', () => other.push('x')) // registered outside the tracker
		const listeners = makeModelListeners()
		listeners.on('ToDo', '*', () => {})
		expect(frappe.model.events.ToDo['*']).toHaveLength(2)
		listeners.offAll()
		expect(frappe.model.events.ToDo['*']).toHaveLength(1) // the outside one survives
	})
})
