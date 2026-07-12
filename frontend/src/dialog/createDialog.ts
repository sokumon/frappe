// The Dialog bridge (roadmap Part C #1).
//
// `DialogBridge` exposes the same constructor + method surface as the legacy
// `frappe.ui.Dialog` (ui/dialog.js + ui/field_group.js), but instead of building
// a Bootstrap modal it pushes a reactive `DialogState` onto `dialogStack`, which
// `<DialogHost>` (mounted once in App.vue) renders as stacked frappe-ui
// `<Dialog>`s with a `@framework/ui` `<FormLayout>` body — so all registered
// fieldtypes come for free and `depends_on` / `mandatory_depends_on` re-resolve
// reactively instead of via refresh_dependency().
//
// `installDialogBridge()` re-points `frappe.ui.Dialog` at this class. That also
// carries `frappe.prompt`, `frappe.warn` and every `new frappe.ui.Dialog({...})`
// call site, since they construct the class at call time. Subclasses defined at
// bundle-load time (QuickEntryForm, SettingsDialog) captured the legacy class in
// their `extends` clause and stay on the legacy modal path for now.

import { computed, defineComponent, h, markRaw, onMounted, reactive, ref, shallowReactive } from 'vue'
import type { PropType } from 'vue'
import { applyMetaScript, buildLayoutFromMeta, resolveLayout } from '@framework/ui/FormLayout'
import type {
	FieldMeta,
	FieldUI,
	FormLayoutSchema,
	MetaOp,
	RawMetaField,
} from '@framework/ui/FormLayout'
import { makeControl, dialogHost } from '@/form/controls'

// Rendered-but-valueless fieldtypes: skipped by get_values/clear.
const VALUELESS = new Set(['Button', 'Heading', 'HTML'])
const LAYOUT_BREAKS = new Set(['Section Break', 'Column Break', 'Tab Break', 'Fold'])

// Legacy modal size → frappe-ui DialogSize (closest max-width: legacy default
// ~500px, small 300px, large 800px, extra-large 1140px).
const SIZE_MAP: Record<string, string> = {
	'': 'lg',
	small: 'sm',
	large: '3xl',
	'extra-large': '6xl',
}

// Legacy indicator color → frappe-ui DialogTheme + header icon (same mapping as
// the msgprint bridge in composables/dialog.js).
const INDICATOR_THEME: Record<string, string> = {
	blue: 'blue',
	red: 'red',
	green: 'green',
	orange: 'yellow',
	yellow: 'yellow',
}
export const THEME_ICON: Record<string, string> = {
	red: 'lucide-alert-triangle',
	yellow: 'lucide-alert-triangle',
	blue: 'lucide-info',
	green: 'lucide-check-circle',
}

function translate(text: any, replace?: any, context?: any): string {
	const fn = (window as any).__ as ((...a: any[]) => string) | undefined
	return fn ? fn(text, replace, context) : String(text ?? '')
}

function stripHtml(text: any): string {
	if ((window as any).frappe?.utils?.strip_html) return frappe.utils.strip_html(String(text ?? ''))
	return String(text ?? '').replace(/<[^>]*>/g, '')
}

function jq(node?: Element | null) {
	const $ = (window as any).$ || (window as any).jQuery
	return $ ? $(node ?? []) : node
}

function isNull(v: any): boolean {
	return v == null || v === ''
}

// Stand-in for a DOM `classList` before the dialog mounts (see the `wrapper` getter):
// legacy `report_error` calls `wrapper.classList.add(...)` pre-show, when there is no
// root element yet — the class add is a cosmetic no-op there.
const NOOP_CLASSLIST = {
	add() {},
	remove() {},
	toggle() {
		return false
	},
	contains() {
		return false
	},
}

