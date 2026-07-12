// host.ts
//
// The `ControlHost` adapter. One `FrappeControl*` class hierarchy backs both the
// desk form's `frm.fields_dict` and a dialog's `dialog.fields_dict`; the only thing
// that differs between the two is *where the data lives* and *how the DOM resolves*.
// A host captures exactly that difference:
//
//   • `frmHost(frm)`    — routes value/df writes through `frappe.model` + the frm,
//                         and resolves wrappers against the live desk form DOM.
//   • `dialogHost(dlg)` — routes through the dialog's reactive `_vdoc`, and resolves
//                         wrappers against the dialog's rendered root.
//
// So `ui/` stays pure-render (it knows nothing about frm vs dialog) and the classes
// stay host-agnostic.

declare const frappe: any
declare const $: any

export interface ControlHost {
	/** Owning doctype for model routing; empty/undefined in a plain dialog FieldGroup. */
	doctype?: string
	/** LIVE getter — '' at build time, set once the doc loads. Never capture it. */
	readonly docname?: string
	/** The desk form engine; undefined in dialogs. */
	frm?: any
	/** The reactive doc controls read/write (`frm.doc` | `dialog._vdoc`). */
	get_doc(): any
	get_value(fieldname: string): any
	/** Commit a value: `frappe.model.set_value` on a form, `dialog.set_value` in a dialog. */
	set_value(fieldname: string, value: any): Promise<any> | void
	/** Write a per-form reactive docfield property → re-renders via the layout computed. */
	set_df_property(fieldname: string, prop: string, value: any): void
	/**
	 * The field's jQuery wrapper: the live `[data-fieldname]` node when mounted,
	 * else a stable per-field detached sink (so `.find()/.html()/.addClass()` never
	 * throw for unmounted/hidden fields). HTML fields always get their eager
	 * detached node — `HtmlField.vue` adopts `$wrapper[0]`.
	 */
	resolve_wrapper(df: any): any
	/** Re-sync the reactive view from the model for one field (bridge `seedField`). */
	refresh_view(fieldname: string): void
	/**
	 * Rebuild the whole layout schema. On a form this is a no-op — the base schema
	 * is a computed over the reactive dfs, so a df write re-renders on its own; a
	 * dialog's `_base` is a plain ref, so a grid column op must trigger `refresh()`.
	 */
	rebuild_schema?(): void
	/** Release detached sinks (called from `frm.teardown()`); no-op in dialogs. */
	release?(): void
}

const SINK_CLASS = 'frappe-control form-field-wrapper old-desk-view'

// Per-host detached-node store. HTML fields get an eager node (created on first
// resolve, before mount, so `HtmlField.vue` can adopt it); every other field gets a
// lazily-created sink only when no live node exists yet — strictly less DOM than the
// old "eager node per docfield" scheme.
function makeSinkStore() {
	const sinks: Record<string, HTMLElement> = {}
	const ensure = (fieldname: string): HTMLElement => {
		let el = sinks[fieldname]
		if (!el) {
			el = document.createElement('div')
			el.className = SINK_CLASS
			el.setAttribute('data-fieldname', fieldname)
			sinks[fieldname] = el
		}
		return el
	}
	const release = () => {
		for (const k of Object.keys(sinks)) {
			sinks[k].remove()
			delete sinks[k]
		}
	}
	return { sinks, ensure, release }
}

export function frmHost(frm: any): ControlHost {
	const store = makeSinkStore()
	return {
		doctype: frm.doctype,
		get docname() {
			return frm.docname
		},
		frm,
		get_doc: () => frm.doc,
		get_value: (fieldname: string) => frm.doc?.[fieldname],
		set_value: (fieldname: string, value: any) =>
			frappe.model.set_value(frm.doctype, frm.docname, fieldname, value),
		set_df_property: (fieldname: string, prop: string, value: any) =>
			frm.set_df_property(fieldname, prop, value),
		resolve_wrapper: (df: any) => {
			const fieldname = df.fieldname
			// HTML fields: always the eager detached node HtmlField.vue adopts.
			if (df.fieldtype === 'HTML') return $(store.ensure(fieldname))
			// Otherwise the live rendered node if the form is mounted, else a sink.
			const root: HTMLElement | undefined = frm.wrapper
			const live = fieldname && root?.querySelector?.(`[data-fieldname="${fieldname}"]`)
			return $(live || store.ensure(fieldname))
		},
		// The bridge installs `frm._seed_field` (identity-preserving per-field mirror
		// resync) once it's built; before that a refresh is a harmless no-op.
		refresh_view: (fieldname: string) => frm._seed_field?.(fieldname),
		release: store.release,
	}
}

export function dialogHost(dialog: any): ControlHost {
	return {
		doctype: dialog.doctype,
		get docname() {
			return dialog.doc?.name
		},
		frm: undefined,
		get_doc: () => dialog._vdoc,
		get_value: (fieldname: string) => dialog._vdoc?.[fieldname],
		set_value: (fieldname: string, value: any) => dialog.set_value(fieldname, value),
		set_df_property: (fieldname: string, prop: string, value: any) =>
			dialog.set_df_property(fieldname, prop, value),
		// Mirrors the legacy dialog shim: HTML nodes are pre-rendered, other fields
		// resolve against the dialog's rendered root (`[data-fieldname]`).
		resolve_wrapper: (df: any) => dialog._fieldWrapper(df),
		// The dialog's `_vdoc` IS the reactive source; scalar controls need no resync.
		// (Dialog grids sync `df.data → _vdoc` inside the grid facade's refresh.)
		refresh_view: () => {},
		// Grid column ops mutate inline `df.fields`; the dialog's `_base` is a ref, so
		// rebuild it to pick the change up.
		rebuild_schema: () => dialog.refresh(),
	}
}
