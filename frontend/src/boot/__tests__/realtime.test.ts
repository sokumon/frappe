// Contract tests for the RealTimeClient port (boot/realtime.ts): task
// response routing, the doc_subscribe throttle, and the two legacy fixes —
// task listeners must run bound to the client (legacy `function` callbacks
// got the socket as `this` and crashed), and events for unsubscribed tasks
// must not throw.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RealTimeClient, installRealtime } from '../realtime'

const g: any = globalThis

function fakeSocket() {
	const handlers: Record<string, (...args: any[]) => void> = {}
	return {
		handlers,
		on: (event: string, fn: any) => {
			handlers[event] = fn
		},
		off: vi.fn(),
		emit: vi.fn(),
		connect: vi.fn(),
	}
}

describe('frappe.realtime port', () => {
	let client: RealTimeClient
	let socket: ReturnType<typeof fakeSocket>

	beforeEach(() => {
		g.frappe = {
			provide: () => {},
			boot: {},
			flags: {},
			request: { cleanup: vi.fn() },
		}
		;(window as any).frappe = g.frappe
		client = new RealTimeClient()
		socket = fakeSocket()
		client.socket = socket as any
	})

	it('installRealtime publishes frappe.realtime with the frappe.socketio alias', () => {
		installRealtime()
		expect(g.frappe.realtime).toBeInstanceOf(RealTimeClient)
		expect(g.frappe.socketio).toBe(g.frappe.realtime)
	})

	it('emit forwards to the socket unless disabled', () => {
		client.emit('ping', 1, 2)
		expect(socket.emit).toHaveBeenCalledWith('ping', 1, 2)
		client.disabled = true
		client.emit('ping')
		expect(socket.emit).toHaveBeenCalledTimes(1)
	})

	it('task listeners dispatch bound to the client (legacy `this` bug)', () => {
		const success = vi.fn()
		client.subscribe('T1', { success })
		client.setup_listeners()
		expect(() =>
			socket.handlers['task_status_change']({ task_id: 'T1', status: 'Success' })
		).not.toThrow()
		expect(success).toHaveBeenCalledWith({ task_id: 'T1', status: 'Success' })
	})

	it('process_response routes success/callback/always/error and cleans up', () => {
		const opts = { success: vi.fn(), callback: vi.fn(), always: vi.fn(), error: vi.fn() }
		client.open_tasks['T1'] = opts
		client.process_response({ task_id: 'T1' }, 'success')
		expect(opts.success).toHaveBeenCalled()
		expect(opts.callback).toHaveBeenCalled()
		expect(opts.always).toHaveBeenCalled()
		expect(g.frappe.request.cleanup).toHaveBeenCalled()
		expect(opts.error).not.toHaveBeenCalled()

		client.process_response({ task_id: 'T1', status_code: 500 }, 'progress')
		expect(opts.error).toHaveBeenCalled()
	})

	it('ignores task events this tab never subscribed to', () => {
		expect(() => client.process_response({ task_id: 'unknown' }, 'success')).not.toThrow()
		expect(g.frappe.request.cleanup).not.toHaveBeenCalled()
	})

	it('doc_subscribe dedupes open docs and throttles to one per second', () => {
		vi.useFakeTimers()
		client.doc_subscribe('ToDo', 'a')
		expect(socket.emit).toHaveBeenCalledWith('doc_subscribe', 'ToDo', 'a')
		expect(client.open_docs.has('ToDo:a')).toBe(true)

		// throttled while the flag is up
		client.doc_subscribe('ToDo', 'b')
		expect(socket.emit).toHaveBeenCalledTimes(1)

		vi.advanceTimersByTime(1000)
		// deduped: already-open doc doesn't re-subscribe
		client.doc_subscribe('ToDo', 'a')
		expect(socket.emit).toHaveBeenCalledTimes(1)

		client.doc_subscribe('ToDo', 'b')
		expect(socket.emit).toHaveBeenCalledTimes(2)

		client.doc_unsubscribe('ToDo', 'a')
		expect(client.open_docs.has('ToDo:a')).toBe(false)
		vi.useRealTimers()
	})

	it('lazy connect happens on first emit', () => {
		client.lazy_connect = true
		client.emit('e')
		expect(socket.connect).toHaveBeenCalledTimes(1)
		client.emit('e')
		expect(socket.connect).toHaveBeenCalledTimes(1)
	})
})