// --- jQuery-ish stubs -------------------------------------------------------
// Legacy element refs (`header`, `footer`, `custom_actions`, …) that have no
// Vue counterpart get an inert chainable so `.addClass()` / `.find()` chains
// don't throw. Anything that must actually *work* maps to reactive state via
// the button proxies below instead.
function chainStub(extra: Record<string, any> = {}): any {
	const stub: any = {}
	const methods = [
		'addClass', 'removeClass', 'toggleClass', 'attr', 'removeAttr', 'prop', 'css',
		'show', 'hide', 'toggle', 'empty', 'append', 'prepend', 'appendTo', 'prependTo',
		'html', 'text', 'on', 'off', 'click', 'trigger', 'remove', 'each', 'val',
	]
	for (const m of methods) stub[m] = () => stub
	stub.find = () => chainStub()
	stub.get = () => undefined
	stub.length = 0
	Object.assign(stub, extra)
	return stub
}

// --- Action state + T2 button proxy ------------------------------------------
// Same trick as createPage.ts `ret()`: the jQuery-ish handle legacy callers
// chain on (`.removeClass("btn-primary").addClass("btn-danger")`, `.prop()`,
// `.html()`) maps each method onto a reactive field the host renders.
export interface DialogActionState {
	label: string
	visible: boolean
	disabled: boolean
	loading: boolean
	extraClass: string
	onClick: ((...args: any[]) => any) | null
}

function makeAction(label: string): DialogActionState {
	return reactive<DialogActionState>({
		label,
		visible: false,
		disabled: false,
		loading: false,
		extraClass: '',
		onClick: null,
	})
}

function btnProxy(action: DialogActionState): any {
	const proxy: any = {
		addClass(cls: string) {
			action.extraClass = [action.extraClass, cls].filter(Boolean).join(' ')
			return proxy
		},
		removeClass(cls: string) {
			action.extraClass = String(action.extraClass || '')
				.split(/\s+/)
				.filter((c) => c && c !== cls)
				.join(' ')
			return proxy
		},
		toggleClass(cls: string, state?: boolean) {
			const has = action.extraClass.split(/\s+/).includes(cls)
			const want = state ?? !has
			return want ? proxy.addClass(cls) : proxy.removeClass(cls)
		},
		html(label?: string) {
			if (label === undefined) return action.label
			action.label = stripHtml(label)
			return proxy
		},
		text(label?: string) {
			return proxy.html(label)
		},
		prop(name: string, value?: any) {
			if (name === 'disabled') {
				if (value === undefined) return action.disabled
				action.disabled = !!value
			}
			return proxy
		},
		attr(name: string, value?: any) {
			return proxy.prop(name, value)
		},
		removeAttr(name: string) {
			if (name === 'disabled') action.disabled = false
			return proxy
		},
		show() {
			action.visible = true
			return proxy
		},
		hide() {
			action.visible = false
			return proxy
		},
		toggle(state?: boolean) {
			action.visible = state ?? !action.visible
			return proxy
		},
		off() {
			return proxy
		},
		on(event: string, handler: (...args: any[]) => any) {
			if (event === 'click') action.onClick = handler
			return proxy
		},
		click(handler?: (...args: any[]) => any) {
			if (handler) action.onClick = handler
			else action.onClick?.()
			return proxy
		},
		trigger(event: string) {
			if (event === 'click') action.onClick?.()
			return proxy
		},
		css() {
			return proxy
		},
		find() {
			return chainStub()
		},
		get() {
			return undefined
		},
		length: 1,
	}
	return proxy
}

// --- HTML fields --------------------------------------------------------------
// Legacy dialogs pre-render into `fields_dict.x.$wrapper` *before* show() (the
// legacy modal DOM exists at construction). We reproduce that by creating a real
// detached node per HTML field at make() time — `$wrapper` points at it
// immediately — and adopting it into the Vue tree when the field mounts.
const AdoptedNodeField = defineComponent({
	name: 'DialogAdoptedNode',
	props: {
		el: { type: Object as PropType<HTMLElement>, required: true },
	},
	setup(props) {
		const host = ref<HTMLElement | null>(null)
		onMounted(() => {
			if (host.value && props.el.parentElement !== host.value) {
				host.value.appendChild(props.el)
			}
		})
		return () => h('div', { ref: host, class: 'dialog-html-field' })
	},
})

// --- The reactive stack --------------------------------------------------------
// <DialogHost> v-for's over this. show() pushes a dialog's state, the host's
// after-leave removes it (state persists on the instance, so re-show re-pushes).
export const dialogStack = reactive<any[]>([])

