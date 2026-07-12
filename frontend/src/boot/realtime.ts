// boot/realtime.ts
//
// frappe.realtime — TS port of frappe/public/js/frappe/socketio_client.js
// (a desk/list/web bundle file, none of which load in the Vue shell — until
// this port, frappe.realtime was undefined here and main.ts's
// `frappe.realtime?.init?.()` silently no-op'd).
//
// Consumers: main.ts provides the client as 'socket' for @framework/ui
// (ActivityTimeline's doc_subscribe/docinfo_update), FormTimeline/FormSidebar,
// form_viewers, list update events, and frappe.realtime.on/publish from
// legacy client scripts.
//
// Two legacy bugs are fixed rather than ported:
// • setup_listeners used `function` callbacks, so `this` was the socket and
//   `this.process_response` crashed on every task event — arrow functions
//   keep the client instance.
// • process_response indexed open_tasks without a guard and threw for events
//   of tasks this tab never subscribed to.
import { io, type Socket } from 'socket.io-client'

export interface RealtimeTaskOpts {
	success?: (data: any) => void
	progress?: (data: any) => void
	callback?: (data: any) => void
	always?: (data: any) => void
	error?: (data: any) => void
	[key: string]: any
}

export class RealTimeClient {
	open_tasks: Record<string, RealtimeTaskOpts> = {}
	open_docs = new Set<string>()
	disabled = false
	lazy_connect = false
	socket?: Socket

	on(event: string, callback: (...args: any[]) => void) {
		if (this.socket) {
			this.connect()
			this.socket.on(event, callback)
		}
	}

	off(event: string, callback?: (...args: any[]) => void) {
		if (this.socket) {
			this.socket.off(event, callback)
		}
	}

	connect() {
		if (this.disabled) return
		if (this.lazy_connect) {
			this.socket?.connect()
			this.lazy_connect = false
		}
	}

	emit(event: string, ...args: any[]) {
		if (this.disabled) return
		this.connect()
		this.socket?.emit(event, ...args)
	}

	init(port: number | string = 9000, lazy_connect = false) {
		const w = window as any
		if (frappe.boot.disable_async) {
			this.disabled = true
			return
		}

		if (this.socket) {
			return
		}
		this.lazy_connect = lazy_connect

		// Enable secure option when using HTTPS
		if (window.location.protocol == 'https:') {
			this.socket = io(this.get_host(port), {
				secure: true,
				withCredentials: true,
				reconnectionAttempts: 3,
				autoConnect: !lazy_connect,
			})
		} else if (window.location.protocol == 'http:') {
			this.socket = io(this.get_host(port), {
				withCredentials: true,
				reconnectionAttempts: 3,
				autoConnect: !lazy_connect,
			})
		}

		if (!this.socket) {
			console.log('Unable to connect to ' + this.get_host(port))
			return
		}

		this.socket.on('connect_error', (err: Error) => {
			console.error('Error connecting to socket.io:', err.message)
		})

		this.socket.on('msgprint', (message: any) => {
			frappe.msgprint(message)
		})

		this.socket.on('progress', (data: any) => {
			if (data.progress) {
				const flt = w.flt ?? Number
				data.percent = (flt(data.progress[0]) / data.progress[1]) * 100
			}
			if (data.percent) {
				// messages.js's progress dialog isn't ported to the shell yet;
				// degrade to nothing instead of crashing on background jobs
				frappe.show_progress?.(
					data.title || (w.__ ? w.__('Progress') : 'Progress'),
					data.percent,
					100,
					data.description,
					true
				)
			}
		})

		this.setup_listeners()

		// The Vue form engine triggers form-refresh (vueForm); form-load /
		// form-rename / form-unload fire once legacy-parity events land there.
		w.$?.(document).on('form-load form-rename', (e: any, frm: any) => {
			if (!frm.doc || frm.is_new()) {
				return
			}
			this.doc_subscribe(frm.doctype, frm.docname)
		})

		w.$?.(document).on('form-refresh', (e: any, frm: any) => {
			if (!frm.doc || frm.is_new()) {
				return
			}
			this.doc_open(frm.doctype, frm.docname)
		})

		w.$?.(document).on('form-unload', (e: any, frm: any) => {
			if (!frm.doc || frm.is_new()) {
				return
			}
			this.doc_close(frm.doctype, frm.docname)
		})
	}

	get_host(port: number | string = 9000) {
		const w = window as any
		let host = window.location.origin
		if (w.dev_server) {
			const parts = host.split(':')
			port = frappe.boot.socketio_port || port.toString() || '9000'
			if (parts.length > 2) {
				host = parts[0] + ':' + parts[1]
			}
			host = host + ':' + port
		}
		return host + `/${frappe.boot.sitename}`
	}

	subscribe(task_id: string, opts: RealtimeTaskOpts) {
		this.emit('task_subscribe', task_id)
		this.emit('progress_subscribe', task_id)

		this.open_tasks[task_id] = opts
	}
	task_subscribe(task_id: string) {
		this.emit('task_subscribe', task_id)
	}
	task_unsubscribe(task_id: string) {
		this.emit('task_unsubscribe', task_id)
	}
	doctype_subscribe(doctype: string) {
		this.emit('doctype_subscribe', doctype)
	}
	doctype_unsubscribe(doctype: string) {
		this.emit('doctype_unsubscribe', doctype)
	}
	doc_subscribe(doctype: string, docname: string) {
		if (frappe.flags.doc_subscribe) {
			console.log('throttled')
			return
		}
		if (this.open_docs.has(`${doctype}:${docname}`)) {
			return
		}

		frappe.flags.doc_subscribe = true

		// throttle to 1 per sec
		setTimeout(() => {
			frappe.flags.doc_subscribe = false
		}, 1000)

		this.emit('doc_subscribe', doctype, docname)
		this.open_docs.add(`${doctype}:${docname}`)
	}
	doc_unsubscribe(doctype: string, docname: string) {
		this.emit('doc_unsubscribe', doctype, docname)
		return this.open_docs.delete(`${doctype}:${docname}`)
	}
	doc_open(doctype: string, docname: string) {
		this.emit('doc_open', doctype, docname)
	}
	doc_close(doctype: string, docname: string) {
		this.emit('doc_close', doctype, docname)
	}
	setup_listeners() {
		this.socket!.on('task_status_change', (data: any) => {
			this.process_response(data, data.status.toLowerCase())
		})
		this.socket!.on('task_progress', (data: any) => {
			this.process_response(data, 'progress')
		})
	}
	process_response(data: any, method: string) {
		if (!data) {
			return
		}

		const opts = this.open_tasks[data.task_id]
		if (!opts) {
			return // task event for a task this tab never subscribed to
		}

		// success
		if (opts[method]) {
			opts[method](data)
		}

		// "callback" is std frappe term
		if (method === 'success') {
			if (opts.callback) opts.callback(data)
		}

		// always
		frappe.request.cleanup(opts, data)
		if (opts.always) {
			opts.always(data)
		}

		// error
		if (data.status_code && data.status_code > 400 && opts.error) {
			opts.error(data)
		}
	}

	publish(event: string, message: any) {
		if (this.socket) {
			this.emit(event, message)
		}
	}
}

export function installRealtime() {
	frappe.provide('frappe.realtime')
	frappe.realtime = new RealTimeClient()
	// backward compatibility
	frappe.socketio = frappe.realtime
}
