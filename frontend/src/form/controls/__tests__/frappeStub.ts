// frappeStub.ts
//
// A minimal `frappe` global harness for the Vue-native control-hierarchy contract
// tests. It emulates ONLY the slice the controls / grid facade / host adapters
// touch:
//   • `locals` + `frappe.model` (set_value / get_value / add_child / on / trigger /
//     clear_doc) — set_value is a real spy-able implementation that writes locals
//     and fires model listeners, so a test can assert both the routing and the
//     resulting re-render.
//   • `frappe.meta` (get_docfield / get_docfields / docfield_map) + `get_meta`.
//   • a tiny jQuery-ish `$` backed by real jsdom nodes, enough for the wrapper sink.
//
// Nothing here pretends to be complete desk behaviour; it is the test double the
// classes talk to through the `ControlHost` seam.
import { vi } from 'vitest'

export interface StubDoc extends Record<string, any> {
	doctype: string
	name: string
}

export interface FrappeStub {
	frappe: any
	locals: Record<string, Record<string, StubDoc>>
	/** Register a doctype's meta `fields` (array of raw docfields). */
	setMeta: (doctype: string, fields: any[], extra?: Record<string, any>) => void
	/** Insert/replace a doc in `locals` (adds doctype/name if missing). */
	setDoc: (doc: StubDoc) => StubDoc
	/** The `frappe.model.set_value` spy (real behaviour + call tracking). */
	setValueSpy: ReturnType<typeof vi.fn>
}

let current: FrappeStub | null = null

function jqFactory() {
	// Minimal jQuery: wraps a single real jsdom node (or an HTML string → a fresh
	// detached node). Only the members the wrapper sink / container control use.
	function jq(arg?: any): any {
		let el: HTMLElement | null = null
		if (typeof arg === 'string') {
			if (arg.trim().startsWith('<')) {
				const tpl = document.createElement('template')
				tpl.innerHTML = arg.trim()
				el = tpl.content.firstChild as HTMLElement
			} else {
				el = document.querySelector(arg)
			}
		} else if (arg && arg.nodeType) {
			el = arg
		} else if (arg && arg.__isJq) {
			return arg
		}
		const set = el ? [el] : []
		const w: any = {
			__isJq: true,
			0: el,
			length: set.length,
			find: (sel: string) => jq(el ? el.querySelector(sel) : null),
			html: (v?: string) => {
				if (v === undefined) return el ? el.innerHTML : ''
				if (el) el.innerHTML = v
				return w
			},
			text: (v?: string) => {
				if (v === undefined) return el ? el.textContent : ''
				if (el) el.textContent = v
				return w
			},
			addClass: (c: string) => {
				if (el) el.classList.add(...String(c).split(/\s+/).filter(Boolean))
				return w
			},
			removeClass: (c: string) => {
				if (el) el.classList.remove(...String(c).split(/\s+/).filter(Boolean))
				return w
			},
			toggleClass: (c: string, state?: boolean) => {
				if (el) el.classList.toggle(c, state)
				return w
			},
			hasClass: (c: string) => (el ? el.classList.contains(c) : false),
			attr: (k: string, v?: any) => {
				if (v === undefined) return el ? el.getAttribute(k) : undefined
				if (el) el.setAttribute(k, v)
				return w
			},
			prop: () => w,
			on: () => w,
			off: () => w,
			trigger: () => w,
			append: (child: any) => {
				if (el && child?.[0]) el.appendChild(child[0])
				return w
			},
			appendTo: (parent: any) => {
				const p = parent?.[0] ?? parent
				if (el && p?.appendChild) p.appendChild(el)
				return w
			},
			remove: () => {
				el?.remove()
				return w
			},
			empty: () => {
				if (el) el.innerHTML = ''
				return w
			},
			val: () => '',
			get: (i?: number) => (i === undefined ? set : el),
			parents: () => jq(null),
		}
		return w
	}
	jq.extend = Object.assign
	return jq
}