let nextDialogId = 1

export class DialogBridge {
	// Legacy flags/opts land directly on `this` via Object.assign, mirroring
	// the legacy `$.extend(this, opts)` — so `this.title`, `this.fields`,
	// `this.primary_action`, custom flags etc. all resolve as before.
	[key: string]: any

	constructor(opts: any = {}) {
		this.display = false
		this.is_dialog = true
		this.is_minimized = false
		this.is_visible = false
		this.dirty = false
		this.fetch_dict = {}
		this.fields_dict = {}
		this.fields_list = []
		Object.assign(
			this,
			{
				animate: true,
				size: null,
				auto_make: true,
				centered: false,
				keep_grid_form_open: false,
			},
			opts,
		)
		if (this.auto_make) this.make()
	}

	make() {
		if (this._made) return
		this._made = true

		this.fields = this.fields || []
		// FieldGroup behaviour: derive missing fieldnames from labels, in place
		// (callers keep references to their df objects and mutate them later).
		for (const df of this.fields) {
			if (!df.fieldname && df.label) {
				df.fieldname = df.label.replace(/ /g, '_').toLowerCase()
			}
		}

		// Inline child tables: dialogs pass `fields` + `data` directly on a Table
		// df (no doctype meta). Synthesize a childMetas entry so the grid renders.
		this._childMetas = {} as Record<string, RawMetaField[]>
		for (const df of this.fields) {
			if (df.fieldtype !== 'Table') continue
			if (Array.isArray(df.fields) && df.fields.length) {
				if (!df.options) df.options = `__dialog_table_${df.fieldname}`
				this._childMetas[df.options] = df.fields
			} else if (df.options) {
				const metaFields = frappe.meta?.get_docfields?.(df.options)
				if (metaFields?.length) this._childMetas[df.options] = metaFields
			}
		}

		// Detached nodes for HTML fields (see AdoptedNodeField).
		this._htmlEls = {} as Record<string, HTMLElement>
		for (const df of this.fields) {
			if (df.fieldtype === 'HTML') {
				const el = document.createElement('div')
				if (df.options) el.innerHTML = df.options
				this._htmlEls[df.fieldname] = el
			}
		}

		// Custom-DOM container: legacy callers append into `d.body` / `d.$body`
		// before show(); the host adopts this node under the FormLayout.
		this._bodyEl = document.createElement('div')
		this._bodyEl.className = 'dialog-custom-body'

		// --- reactive value store + defaults ---------------------------------
		// `_vdoc` is what <FormLayout> renders/edits and what get_values reads.
		// It is deliberately distinct from `this.doc`: QuickEntryForm (and other
		// FieldGroup-style consumers) set `this.doc` to a *model* doc before
		// make() and later save it — the bridge must not clobber it. When the
		// caller didn't set one, alias `doc` to the store so `d.doc.fieldname`
		// reads work like a plain FieldGroup.
		this._vdoc = reactive({} as Record<string, any>)
		const presetDoc = this.doc && this.doc !== this._vdoc ? this.doc : null
		for (const df of this.fields) {
			if (LAYOUT_BREAKS.has(df.fieldtype) || !df.fieldname) continue
			if (df.fieldtype === 'Table') {
				const rows = presetDoc?.[df.fieldname] ?? df.data
				this._vdoc[df.fieldname] = Array.isArray(rows) ? [...rows] : []
				continue
			}
			// Caller-provided doc value wins over the df default (FieldGroup
			// seeds defaults first, then set_values/set_defaults overwrite).
			const preset = presetDoc?.[df.fieldname]
			if (preset !== undefined && preset !== null) {
				this._vdoc[df.fieldname] = preset
				continue
			}
			const def = this.get_field_default_value(df)
			if (def !== undefined) this._vdoc[df.fieldname] = def
		}
		if (!presetDoc) this.doc = this._vdoc

		// --- schema: reactive dfs + base build --------------------------------
		// Per-field shallowReactive proxies over the CALLER's df objects (same target,
		// so caller-side value mutations are still visible; writes THROUGH the proxy —
		// `d.fields_dict.x.df.hidden = 1` / set_df_property — are reactively tracked).
		// `_base` is a computed over these, so those writes re-render on their own
		// (matching the form's §2a), while `refresh()` bumps `_schemaVersion` for the
		// legacy "mutate the raw df then refresh()" path (and grid column ops).
		this._reactiveFields = this.fields.map((df: any) => shallowReactive(df))
		const dfByName: Record<string, any> = {}
		for (const df of this._reactiveFields) if (df.fieldname) dfByName[df.fieldname] = df

		const self = this
		this._decorate = (field: FieldMeta): FieldUI | void => {
			const df = dfByName[field.fieldname]
			if (!df) return // child-table column
			if (df.fieldtype === 'HTML') {
				return {
					component: markRaw(AdoptedNodeField),
					props: { el: self._htmlEls[df.fieldname] },
				}
			}
			if (df.fieldtype === 'Button') {
				return { on: { click: () => df.click?.apply(self) } }
			}
			const ui: FieldUI = {
				on: {
					change: (value: any) => {
						self.dirty = true
						const handler = df.change || df.onchange
						handler?.call(self, value)
					},
				},
			}
			if (df.fieldtype === 'Link' || df.fieldtype === 'Dynamic Link') {
				// Evaluate `get_query` (set in opts or later via set_query /
				// fields_dict.x.get_query=) on every render; the getter re-runs
				// when the resolved layout recomputes on doc edits.
				ui.props = {
					get filters() {
						return self._resolveLinkFilters(df)
					},
				}
			}
			return ui
		}

		this._ops = ref<MetaOp[]>([])
		this._schemaVersion = ref(0)
		this._base = computed<FormLayoutSchema>(() => {
			this._schemaVersion.value // explicit-refresh + grid-column-op dep
			return this._buildBase()
		})
		this._layout = computed(() => applyMetaScript(this._base.value, this._ops.value))

		// --- fields_dict: one control per field (unified with the desk form) ---
		const host = dialogHost(this)
		for (const df of this._reactiveFields) {
			if (LAYOUT_BREAKS.has(df.fieldtype) || !df.fieldname) continue
			const control = makeControl({ df, host })
			if (!control) continue
			// Dialog `get_query` lives on the df (the decorator reads `df.get_query`);
			// proxy the control's `get_query` to it so `d.fields_dict.x.get_query = fn`
			// and `set_query` agree with what the Link decorator resolves.
			Object.defineProperty(control, 'get_query', {
				configurable: true,
				get: () => df.get_query,
				set: (fn) => {
					df.get_query = fn
				},
			})
			this.fields_dict[df.fieldname] = control
			this.fields_list.push(control)
		}

		// --- footer actions ------------------------------------------------------
		this._primary = makeAction(translate('Submit', null, 'Primary action in dialog'))
		this._secondary = makeAction(translate('Cancel'))
		// The legacy secondary button without an explicit handler dismisses the
		// modal (data-dismiss semantics callers rely on).
		this._secondary.onClick = () => this.hide()
		this._primaryProxy = btnProxy(this._primary)
		this._secondaryProxy = btnProxy(this._secondary)

		// Legacy jQuery element refs. `standard_actions.find(".btn-primary")` is
		// load-bearing (frappe.warn re-themes the primary button); the rest are
		// inert chainables.
		this.standard_actions = chainStub({
			find: (sel: string) => {
				if (String(sel).includes('primary')) return this._primaryProxy
				if (String(sel).includes('secondary')) return this._secondaryProxy
				return chainStub()
			},
		})
		this.custom_actions = chainStub()
		this.header = chainStub()
		this.footer = chainStub({
			find: (sel: string) => this.standard_actions.find(sel),
		})

		// --- reactive state consumed by <DialogHost> ----------------------------
		if (!this.size) this.set_modal_size()
		this.state = reactive({
			id: nextDialogId++,
			open: false,
			title: stripHtml(this.title || ''),
			size: SIZE_MAP[this.size || ''] || 'lg',
			indicator: this.indicator ? INDICATOR_THEME[this.indicator] : undefined,
			static: !!this.static,
			noCancel: !!this.static,
			message: '',
			alert: null as { text: string; cls: string } | null,
			customActions: [] as DialogActionState[],
			primary: this._primary,
			secondary: this._secondary,
			layout: this._layout,
			doc: this._vdoc,
			bodyEl: this._bodyEl,
			rootEl: null as HTMLElement | null,
			dialog: markRaw(this),
		})

		// Footer wiring (port of legacy make()).
		this.action = this.action || { primary: {}, secondary: {} }
		if (this.primary_action || (this.action.primary && this.action.primary.onsubmit)) {
			this.set_primary_action(
				this.primary_action_label ||
					this.action.primary.label ||
					translate('Submit', null, 'Primary action in dialog'),
				this.primary_action || this.action.primary.onsubmit,
			)
		}
		if (this.secondary_action) {
			this.set_secondary_action(this.secondary_action)
		}
		if (this.secondary_action_label || (this.action.secondary && this.action.secondary.label)) {
			this.set_secondary_action_label(
				this.secondary_action_label || this.action.secondary.label,
			)
		}
	}

