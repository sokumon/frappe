<script setup lang="ts">
// The form (document-metadata) sidebar, rebuilt for the Vue shell. In vue_shell
// mode form.js never creates the legacy `frappe.ui.form.Sidebar` (form.js:626),
// so this component owns the right-hand panel.
//
// Per the repo's bridge-first migration pattern: Vue renders the section *chrome*
// (a port of `form/templates/form_sidebar.html`, keeping the exact class names the
// legacy widgets bind to), and the heavy stateful widgets (AssignTo, Attachments,
// Share, TagEditor, likes, user image) stay the existing `frappe.ui.form.*`
// classes — mounted into these DOM nodes by reusing the legacy Sidebar's own
// `make_*`/`refresh` methods. We skip its template-render step and feed it our
// nodes instead.
//
// The chrome lives inside `.old-desk-view` because the desk SCSS (form_sidebar.scss)
// is `@scope`d to that wrapper.
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'

declare const frappe: any
const jq = (window as any).$ || (window as any).jQuery
// Translation helper + label markup; `__` is a desk global, not template-visible
// unless bound here.
const __ = (window as any).__ || ((s: string) => s)

const props = defineProps<{ frm: any }>()

// Gate the chrome until the doc is loaded (first `form-refresh`); `tick` makes the
// title/name computeds re-evaluate on every refresh (frm.doc is a plain object).
const ready = ref(false)
const tick = ref(0)
let wired = false

const sideSectionEl = useTemplateRef<HTMLDivElement>('sideSectionEl')
const formSidebarEl = useTemplateRef<HTMLDivElement>('formSidebarEl')

// --- chrome data (mirrors form_sidebar.html's jinja context) ---
const escape = (s: string) => frappe.utils.escape_html(frappe.utils.html2text(s ?? ''))

const imageField = computed(() => {
	tick.value
	return props.frm?.meta?.image_field ?? false
})
const isBeta = computed(() => {
	tick.value
	return !!props.frm?.meta?.beta
})
const title = computed(() => {
	tick.value
	return props.frm?.get_title?.() ?? ''
})
const titleText = computed(() => escape(title.value))
const docName = computed(() => {
	tick.value
	return props.frm?.doc?.name ?? ''
})
const nameText = computed(() => escape(docName.value))
const showName = computed(() => title.value && title.value !== docName.value)
const canWrite = computed(() => {
	tick.value
	const frm = props.frm
	if (!frm) return false
	const imgField = frm.fields_dict?.[frm.meta?.image_field]
	return frappe.model.can_write(frm.doctype, frm.docname) && !imgField?.df?.read_only
})

// Section-label markup (icon + text), matching the legacy template output.
const label = (icon: string, text: string) =>
	`${frappe.utils.icon(icon)}<span class="ellipsis">${text}</span>`
const iconLink = label('link-2', __('Links'))
const iconAssign = label('users', __('Assign'))
const iconAttach = label('paperclip', __('Attachments'))
const iconShare = label('share-2', __('Share'))
const iconTag = `${frappe.utils.icon('tag')}<span class="tags-label ellipsis">${__('Tags')}</span>`

// --- widget bridging: reuse the legacy Sidebar's wiring against our DOM ---
function wire() {
	if (wired) return
	const frm = props.frm
	if (!frm?.doc || !formSidebarEl.value || !sideSectionEl.value) return
	wired = true

	// `page` shim: the legacy refresh() toggles `this.page.sidebar` (the outer
	// section) with the `hide-sidebar` class; print needs page.add_action_icon which
	// is unavailable in vue_shell, so it's intentionally absent (setup_print skipped).
	const pageShim = { sidebar: jq(sideSectionEl.value) }
	const sb = new frappe.ui.form.Sidebar({ frm, page: pageShim, toolbar: frm.toolbar })

	// Refs that make() normally sets from its rendered template; we point them at
	// our Vue-rendered nodes instead.
	sb.sidebar = jq(formSidebarEl.value)
	sb.user_actions = sb.sidebar.find('.user-actions')
	sb.user_actions_list = sb.sidebar.find('.user-actions-list')
	sb.image_section = sb.sidebar.find('.sidebar-image-section')
	sb.image_wrapper = sb.image_section.find('.sidebar-image-wrapper')
	frm.sidebar = sb

	sb.make_assignments()
	sb.make_attachments()
	sb.make_shared()
	sb.make_tags()
	sb.make_like()
	sb.setup_copy_event()
	sb.show_auto_repeat_status()
	frappe.ui.form.setup_user_image_event(frm)

	// Toolbar/page-action dependent bits are vue_shell-gated; deferred for now:
	// setup_editable_title (needs frm.toolbar), setup_print (needs
	// page.add_action_icon), setup_keyboard_shortcuts (frappe.ui.keys group).

	sb.refresh()
}

function onFormRefresh(_e: any, frm: any) {
	if (frm !== props.frm) return
	tick.value++
	if (!ready.value) ready.value = true
	nextTick(() => {
		if (!wired) wire()
		else props.frm?.sidebar?.refresh?.()
	})
}

onMounted(() => {
	jq(document).on('form-refresh.formsidebar', onFormRefresh)
	// If the form already refreshed before we mounted, sync immediately.
	if (props.frm?.doc) onFormRefresh(null, props.frm)
})

onUnmounted(() => {
	jq(document).off('form-refresh.formsidebar', onFormRefresh)
})

// Allow the parent to force a refresh if needed.
defineExpose({ refresh: () => props.frm?.sidebar?.refresh?.() })
</script>