export function installFrappeStub(): FrappeStub {
	const locals: Record<string, Record<string, StubDoc>> = {}
	const metas: Record<string, any> = {}
	const events: Record<string, Record<string, Function[]>> = {}

	function resolveDoc(doctype: any, docname?: string): StubDoc | undefined {
		if (doctype && typeof doctype === 'object') return doctype
		return locals[doctype]?.[docname as string]
	}

	function trigger(fieldname: string, value: any, doc: StubDoc, skip = false) {
		const dtEvents = events[doc.doctype]
		if (!dtEvents) return Promise.resolve()
		const fns = [...(dtEvents[fieldname] || []), ...(dtEvents['*'] || [])]
		for (const fn of fns) fn && fn(fieldname, value, doc, skip)
		return Promise.resolve()
	}

	const setValueSpy = vi.fn(
		(doctype: any, docname: any, fieldname: any, value?: any, _ft?: any, skip = false) => {
			let doc: StubDoc | undefined
			let updates: Record<string, any>
			if (doctype && typeof doctype === 'object') {
				doc = doctype
				updates = typeof docname === 'object' ? docname : { [docname]: fieldname }
			} else {
				doc = locals[doctype]?.[docname]
				updates = typeof fieldname === 'object' ? fieldname : { [fieldname]: value }
			}
			if (!doc) return Promise.resolve()
			for (const [k, v] of Object.entries(updates)) {
				if (doc[k] !== v) {
					doc[k] = v
					trigger(k, v, doc, skip)
				}
			}
			return Promise.resolve()
		}
	)

	let childSeq = 1
	const frappe: any = {
		_metas: metas,
		provide: (path: string) => {
			const parts = path.split('.')
			let obj: any = frappe
			for (const p of parts) obj = obj[p] ??= {}
			return obj
		},
		get_meta: (dt: string) => metas[dt],
		get_doc: (dt: string, dn: string) => locals[dt]?.[dn],
		model: {
			events,
			table_fields: ['Table', 'Table MultiSelect'],
			std_fields_list: ['name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus'],
			child_table_field_list: ['parent', 'parentfield', 'parenttype', 'idx'],
			no_value_type: ['Section Break', 'Column Break', 'Tab Break', 'HTML', 'Button', 'Heading'],
			set_value: setValueSpy,
			get_value: (dt: string, dn: string, fn: string) => resolveDoc(dt, dn)?.[fn],
			has_value: (dt: string, dn: string, fn: string) => {
				const v = resolveDoc(dt, dn)?.[fn]
				return v !== undefined && v !== null && v !== ''
			},
			on: (dt: string, fieldname: string, fn: Function) => {
				;(events[dt] ??= {})[fieldname] ??= []
				events[dt][fieldname].push(fn)
			},
			trigger,
			add_child: (parent: StubDoc, cdt: string, parentfield: string, idx?: number) => {
				const name = `${cdt}-${childSeq++}`
				const child: StubDoc = {
					doctype: cdt,
					name,
					parent: parent.name,
					parentfield,
					parenttype: parent.doctype,
					idx: idx ?? (parent[parentfield]?.length || 0) + 1,
				}
				;(locals[cdt] ??= {})[name] = child
				;(parent[parentfield] ??= []).push(child)
				return child
			},
			clear_doc: (dt: string, dn: string) => {
				delete locals[dt]?.[dn]
			},
			clear_table: (doc: StubDoc, fieldname: string) => {
				doc[fieldname] = []
			},
		},
		meta: {
			docfield_map: {} as Record<string, Record<string, any>>,
			get_docfield: (dt: string, fn: string, _dn?: string) =>
				(metas[dt]?.fields || []).find((f: any) => f.fieldname === fn),
			get_docfields: (dt: string, _dn?: string) => metas[dt]?.fields || [],
			get_table_fields: (dt: string) =>
				(metas[dt]?.fields || []).filter((f: any) =>
					['Table', 'Table MultiSelect'].includes(f.fieldtype)
				),
		},
		utils: {
			copy_dict: (d: any) => ({ ...d }),
			escape_html: (s: any) => String(s ?? ''),
		},
		perm: {
			get_perm: () => [{ read: 1, write: 1, create: 1 }],
		},
	}

	const $ = jqFactory()

	const stub: FrappeStub = {
		frappe,
		locals,
		setValueSpy,
		setMeta: (doctype, fields, extra = {}) => {
			metas[doctype] = { name: doctype, fields, ...extra }
			const map: Record<string, any> = (frappe.meta.docfield_map[doctype] = {})
			for (const f of fields) if (f.fieldname) map[f.fieldname] = f
		},
		setDoc: (doc) => {
			;(locals[doc.doctype] ??= {})[doc.name] = doc
			return doc
		},
	}

	;(globalThis as any).frappe = frappe
	;(globalThis as any).locals = locals
	;(globalThis as any).$ = $
	;(globalThis as any).jQuery = $
	if (typeof window !== 'undefined') {
		;(window as any).frappe = frappe
		;(window as any).locals = locals
		;(window as any).$ = $
	}

	current = stub
	return stub
}

export function resetFrappeStub() {
	current = null
	;(globalThis as any).frappe = undefined
	;(globalThis as any).locals = undefined
	;(globalThis as any).cur_frm = undefined
}

export function getFrappeStub(): FrappeStub {
	if (!current) throw new Error('installFrappeStub() not called for this test')
	return current
}