	_buildBase(): FormLayoutSchema {
		// Build from the REACTIVE df proxies so tracked reads re-run `_base`.
		const renderable = (this._reactiveFields || this.fields).filter(
			(df: any) => df.fieldtype !== 'Fold',
		)
		return buildLayoutFromMeta(renderable, {
			childMetas: this._childMetas,
			decorate: this._decorate,
		})
	}

	_resolveLinkFilters(df: any) {
		if (!df.get_query) return df.filters
		try {
			const q = typeof df.get_query === 'function' ? df.get_query.call(this, this._vdoc) : df.get_query
			if (q && typeof q === 'object' && q.filters) return q.filters
		} catch (e) {
			console.warn(`Dialog get_query for ${df.fieldname} failed`, e)
		}
		return df.filters
	}

	// Port of FieldGroup.get_field_default_value + resolve_date_default_keywords.
	get_field_default_value(df: any) {
		let def = df.default
		const isNumeric = frappe.model?.is_numeric_field?.(df.fieldtype)
		if (def == null || (!def && !isNumeric)) return undefined
		if (typeof def !== 'string') return def

		if (['Date', 'Datetime', 'Time'].includes(df.fieldtype)) {
			const lowered = def.toLowerCase()
			if (lowered === 'today' && df.fieldtype === 'Date') return frappe.datetime.get_today()
			if (lowered === 'now' && df.fieldtype === 'Datetime') return frappe.datetime.now_datetime()
			if (lowered === 'now' && df.fieldtype === 'Time') return frappe.datetime.now_time()
			return def
		}
		if (def === '__user' || def.toLowerCase() === 'user') return frappe.session.user
		if (def === 'user_fullname') return frappe.session.user_fullname
		return def
	}