<template>
	<div v-if="ready" class="old-desk-view form-sidebar-host h-full shrink-0 overflow-auto">
		<div ref="sideSectionEl" class="layout-side-section h-full w-64">
			<div ref="formSidebarEl" class="form-sidebar overlay-sidebar">
				<!-- image -->
				<div class="flex justify-between sidebar-image-section sidebar-section hide">
					<div class="sidebar-image-wrapper">
						<img class="sidebar-image" />
						<div class="sidebar-standard-image">
							<div class="standard-image"></div>
						</div>
						<div v-if="canWrite" class="sidebar-image-actions">
							<div class="sidebar-image-upload-hint">
								<svg class="es-icon icon-sm">
									<use href="#es-line-camera"></use>
								</svg>
							</div>
							<a class="sidebar-image-remove">
								<svg class="icon icon-sm"><use href="#icon-x"></use></svg>
							</a>
						</div>
					</div>
					<div v-if="imageField" class="align-items-baseline flex form-stats-likes">
						<div class="form-title-edit"></div>
						<div class="form-print"></div>
						<span class="liked-by like-action d-flex align-items-center">
							<svg class="icon icon-sm like-icon pointer">
								<use href="#icon-heart"></use>
							</svg>
						</span>
					</div>
				</div>

				<!-- title / name -->
				<div class="sidebar-section sidebar-meta-details border-bottom">
					<div class="flex justify-between overflow-hidden">
						<div class="ellipsis">
							<div
								class="form-details flex justify-between form-title-text"
								:data-copy="titleText"
							>
								<span class="bold ellipsis mr-3 text-medium">{{ titleText }}</span>
							</div>
							<div v-if="isBeta" class="pt-1">
								<label
									class="indicator-pill yellow mb-0"
									:title="__('This feature is brand new and still experimental')"
									>{{ __('Experimental') }}</label
								>
							</div>
							<div
								v-if="showName"
								class="form-name-container mt-1 flex justify-between form-name-copy"
								:data-copy="nameText"
								:title="nameText"
							>
								<span class="ellipsis mr-3">{{ nameText }}</span>
							</div>
						</div>
						<div v-if="!imageField" class="align-items-baseline flex form-stats-likes">
							<div class="form-title-edit"></div>
							<div class="form-print"></div>
							<span class="liked-by like-action d-flex align-items-center">
								<svg class="icon icon-sm like-icon pointer">
									<use href="#icon-heart"></use>
								</svg>
							</span>
						</div>
					</div>
				</div>

				<!-- feedback rating (hidden by default) -->
				<div class="sidebar-section sidebar-rating hide border-bottom">
					<div style="position: relative">
						<a class="strong badge-hover"
							><span>{{ __('Feedback') }}</span></a
						>
					</div>
					<div class="rating-icons"></div>
				</div>

				<!-- help (hidden by default) -->
				<div class="sidebar-section hidden border-bottom"></div>

				<!-- user actions / links (hidden until populated) -->
				<div class="sidebar-section user-actions hidden border-bottom">
					<div class="form-sidebar-items user-actions-header">
						<div class="form-sidebar-label" v-html="iconLink"></div>
					</div>
					<div class="user-actions-list"></div>
				</div>

				<!-- assignments -->
				<div class="sidebar-section form-assignments">
					<div>
						<span class="form-sidebar-items">
							<span
								class="add-assignment-label form-sidebar-label"
								v-html="iconAssign"
							></span>
							<button class="add-assignment-btn btn btn-link icon-btn">
								<svg class="es-icon icon-sm"><use href="#es-line-add"></use></svg>
							</button>
						</span>
						<div class="assignments"></div>
					</div>
				</div>

				<!-- attachments -->
				<div class="sidebar-section form-attachments">
					<div class="attachments-actions">
						<span class="form-sidebar-items">
							<span>
								<a
									class="pill-label ellipsis form-sidebar-label explore-link"
									v-html="iconAttach"
								></a>
							</span>
							<button class="add-attachment-btn btn btn-link icon-btn">
								<svg class="es-icon icon-sm"><use href="#es-line-add"></use></svg>
							</button>
						</span>
					</div>
					<a class="show-all-btn hidden" href="">
						<span class="pill-label ellipsis">{{ __('Show All') }}</span>
					</a>
				</div>

				<!-- tags -->
				<div class="sidebar-section form-tags">
					<div>
						<span class="form-sidebar-items">
							<div class="form-sidebar-label" v-html="iconTag"></div>
						</span>
					</div>
				</div>

				<!-- shared -->
				<div class="sidebar-section form-shared border-bottom">
					<div>
						<span class="form-sidebar-items">
							<span class="share-label form-sidebar-label" v-html="iconShare"></span>
							<button class="share-doc-btn btn btn-link icon-btn">
								<svg class="es-icon icon-sm"><use href="#es-line-add"></use></svg>
							</button>
						</span>
						<div class="shares"></div>
					</div>
				</div>

				<!-- followed by (wired elsewhere; inert chrome for now) -->
				<div class="sidebar-section followed-by-section hidden">
					<div class="sidebar-label followed-by-label">{{ __('Followed by') }}</div>
					<div class="followed-by"></div>
					<div class="document-follow">
						<a class="badge-hover follow-document-link hidden">{{ __('Follow') }}</a>
						<a class="badge-hover unfollow-document-link hidden">{{
							__('Unfollow')
						}}</a>
					</div>
				</div>

				<!-- auto repeat status -->
				<div class="sidebar-section hidden">
					<a><li class="indicator blue auto-repeat-status" style="display: none"></li></a>
				</div>

				<!-- created / modified / pageviews -->
				<div class="sidebar-section text-muted pt-3">
					<ul class="list-unstyled sidebar-menu text-muted">
						<li class="modified-by"></li>
						<li class="created-by"></li>
						<li class="pageview-count"></li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>
