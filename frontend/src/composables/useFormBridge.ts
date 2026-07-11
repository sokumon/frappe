// useFormBridge.ts
//
// Bridges a legacy `frappe.ui.form.Form` (the "engine") to the Vue `FormLayout`
// (the "view"). The legacy form keeps owning script_manager, toolbar, sidebar,
// save and `watch_model_updates`; this composable makes `FormLayout` render the
// fields and — crucially — keeps old `frappe.ui.form.on(...)` client scripts
// working by routing every Vue edit through `frappe.model.set_value`.
//
// Why set_value: client scripts only fire because value changes go through
// `frappe.model.set_value` → `frappe.model.trigger` → the `frappe.model.on(dt,"*")`
// handler that `Form.watch_model_updates()` registers (form.js:290), which calls
// `frm.script_manager.trigger(fieldname)`. So the Vue form must commit through
// set_value and mirror model changes back into a reactive `doc`.
//
// Data flow:
//   Vue control → (on `change`) frappe.model.set_value ─┐
//                                                        ├─► existing pipeline
//                                                        │   (scripts, depends_on,
//                                                        │    dirty, fetch_from)
//   frappe.model.on(dt,"*") / on(cdt,"*") ── mirror ────┴─► reactive `doc`
//
// Parent scalars and existing child-row cells commit via a per-field `on.change`
// decorator (the library's documented commit seam — FieldComponentEmits.change).
// Child-row add/remove/reorder is reconciled by a shallow watch on the table
// array (the Grid reassigns the array for structural ops, mutates rows in place
// for cell edits). Runtime `set_df_property`/`toggle_*` are wrapped into
// `applyMetaScript` ops so the Vue layout re-resolves live.
import { computed, reactive, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { buildLayoutFromMeta, applyMetaScript } from '@framework/ui/FormLayout'
import type {
	FormLayoutSchema,
	FieldMeta,
	FieldUI,
	RawMetaField,
	MetaOp,
} from '@framework/ui/FormLayout'

// Value-bearing fieldtypes whose control does NOT emit `change` (commit on their
// discrete `update:modelValue` pick instead). Attach Image is the only scalar one;
// the child-table types commit structurally (below), never as a scalar set_value.
const COMMIT_ON_UPDATE = new Set(['Attach Image'])
// Rendered-but-valueless fieldtypes: never commit.
const VALUELESS = new Set(['Button', 'Heading', 'HTML', 'Column Break', 'Section Break', 'Tab Break'])
// Child-table fieldtypes: their value is an array of child rows, reconciled
// structurally rather than committed as a scalar.
const CHILD_TABLE = new Set(['Table', 'Table MultiSelect'])
// Link fieldtypes that drive `fetch_from`: changing one fetches the linked doc and
// populates target fields (legacy did this in the Link control; the Vue control
// doesn't, so the bridge reapplies it — see fetchLinkTargets).
const LINK_TYPES = new Set(['Link', 'Dynamic Link'])

// Frappe DocField property name → portable FieldMeta property name. Runtime
// `set_df_property`/`toggle_*` speak the DocField names; the Vue layout speaks
// FieldMeta. Props not in this map (e.g. `autocompletions`) are ignored — they
// don't affect the Vue render.
const DF_PROP_MAP: Record<string, keyof FieldMeta> = {
	read_only: 'readOnly',
	hidden: 'hidden',
	reqd: 'reqd',
	options: 'options',
	label: 'label',
	description: 'description',
	precision: 'precision',
	depends_on: 'dependsOn',
	mandatory_depends_on: 'mandatoryDependsOn',
	read_only_depends_on: 'readOnlyDependsOn',
}

export interface FormBridge {
	/** Render-ready schema for `<FormLayout :layout>`, re-resolving on meta-script ops. */
	layout: ComputedRef<FormLayoutSchema>
	/** Reactive doc for `<FormLayout :doc>`; mirrors `frm.doc` (scalars + child clones). */
	doc: Record<string, any>
	/** Re-seed the reactive doc from `frm.doc` (call on doc (re)load / name change). */
	seed: () => void
	/** Clear accumulated meta-script ops; call before a `refresh` re-applies them. */
	resetOps: () => void
	/** Detach model listeners + restore wrapped methods. */
	dispose: () => void
}

export function useFormBridge(frm: any): FormBridge {
	const doctype: string = frm.doctype
	// Table field → child doctype, from meta. Drives child metas, reconcile watchers
	// and the child mirror handlers.
	const tableFields: { fieldname: string; cdt: string }[] = (frm.meta.fields || [])
		.filter((df: RawMetaField) => CHILD_TABLE.has(df.fieldtype) && df.options)
		.map((df: RawMetaField) => ({ fieldname: df.fieldname, cdt: df.options as string }))

	// --- Schema -------------------------------------------------------------
	// Child column metas: same call the legacy script_manager uses (script_manager.js:247).
	const childMetas: Record<string, RawMetaField[]> = {}
	for (const { cdt } of tableFields) {
		if (!childMetas[cdt]) childMetas[cdt] = frappe.meta.get_docfields(cdt, frm.docname)
	}

	// Runtime meta-script ops (set_df_property/toggle_*), applied atop the base schema.
	const ops = ref<MetaOp[]>([])

	const base = buildLayoutFromMeta(frm.meta.fields || [], {
		childMetas,
		decorate: commitDecorator,
	})
	const layout = computed<FormLayoutSchema>(() => applyMetaScript(base, ops.value))

	// --- Reactive doc mirror ------------------------------------------------
	const doc = reactive<Record<string, any>>({})
	let seeding = false

	function seed() {
		// Built before the first refresh, so `frm.doc` may not exist yet; renderDoc
		// re-seeds once the doc is loaded.
		if (!frm.doc) return
		seeding = true
		// Copy scalars by value; clone child rows so the Grid edits a copy — that
		// keeps `frappe.model.set_value`'s "changed?" check meaningful (a shared
		// reference would already hold the new value, so set_value wouldn't trigger
		// and child scripts wouldn't fire).
		for (const k of Object.keys(frm.doc)) {
			const v = frm.doc[k]
			doc[k] = Array.isArray(v) ? v.map((r) => ({ ...r })) : v
		}
		// Drop keys from a previously-rendered doc.
		for (const k of Object.keys(doc)) if (!(k in frm.doc)) delete doc[k]
		seeding = false
	}
	seed()

	// --- Commit decorator (parent scalars + child cells) --------------------
	// Attached to every value field by `buildLayoutFromMeta`. On the control's
	// commit event it routes the value through `frappe.model.set_value`, which
	// fires the whole legacy pipeline (client scripts, depends_on, dirty, fetch).
	// `row` is injected by the Grid for child cells (TableField.cellListeners); at
	// the top level it's absent and we target the parent doc.
	function commitDecorator(field: FieldMeta): FieldUI | void {
		if (VALUELESS.has(field.fieldtype) || CHILD_TABLE.has(field.fieldtype)) return
		const fieldname = field.fieldname
		const commit = (value: any, row?: Record<string, any>) => {
			const target = row ?? frm.doc
			if (!target?.doctype || !target?.name) return
			frappe.model.set_value(target.doctype, target.name, fieldname, value)
		}
		const event = COMMIT_ON_UPDATE.has(field.fieldtype) ? 'update:modelValue' : 'change'
		return { on: { [event]: commit } }
	}

	// --- fetch_from -----------------------------------------------------------
	// Reapplies desk's client-side `fetch_from` (legacy Link control's
	// validate_link_and_fetch): on a Link change, read the fetch map the frm built
	// from `fetch_from` docfields (`frm.fetch_dict`, keyed by "*" and the parent
	// doctype → `{ target_field: source_field }`), pull those source fields off the
	// linked doc, and set each target via `frappe.model.set_value` (so the mirror,
	// scripts and dirty all fire). `target` is the parent doc or a child row.
	function fetchLinkTargets(field: RawMetaField, value: any, target: Record<string, any>) {
		const parent: string = target.doctype
		const fetchMap: Record<string, string> = {
			...(frm.fetch_dict['*']?.[field.fieldname] || {}),
			...(frm.fetch_dict[parent]?.[field.fieldname] || {}),
		}
		const columns = Object.values(fetchMap)
		if (!columns.length) return

		// No value → clear the target fields (matches the legacy control).
		if (!value) {
			for (const targetField of Object.keys(fetchMap)) {
				frappe.model.set_value(parent, target.name, targetField, '')
			}
			return
		}

		// Dynamic Link: the target doctype is named by another field (df.options).
		const linkDoctype =
			field.fieldtype === 'Dynamic Link' ? target[field.options as string] : field.options
		if (!linkDoctype) return

		frappe
			.xcall('frappe.client.validate_link_and_fetch', {
				doctype: linkDoctype,
				docname: value,
				fields_to_fetch: columns,
			})
			.then((res: any) => {
				if (!res) return
				const hasValue = Boolean(res.name)
				for (const [targetField, sourceField] of Object.entries(fetchMap)) {
					frappe.model.set_value(
						parent,
						target.name,
						targetField,
						hasValue ? res[sourceField] : ''
					)
				}
			})
			.catch((e: any) => console.error('[useFormBridge] fetch_from failed', e))
	}

	// --- Child-table structural reconcile -----------------------------------
	// Fires only when the Grid reassigns the array (addRow/delete/reorder); cell
	// edits mutate rows in place (no array-ref change) and commit via the decorator.
	function reconcileTable(fieldname: string, cdt: string) {
		if (seeding) return
		const vueRows: Record<string, any>[] = doc[fieldname] ?? []
		const legacy: Record<string, any>[] = frm.doc[fieldname] ?? (frm.doc[fieldname] = [])
		const byName = new Map(legacy.filter((r) => r.name).map((r) => [r.name, r]))
		const kept = new Set<string>()
		const nextLegacy: Record<string, any>[] = []

		vueRows.forEach((vr, i) => {
			let lr = vr.name ? byName.get(vr.name) : undefined
			if (!lr) {
				// New row (Grid pushes a blank `{}`): materialize a real child so it
				// gains identity + defaults, then reflect those onto the Vue clone.
				lr = frappe.model.add_child(frm.doc, cdt, fieldname)
				Object.assign(vr, lr)
			}
			lr.idx = i + 1
			kept.add(lr.name)
			nextLegacy.push(lr)
		})

		// Rebuild the legacy child array in the Vue order (drops removed rows).
		frm.doc[fieldname] = nextLegacy
		frm.dirty()
		frm.refresh_field(fieldname)
	}

	const stopHandles: Array<() => void> = []
	for (const { fieldname, cdt } of tableFields) {
		stopHandles.push(
			// Sync flush so the reassign during `seed()` is skipped by the `seeding`
			// guard rather than deferred past it.
			watch(() => doc[fieldname], () => reconcileTable(fieldname, cdt), { flush: 'sync' })
		)
	}

	// --- Model → Vue mirror --------------------------------------------------
	// Programmatic changes (client scripts calling frm.set_value, fetches, defaults)
	// don't pass through the Vue controls, so mirror them back into `doc`. Runs in
	// addition to the legacy watch_model_updates handler.
	let disposed = false

	// Docfield lookup (fieldtype/options) by `doctype:fieldname`, for the fetch_from
	// hook — so it can tell a Link field (which drives a fetch) from any other change.
	const dfByKey = new Map<string, RawMetaField>()
	for (const df of frm.meta.fields || []) dfByKey.set(`${doctype}:${df.fieldname}`, df)
	for (const [cdt, dfs] of Object.entries(childMetas))
		for (const df of dfs) dfByKey.set(`${cdt}:${df.fieldname}`, df)

	// Fetch on any Link change (user pick or programmatic set_value), matching desk
	// which reruns fetch from the control's model listener regardless of source.
	function maybeFetch(dt: string, fieldname: string, value: any, target: Record<string, any>) {
		const df = dfByKey.get(`${dt}:${fieldname}`)
		if (df && LINK_TYPES.has(df.fieldtype)) fetchLinkTargets(df, value, target)
	}

	// Parent scalars.
	frappe.model.on(doctype, '*', (fieldname: string, value: any, d: any) => {
		if (disposed || d.name !== frm.docname) return
		if (!Array.isArray(frm.doc[fieldname]) && doc[fieldname] !== value) {
			doc[fieldname] = value
			maybeFetch(doctype, fieldname, value, frm.doc)
		}
	})

	// Child rows (one handler per unique child doctype; matched by parentfield so
	// two child tables of the same doctype don't cross-write).
	for (const cdt of new Set(tableFields.map((t) => t.cdt))) {
		frappe.model.on(cdt, '*', (fieldname: string, value: any, row: any) => {
			if (disposed || row.parent !== frm.docname || row.parenttype !== doctype) return
			const arr: Record<string, any>[] = doc[row.parentfield]
			if (!arr) return
			const clone = arr.find((r) => r.name === row.name)
			if (clone && clone[fieldname] !== value) {
				clone[fieldname] = value
				maybeFetch(cdt, fieldname, value, row)
			}
		})
	}

	// --- Meta-script → layout (set_df_property / toggle_*) -------------------
	// Wrap the four legacy mutators on this frm instance: run the original (keeps
	// the hidden legacy layout + fields_dict consistent), then record an
	// applyMetaScript op so the Vue layout re-resolves.
	function pushOp(fieldname: string, dfProp: string, value: unknown) {
		const prop = DF_PROP_MAP[dfProp]
		if (!prop) return
		ops.value = [...ops.value, { op: 'setFieldProperty', fieldname, prop, value }]
	}
	function toArray(fnames: string | string[]): string[] {
		return Array.isArray(fnames) ? fnames : [fnames]
	}

	const orig = {
		set_df_property: frm.set_df_property,
		toggle_display: frm.toggle_display,
		toggle_enable: frm.toggle_enable,
		toggle_reqd: frm.toggle_reqd,
	}
	frm.set_df_property = function (fieldname: string, property: string, value: unknown, ...rest: any[]) {
		const r = orig.set_df_property.call(this, fieldname, property, value, ...rest)
		// Only mirror top-level field props (a child `table_field` arg is present for
		// grid-cell props, which the Vue grid resolves from its own column meta).
		if (rest[1] == null) pushOp(fieldname, property, value)
		return r
	}
	frm.toggle_display = function (fnames: string | string[], show: boolean) {
		const r = orig.toggle_display.call(this, fnames, show)
		toArray(fnames).forEach((f) => pushOp(f, 'hidden', show ? 0 : 1))
		return r
	}
	frm.toggle_enable = function (fnames: string | string[], enable: boolean) {
		const r = orig.toggle_enable.call(this, fnames, enable)
		toArray(fnames).forEach((f) => pushOp(f, 'read_only', enable ? 0 : 1))
		return r
	}
	frm.toggle_reqd = function (fnames: string | string[], mandatory: boolean) {
		const r = orig.toggle_reqd.call(this, fnames, mandatory)
		toArray(fnames).forEach((f) => pushOp(f, 'reqd', mandatory ? 1 : 0))
		return r
	}

	function resetOps() {
		if (ops.value.length) ops.value = []
	}

	function dispose() {
		disposed = true
		stopHandles.forEach((stop) => stop())
		Object.assign(frm, orig)
	}

	return { layout, doc, seed, resetOps, dispose }
}