	_fieldWrapper(df: any) {
		if (this._htmlEls[df.fieldname]) return jq(this._htmlEls[df.fieldname])
		const root = this.state?.rootEl
		const node = root?.querySelector(`[data-fieldname="${df.fieldname}"]`)
		return jq(node ?? null)
	}

	_focusField(fieldname: string) {
		const root = this.state?.rootEl
		const el = root?.querySelector(
			`[data-fieldname="${fieldname}"] input, [data-fieldname="${fieldname}"] select, [data-fieldname="${fieldname}"] textarea`,
		)
		el?.focus?.()
	}

	// Resolved (depends_on-baked) hidden/reqd per fieldname, for get_values.
	_resolvedFieldFlags(): Record<string, { hidden: boolean; reqd: boolean }> {
		const flags: Record<string, { hidden: boolean; reqd: boolean }> = {}
		const resolved = resolveLayout(this._layout.value, this._vdoc, this._vdoc)
		for (const tab of resolved) {
			for (const section of tab.sections) {
				for (const column of section.columns) {
					for (const field of column.fields) {
						flags[field.fieldname] = {
							hidden: !!(field.hidden || (tab as any).hidden || (section as any).hidden),
							reqd: !!field.reqd,
						}
					}
				}
			}
		}
		return flags
	}

