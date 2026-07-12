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
import { makeModelListeners } from '@/form/modelEvents'

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

export interface FormBridge {
	/** Render-ready schema for `<FormLayout :layout>`, rebuilt from the controls' reactive dfs. */
	layout: ComputedRef<FormLayoutSchema>
	/** Reactive doc for `<FormLayout :doc>`; mirrors `frm.doc` (scalars + child clones). */
	doc: Record<string, any>
	/** Re-seed the whole reactive doc from `frm.doc` (call on doc (re)load / name change). */
	seed: () => void
	/** Identity-preserving per-field mirror resync (frm.refresh_field / control.refresh). */
	seedField: (fieldname: string) => void
	/** Inert API-compat no-op (meta-script ops are gone; the layout computed re-renders). */
	resetOps: () => void
	/** Detach model listeners. */
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
	// Child column metas are the frm's per-cdt-per-form REACTIVE child dfs (built in
	// build_fields_dict), so a `grid.update_docfield_property` / child `df.hidden = 1`
	// write re-renders the column through this rebuild.
	const childMetas: Record<string, RawMetaField[]> = frm._child_dfs

	// Inert API-compat: meta-script ops are gone (df mutation drives rendering now),
	// but `applyMetaScript` with zero ops is identity, so callers of `resetOps` are safe.
	const ops = ref<MetaOp[]>([])

	// Base schema is a COMPUTED over the controls' reactive dfs (parent + grid child):
	// any tracked df read (hidden/label/reqd/read_only/options/description/…) re-runs
	// the build, so `field.df.hidden = 1` — or legacy `set_df_property` — re-renders
	// with no explicit refresh (§2a). `controls_version` is a defensive dep so a
	// fields_dict rebuild also invalidates it. Rebuild churn is safe: FormLayout
	// already produces a fresh resolved tree on every keystroke.
	const base = computed<FormLayoutSchema>(() => {
		frm.controls_version?.value
		const controlDfs = (frm.fields || []).map((f: any) => f.df)
		return buildLayoutFromMeta(controlDfs, { childMetas, decorate: commitDecorator })
	})
	const layout = computed<FormLayoutSchema>(() => applyMetaScript(base.value, ops.value))

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

	// Identity-preserving per-field resync. Scripts mutate `frm.doc` directly then
	// call `frm.refresh_field(f)` (e.g. `frm.doc.items.forEach(...)`), which bypasses
	// `frappe.model.set_value` and thus the mirror; this pulls the change in. Child
	// rows are matched by `name` and updated IN PLACE (Object.assign into the existing
	// clone) so the Grid's row-key WeakMap + selection survive — a fresh row object
	// would re-key and drop selection. Writes go through the `seeding` guard because
	// the table reassignment re-triggers the sync reconcile watcher (which
	// early-returns on `seeding`), avoiding a loop.
	function seedField(fieldname: string) {
		if (!frm.doc || !(fieldname in frm.doc)) return
		const v = frm.doc[fieldname]
		seeding = true
		try {
			if (Array.isArray(v)) {
				const existing = Array.isArray(doc[fieldname]) ? doc[fieldname] : []
				const byName = new Map(
					existing.filter((r: any) => r.name).map((r: any) => [r.name, r])
				)
				doc[fieldname] = v.map((row: any) => {
					const clone = row.name ? byName.get(row.name) : undefined
					if (clone) {
						Object.assign(clone, row)
						return clone
					}
					return { ...row }
				})
			} else if (doc[fieldname] !== v) {
				doc[fieldname] = v
			}
		} finally {
			seeding = false
		}
	}
	// The frmHost's refresh_view + frm.refresh_field call this via `frm._seed_field`.
	frm._seed_field = seedField

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

	// Model listeners registered through a tracker so `dispose()` can splice them out
	// (there is no frappe.model.off) — otherwise each Form.vue mount leaks the whole
	// frm graph and a stale instance can double-fire scripts/fetches.
	const listeners = makeModelListeners()

	// Parent scalars.
	listeners.on(doctype, '*', (fieldname: string, value: any, d: any) => {
		if (disposed || d.name !== frm.docname) return
		if (!Array.isArray(frm.doc[fieldname]) && doc[fieldname] !== value) {
			doc[fieldname] = value
			maybeFetch(doctype, fieldname, value, frm.doc)
		}
	})

	// Child rows (one handler per unique child doctype; matched by parentfield so
	// two child tables of the same doctype don't cross-write).
	for (const cdt of new Set(tableFields.map((t) => t.cdt))) {
		listeners.on(cdt, '*', (fieldname: string, value: any, row: any) => {
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

	// Meta-script mutators (set_df_property / toggle_*) are NO LONGER wrapped: they
	// write the per-form reactive df (single-df invariant), which re-renders through
	// the `base` computed on its own (§2a). `resetOps` stays as an inert no-op so
	// Form.vue's `resetOps()` call is harmless.
	function resetOps() {
		if (ops.value.length) ops.value = []
	}

	function dispose() {
		disposed = true
		stopHandles.forEach((stop) => stop())
		listeners.offAll()
	}

	return { layout, doc, seed, seedField, resetOps, dispose }
}
