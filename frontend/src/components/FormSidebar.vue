<script setup lang="ts">
// The form (document-metadata) sidebar *template* for the Vue shell — a port of
// `form/templates/form_sidebar.html`, keeping the exact class names the legacy
// widgets bind to. The behaviour is owned by `frappe.ui.form.Sidebar` (created in
// form.js render_form): its make() finds this `.form-sidebar` inside page.sidebar
// and wires the dynamic widgets (assignments, attachments, share, tags, likes,
// user image, print, editable title) onto these nodes.
//
// So Vue owns the markup + the reactive document bits (title / name / image
// flags); the Sidebar class owns the stateful widgets. `tick` bumps on every
// form-refresh so the title/name computeds re-read the (plain-object) frm.doc.
import { computed, onMounted, onUnmounted, ref } from 'vue'

declare const frappe: any
const jq = (window as any).$ || (window as any).jQuery
const __ = (window as any).__ || ((s: string) => s)

const props = defineProps<{ frm: any }>()

const tick = ref(0)

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
	// Guard on frm.doc: get_title() -> frappe.model.get_doc_title(this.doc) reads
	// doc.name unguarded, so it throws while the doc is still loading (the async
	// with_doc fetch path renders the sidebar before renderDoc sets frm.doc).
	return props.frm?.doc ? props.frm.get_title?.() ?? '' : ''
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
	if (!frm?.doc) return false
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

// Re-read the doc-driven computeds on every refresh (frm.doc is a plain object).
function onFormRefresh(_e: any, frm: any) {
	if (frm === props.frm) tick.value++
}

onMounted(() => {
	jq(document).on('form-refresh.formsidebar', onFormRefresh)
	if (props.frm?.doc) tick.value++
})

onUnmounted(() => {
	jq(document).off('form-refresh.formsidebar', onFormRefresh)
})
</script>

<template>
	<div class="form-sidebar overlay-sidebar">
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
				<a class="badge-hover unfollow-document-link hidden">{{ __('Unfollow') }}</a>
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
</template>