	// --- FieldGroup surface ---------------------------------------------------

	get_field(fieldname: string) {
		return this.fields_dict[fieldname]
	}

	has_field(fieldname: string) {
		return !!this.fields_dict[fieldname]
	}

	get_input(fieldname: string) {
		return this.fields_dict[fieldname]?.$input ?? jq(null)
	}

	get_value(key: string) {
		return this._vdoc[key]
	}

	set_value(key: string, val: any) {
		return new Promise<void>((resolve) => {
			const shim = this.fields_dict[key]
			if (shim) {
				this._vdoc[key] = val
				const handler = shim.df.change || shim.df.onchange
				handler?.call(this, val)
			}
			resolve()
		})
	}

	set_input(key: string, val: any) {
		return this.set_value(key, val)
	}

	set_values(dict: Record<string, any>) {
		const promises = Object.keys(dict)
			.filter((key) => this.fields_dict[key])
			.map((key) => this.set_value(key, dict[key]))
		return Promise.all(promises)
	}

	get_values(ignore_errors?: boolean, check_invalid?: boolean) {
		const ret: Record<string, any> = {}
		const errors: string[] = []
		const flags = this._resolvedFieldFlags()

		for (const shim of this.fields_list) {
			const df = shim.df
			if (VALUELESS.has(df.fieldtype)) continue
			let v = this._vdoc[df.fieldname]
			if (isNull(v) && df.include_default) v = df.default

			const resolved = flags[df.fieldname]
			const reqd = resolved ? resolved.reqd : !!df.reqd
			const hidden = resolved ? resolved.hidden : !!df.hidden
			const checkValue = typeof v === 'string' ? stripHtml(v) : v
			if (reqd && !hidden && isNull(checkValue)) {
				errors.push(translate(df.label || df.fieldname))
			}
			if (!isNull(v)) ret[df.fieldname] = v
		}

		if (errors.length && !ignore_errors) {
			frappe.msgprint({
				title: translate('Missing Values Required'),
				message:
					translate('Following fields have missing values:') +
					'<br><br><ul><li>' +
					errors.join('<li>') +
					'</ul>',
				indicator: 'orange',
			})
			return null
		}
		return ret
	}

	set_df_property(fieldname: string, prop: string, value: any) {
		if (!fieldname) return
		const control = this.fields_dict[fieldname]
		if (!control) return
		// Write the REACTIVE df → `_base` recomputes on its own (no op push needed).
		control.df[prop] = value
		if (control.df.fieldtype === 'HTML' && prop === 'options') {
			const el = this._htmlEls[fieldname]
			if (el) el.innerHTML = value ?? ''
		}
	}

	set_query(fieldname: string, opt1: any, opt2?: any) {
		if (opt2) {
			// child-table field: set_query(fieldname, parent_fieldname, query)
			const parent = this.fields_dict[opt1]
			const child = parent?.grid?.get_field?.(fieldname)
			if (child) child.df.get_query = opt2
		} else if (this.fields_dict[fieldname]) {
			this.fields_dict[fieldname].df.get_query = opt1
		}
	}

	add_fetch(link_field: string, source_field: string, target_field: string, target_doctype?: string) {
		if (!target_doctype) target_doctype = '*'
		const dict = this.fetch_dict
		dict[target_doctype] = dict[target_doctype] || {}
		dict[target_doctype][link_field] = dict[target_doctype][link_field] || {}
		dict[target_doctype][link_field][target_field] = source_field
	}

	refresh() {
		// `_base` is a computed; bump the version so the legacy "mutate the raw df
		// then refresh()" path (and grid column ops via rebuild_schema) re-render.
		this._schemaVersion.value++
	}

	refresh_dependency() {
		// depends_on re-resolves reactively in FormLayout; nothing to do.
	}

	clear() {
		for (const shim of this.fields_list) {
			const df = shim.df
			if (VALUELESS.has(df.fieldtype)) continue
			if (df.fieldtype === 'Table') {
				this._vdoc[df.fieldname] = []
			} else {
				this._vdoc[df.fieldname] = df.default ?? ''
			}
		}
		this.clear_message()
	}

	focus_on_first_input() {
		if (this.no_focus) return
		const el = this.state?.rootEl?.querySelector(
			'input:not([type=hidden]):not([type=checkbox]), select, textarea',
		)
		el?.focus?.()
	}

	is_new() {
		return this.doc?.__islocal
	}

	// --- Dialog surface ---------------------------------------------------------

	// Port of legacy set_modal_size: >2 column breaks in a section → large,
	// >=4 → extra-large.
	set_modal_size() {
		if (!this.fields || !this.fields.length) {
			this.size = ''
			return
		}
		let colBreaks = 0
		let current = 0
		for (const field of this.fields) {
			if (field.fieldtype === 'Column Break') {
				current++
				if (current > colBreaks) colBreaks = current
			} else if (field.fieldtype === 'Section Break') {
				current = 0
			}
		}
		this.size = colBreaks >= 4 ? 'extra-large' : colBreaks >= 2 ? 'large' : ''
	}

	show() {
		if (!this._made) this.make()
		if (!dialogStack.includes(this.state)) dialogStack.push(this.state)
		this.state.open = true

		this.display = true
		this.is_visible = true
		this.is_minimized = false
		;(window as any).cur_dialog = this
		frappe.ui.open_dialogs = frappe.ui.open_dialogs || []
		if (!frappe.ui.open_dialogs.includes(this)) frappe.ui.open_dialogs.push(this)

		this.clear_message()
		this.primary_action_fulfilled = false
		this.on_page_show && this.on_page_show()
		;(window as any).$?.(document).trigger('frappe.ui.Dialog:shown')
		return this
	}

	hide() {
		if (!this.display && !this.state?.open) return
		this.state.open = false
		this.display = false
		this.is_visible = false
		this.is_minimized = false

		const openDialogs = frappe.ui.open_dialogs || []
		const idx = openDialogs.indexOf(this)
		if (idx > -1) openDialogs.splice(idx, 1)
		;(window as any).cur_dialog = openDialogs[openDialogs.length - 1] || null

		if (!this.keep_grid_form_open) {
			frappe.ui.form?.get_open_grid_form?.()?.hide_form()
		}
		this.onhide && this.onhide()
		this.on_hide && this.on_hide()
	}

	// Called by <DialogHost> once the leave transition finishes.
	_afterLeave() {
		const idx = dialogStack.indexOf(this.state)
		if (idx > -1) dialogStack.splice(idx, 1)
		this.state.rootEl = null
	}

	cancel() {
		this.hide()
	}

	no_cancel() {
		if (this.state) this.state.noCancel = true
	}

	toggle_minimize() {
		// Minimize is not supported by the Vue chrome (yet); keep the flag sane.
		this.is_minimized = false
	}

	hide_scrollbar() {}

	handle_focus() {}

	set_title(title: any) {
		this.title = title
		if (this.state) this.state.title = stripHtml(title)
	}

	set_indicator() {
		if (this.state) {
			this.state.indicator = this.indicator ? INDICATOR_THEME[this.indicator] : undefined
		}
	}

	set_message(text: string) {
		if (this.state) this.state.message = String(text ?? '')
	}

	clear_message() {
		if (this.state) this.state.message = ''
	}

	set_alert(text: string, alert_class = 'info') {
		if (this.state) this.state.alert = { text: String(text ?? ''), cls: alert_class }
	}

	clear_alert() {
		if (this.state) this.state.alert = null
	}

	set_primary_action(label: string, click?: (values: any) => any) {
		this.has_primary_action = true
		const action = this._primary
		action.label = stripHtml(label)
		action.visible = true
		if (typeof click === 'function') {
			action.onClick = () => {
				this.primary_action_fulfilled = true
				const values = this.get_values()
				if (!values) return
				const result = click.apply(this, [values])
				if (result && typeof result.then === 'function') {
					action.loading = true
					Promise.resolve(result).finally(() => {
						action.loading = false
					})
				}
				return result
			}
		}
		return this._primaryProxy
	}

	set_secondary_action(click: (...args: any[]) => any) {
		const action = this._secondary
		action.visible = true
		action.onClick = (...args: any[]) => click?.apply(this, args)
		return this._secondaryProxy
	}

	set_secondary_action_label(label: string) {
		this._secondary.label = stripHtml(label)
		this._secondary.visible = true
	}

	disable_primary_action() {
		this._primary.disabled = true
	}

	enable_primary_action() {
		this._primary.disabled = false
	}

	get_primary_btn() {
		return this._primaryProxy
	}

	get_secondary_btn() {
		return this._secondaryProxy
	}

	get_close_btn() {
		const self = this
		const stub = chainStub()
		stub.hide = () => {
			self.state.noCancel = true
			return stub
		}
		stub.show = () => {
			self.state.noCancel = false
			return stub
		}
		stub.toggle = (show: boolean) => {
			self.state.noCancel = !show
			return stub
		}
		stub.trigger = (event: string) => {
			if (event === 'click') self.hide()
			return stub
		}
		stub.click = () => {
			self.hide()
			return stub
		}
		return stub
	}

	get_minimize_btn() {
		return chainStub()
	}

	add_custom_action(label: string, action?: (...args: any[]) => any, css_class?: string) {
		const custom = makeAction(stripHtml(label))
		custom.visible = true
		custom.extraClass = css_class || ''
		custom.onClick = action ? (...args: any[]) => action.apply(this, args) : null
		this.state.customActions.push(custom)
	}

	add_custom_button() {}

	// --- legacy element refs -----------------------------------------------------

	get body(): HTMLElement {
		return this._bodyEl
	}

	get $body() {
		return jq(this._bodyEl)
	}

	get modal_body() {
		return jq(this._bodyEl)
	}

	// jQuery like the post-make legacy `this.wrapper` (Layout.make reassigns it
	// to a jQuery node; QuickEntryForm calls `this.wrapper.keydown(...)`). An
	// unmounted dialog yields an empty set, so chains no-op instead of throwing.
	// Legacy `frappe.request.report_error` instead treats it as a raw DOM node
	// (`wrapper.classList.add("msgprint-dialog")`, request.js:657) — and does so
	// BEFORE show(), when there's no rootEl. So expose a `classList` proxying the
	// mounted root (a no-op stub pre-mount) so BOTH callers work and a server 500
	// renders its error dialog instead of throwing a masking TypeError.
	get wrapper() {
		const w = jq(this.state?.rootEl ?? null)
		if (w && w.classList === undefined) {
			Object.defineProperty(w, 'classList', {
				configurable: true,
				get: () => this.state?.rootEl?.classList ?? NOOP_CLASSLIST,
			})
		}
		return w
	}

	get $wrapper() {
		return jq(this.state?.rootEl ?? null)
	}

	get $message() {
		return chainStub()
	}
}

export function installDialogBridge() {
	const f = (window as any).frappe
	if (!f) return
	f.ui = f.ui || {}
	// Keep the legacy class reachable (debugging / explicit fallback).
	if (f.ui.Dialog && f.ui.Dialog !== DialogBridge) f.ui.LegacyDialog = f.ui.Dialog
	f.ui.Dialog = DialogBridge
	f.ui.open_dialogs = f.ui.open_dialogs || []
	f.ui.hide_open_dialog = () => {
		;(window as any).cur_dialog?.hide()
	}

	// QuickEntryForm subclassed frappe.ui.Dialog at bundle-load time, before the
	// bridge installed, so its `extends` captured the legacy class. `super` in a
	// constructor resolves *dynamically* via the class object's [[Prototype]], so
	// re-parenting both the constructor and its prototype moves QuickEntryForm —
	// and every doctype-specific subclass (CustomerQuickEntryForm, …), which
	// chains through it — onto the bridge.
	const QuickEntryForm = f.ui.form?.QuickEntryForm
	if (QuickEntryForm && !(QuickEntryForm.prototype instanceof DialogBridge)) {
		Object.setPrototypeOf(QuickEntryForm, DialogBridge)
		Object.setPrototypeOf(QuickEntryForm.prototype, DialogBridge.prototype)
	}
}
