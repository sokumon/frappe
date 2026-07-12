<script setup lang="ts">
// Vue-native form (document-metadata) sidebar — the rebuild of the legacy
// jQuery `frappe.ui.form.Sidebar` + its widgets (form/sidebar/*.js). Rendering is
// owned here; the DATA + actions live on the script-compat facades installed on the
// frm (`frm.attachments/assign_to/shared/tags/sidebar`, see form/sidebarFacades.ts).
//
// Everything renders from `frm.get_docinfo()` (assignments/attachments/shared/tags/
// views) and `frm.doc` (image field, _liked_by). Those are PLAIN objects the facades
// mutate in place, so we re-derive on a reactive version bump (sidebarStore) that the
// facades — and this component's `docinfo_update` realtime handler — raise.
//
// Widgets: user image, editable title/name, assignments, attachments, tags
// (Vue-native <FormTags>), shared, likes, follow, created/modified/views.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Avatar, Button, Tooltip } from 'frappe-ui'
import { sidebarVersion, bumpSidebar } from '@/form/sidebarStore'
import FormTags from '@/components/FormTags.vue'
import LucidePaperclip from '~icons/lucide/paperclip'
import LucideUsers from '~icons/lucide/users'
import LucideShare2 from '~icons/lucide/share-2'
import LucideHeart from '~icons/lucide/heart'
import LucidePlus from '~icons/lucide/plus'
import LucideX from '~icons/lucide/x'
import LucideCamera from '~icons/lucide/camera'
import LucidePencil from '~icons/lucide/pencil'
import LucideLock from '~icons/lucide/lock'
import LucideLockOpen from '~icons/lucide/lock-open'
import LucideExternalLink from '~icons/lucide/external-link'

declare const frappe: any
const __ = (window as any).__ || ((s: string, _a?: any[]) => s)
const cint = (window as any).cint || ((v: any) => parseInt(v) || 0)
const comment_when = (window as any).comment_when || ((s: string) => s)

const props = defineProps<{ frm: any }>()

// Reactive version for this document; every data computed reads it so it re-derives
// from the (mutated-in-place) docinfo / doc whenever a facade bumps.
const version = computed(() => sidebarVersion(props.frm?.doctype, props.frm?.docname))

function docinfo(): any {
	try {
		return props.frm?.get_docinfo?.() || {}
	} catch {
		return {}
	}
}
const isLocal = computed(() => {
	version.value
	return !props.frm?.doc || !!props.frm.doc.__islocal
})
const userInfo = (user: string) => frappe.user_info?.(user) || { fullname: user, image: '' }
const fullName = (user: string) => userInfo(user).fullname || user

// --- title / name -----------------------------------------------------------
const title = computed(() => {
	version.value
	return props.frm?.doc ? props.frm.get_title?.() ?? '' : ''
})
const docName = computed(() => {
	version.value
	return props.frm?.doc?.name ?? ''
})
const showName = computed(() => title.value && title.value !== docName.value)
const isBeta = computed(() => !!props.frm?.meta?.beta)
const canRename = computed(() => {
	version.value
	const frm = props.frm
	if (!frm?.doc || isLocal.value) return false
	return (
		!!frm.meta?.allow_rename &&
		frappe.model.can_write(frm.doctype, frm.docname) &&
		!frm.meta?.issingle
	)
})
function renameDoc() {
	props.frm?.rename_doc?.()
}

// --- image ------------------------------------------------------------------
const imageField = computed(() => props.frm?.meta?.image_field || '')
const imageUrl = computed(() => {
	version.value
	return imageField.value ? props.frm?.doc?.[imageField.value] || '' : ''
})
const canEditImage = computed(() => {
	version.value
	const frm = props.frm
	if (!frm?.doc || isLocal.value || !imageField.value) return false
	const df = frm.fields_dict?.[imageField.value]?.df
	return frappe.model.can_write(frm.doctype, frm.docname) && !df?.read_only
})
function uploadImage() {
	if (!canEditImage.value) return
	new frappe.ui.FileUploader({
		doctype: props.frm.doctype,
		docname: props.frm.docname,
		frm: props.frm,
		folder: 'Home/Attachments',
		restrictions: { allowed_file_types: ['image/*'] },
		make_attachments_public: props.frm.meta.make_attachments_public,
		on_success: (file_doc: any) => {
			props.frm.set_value(imageField.value, file_doc.file_url).then(() => props.frm.save())
		},
	})
}
function removeImage() {
	const frm = props.frm
	frm.attachments.remove_attachment_by_filename(frm.doc[imageField.value], () => {
		frm.set_value(imageField.value, '').then(() => frm.save())
	})
}

// --- assignments ------------------------------------------------------------
const assignments = computed<any[]>(() => {
	version.value
	return docinfo().assignments || []
})
const assignedUsers = computed(() => assignments.value.map((a) => a.owner))
const canAssignRemove = (owner: string) =>
	owner === frappe.session.user || !!props.frm?.perm?.[0]?.write
function addAssignment() {
	props.frm.assign_to.add()
}
function removeAssignment(owner: string) {
	props.frm.assign_to.remove(owner)
}

// --- attachments ------------------------------------------------------------
const showAllAttachments = ref(false)
const ATTACH_PAGE_LENGTH = 10
const attachments = computed<any[]>(() => {
	version.value
	return docinfo().attachments || []
})
// last N (most recent are appended last) unless "show all"; de-dupe by file_name.
const visibleAttachments = computed(() => {
	let list = attachments.value
	if (!showAllAttachments.value && list.length > ATTACH_PAGE_LENGTH) {
		list = list.slice(list.length - ATTACH_PAGE_LENGTH)
	}
	const seen: Record<string, boolean> = {}
	return list.filter((a) => (seen[a.file_name] ? false : (seen[a.file_name] = true)))
})
const hasMoreAttachments = computed(
	() => !showAllAttachments.value && attachments.value.length > ATTACH_PAGE_LENGTH
)
const canAddAttachment = computed(() => {
	version.value
	return !props.frm.attachments.max_reached()
})
const canDeleteAttachment = computed(() => {
	version.value
	return props.frm.attachments.can_delete_attachment()
})
function fileUrl(a: any) {
	return props.frm.attachments.get_file_url(a)
}
function addAttachment() {
	props.frm.attachments.new_attachment()
}
function removeAttachment(a: any) {
	frappe.confirm(__('Are you sure you want to delete the attachment?'), () => {
		// remove every attachment row sharing this file (legacy behaviour)
		const same = props.frm.attachments
			.get_attachments()
			.filter((x: any) => x.file_name === a.file_name)
		same.forEach((x: any) => props.frm.attachments.remove_attachment(x.name))
	})
}
function exploreAttachments() {
	if (!attachments.value.length) return
	frappe.open_in_new_tab = true
	frappe.set_route('List', 'File', {
		attached_to_doctype: props.frm.doctype,
		attached_to_name: props.frm.docname,
	})
}

// --- shared -----------------------------------------------------------------
const shared = computed<any[]>(() => {
	version.value
	return docinfo().shared || []
})
const sharedUsers = computed(() =>
	shared.value.filter((s) => s && s.user && !s.everyone).map((s) => s.user)
)
const sharedEveryone = computed(() => shared.value.some((s) => s && s.everyone))
function openShare() {
	props.frm.share_doc()
}

// --- likes ------------------------------------------------------------------
const liked = computed(() => {
	version.value
	return props.frm?.doc ? frappe.ui.is_liked(props.frm.doc) : false
})
const likeCount = computed(() => {
	version.value
	return props.frm?.doc ? frappe.ui.get_liked_by(props.frm.doc).length : 0
})
function toggleLike() {
	const frm = props.frm
	const add = liked.value ? 'No' : 'Yes'
	frappe.call({
		method: 'frappe.desk.like.toggle_like',
		quiet: true,
		args: { doctype: frm.doctype, name: frm.doc.name, add },
		callback: (r: any) => {
			if (r.exc) return
			// mirror like.js: keep _liked_by in sync on the local doc, then re-render.
			let likedBy = frappe.ui.get_liked_by(frm.doc)
			if (add === 'Yes' && !likedBy.includes(frappe.session.user))
				likedBy.push(frappe.session.user)
			if (add === 'No') likedBy = likedBy.filter((u: string) => u !== frappe.session.user)
			frm.doc._liked_by = JSON.stringify(likedBy)
			bumpSidebar(frm.doctype, frm.docname)
		},
	})
}

// --- follow -----------------------------------------------------------------
const followEnabled = computed(() => {
	const frm = props.frm
	if (!frm?.doc || isLocal.value) return false
	if (frappe.session.user === 'Administrator') return false
	if (!frappe.boot.user.document_follow_notify) return false
	return !!frappe.get_meta(frm.doctype)?.track_changes
})
const isFollowing = computed(() => {
	version.value
	return followEnabled.value && cint(docinfo().is_document_followed) > 0
})
function followDocument() {
	const frm = props.frm
	frappe.call({
		method: 'frappe.desk.form.document_follow.follow_document',
		args: {
			doctype: frm.doctype,
			doc_name: frm.doc.name,
			user: frappe.session.user,
			force: true,
		},
		callback: (r: any) => {
			if (!r.message) return
			frappe.show_alert({
				message: __(
					'You are now following this document. You will receive daily updates via email. You can change this in User Settings.'
				),
				indicator: 'orange',
			})
			frm.sidebar.reload_docinfo()
		},
	})
}
function unfollowDocument() {
	const frm = props.frm
	frappe.call({
		method: 'frappe.desk.form.document_follow.unfollow_document',
		args: { doctype: frm.doctype, doc_name: frm.doc.name, user: frappe.session.user },
		callback: (r: any) => {
			if (!r.message) return
			frm.sidebar.reload_docinfo()
		},
	})
}

// --- created / modified / views ---------------------------------------------
const showAbsolute = computed(
	() =>
		cint(frappe.boot.user.show_absolute_datetime_in_timeline) ||
		cint(frappe.boot.sysdefaults?.show_absolute_datetime_in_timeline)
)
function when(ts?: string) {
	if (!ts) return ''
	return showAbsolute.value ? frappe.datetime.str_to_user(ts) : comment_when(ts)
}
const createdBy = computed(() => {
	version.value
	return props.frm?.doc?.owner
})
const modifiedBy = computed(() => {
	version.value
	return props.frm?.doc?.modified_by
})
const createdWhen = computed(() => when(props.frm?.doc?.creation))
const modifiedWhen = computed(() => when(props.frm?.doc?.modified))
const viewCount = computed(() => {
	version.value
	return (docinfo().views || []).length
})
const trackViews = computed(() => !!props.frm?.meta?.track_views)

function ownerLabel(user: string) {
	return user === frappe.session.user ? __('You') : fullName(user)
}

// --- user actions (frm.sidebar.add_user_action) -----------------------------
// Return a FRESH array on every bump: the facade pushes/clears `user_actions` in
// place on a plain (non-reactive) object, so a stable-reference read would let Vue's
// computed value-comparison skip the re-render (the block is populated after mount by
// the script `refresh`). A new array each time guarantees the links repaint.
const userActions = computed<any[]>(() => {
	version.value
	return [...(props.frm?.sidebar?.user_actions || [])]
})
function onUserAction(action: any, e: MouseEvent) {
	// `href` (if any) navigates natively; run the optional click handler too.
	if (action.click) action.click(e)
}

// --- tags ------------------------------------------------------------------
// The tags UI is the Vue-native <FormTags> (below); it reads/edits docinfo.tags.
const showTags = computed(() => !props.frm?.meta?.issingle && !isLocal.value)

// --- realtime: keep sidebar docinfo live (port of form.js docinfo_update) ----
function onDocinfoUpdate({ doc, key, action = 'update' }: any) {
	const frm = props.frm
	if (
		!frm?.doc ||
		!doc?.reference_doctype ||
		doc.reference_doctype !== frm.doctype ||
		doc.reference_name !== frm.docname
	)
		return
	const info = frappe.model.docinfo?.[frm.doctype]?.[frm.docname]
	if (!info) return
	const list = info[key] || (info[key] = [])
	const idx = list.findIndex((d: any) => d.name === doc.name)
	if (action === 'add' && idx === -1) list.push(doc)
	if (idx > -1 && action === 'update') list.splice(idx, 1, doc)
	if (idx > -1 && action === 'delete') list.splice(idx, 1)
	bumpSidebar(frm.doctype, frm.docname)
}

onMounted(() => {
	frappe.realtime?.on?.('docinfo_update', onDocinfoUpdate)
	if (props.frm?.doc) bumpSidebar(props.frm.doctype, props.frm.docname)
})
onBeforeUnmount(() => {
	frappe.realtime?.off?.('docinfo_update', onDocinfoUpdate)
})

// Doc-to-doc navigation keeps this component mounted (Form.vue doesn't key it) and
// the frm's `docname` is a plain, non-reactive property — but every refresh bumps
// `version`, so watch that and react when the document actually changed. The tags
// facade is re-pointed by the sidebar coordinator's refresh(); here we just reset the
// per-document "show all attachments" toggle.
let lastDocname = props.frm?.docname
watch(version, () => {
	if (props.frm?.docname !== lastDocname) {
		lastDocname = props.frm?.docname
		showAllAttachments.value = false
	}
})
</script>

<template>
	<div v-if="frm" class="form-sidebar flex flex-col gap-4 p-4 text-sm">
		<!-- image -->
		<div v-if="imageField" class="flex flex-col items-center gap-2">
			<div class="group relative">
				<Avatar :image="imageUrl" :label="title" size="3xl" shape="square" />
				<button
					v-if="canEditImage"
					type="button"
					class="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 transition group-hover:opacity-100"
					:title="__('Change Image')"
					@click="uploadImage"
				>
					<LucideCamera class="h-5 w-5 text-white" />
				</button>
				<button
					v-if="canEditImage && imageUrl"
					type="button"
					class="absolute -right-1.5 -top-1.5 hidden rounded-full bg-surface-white p-0.5 shadow ring-1 ring-outline-gray-2 group-hover:block"
					:title="__('Remove Image')"
					@click.stop="removeImage"
				>
					<LucideX class="h-3.5 w-3.5 text-ink-gray-6" />
				</button>
			</div>
		</div>

		<!-- title / name / likes / rename -->
		<div class="flex items-start justify-between gap-2 border-b border-outline-gray-1 pb-4">
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<span class="truncate font-medium text-ink-gray-9" :title="title">{{
						title
					}}</span>
					<button
						v-if="canRename"
						type="button"
						class="shrink-0 text-ink-gray-5 hover:text-ink-gray-8"
						:title="__('Rename')"
						@click="renameDoc"
					>
						<LucidePencil class="h-3.5 w-3.5" />
					</button>
				</div>
				<div
					v-if="showName"
					class="mt-0.5 truncate text-xs text-ink-gray-5"
					:title="docName"
				>
					{{ docName }}
				</div>
				<span
					v-if="isBeta"
					class="mt-1 inline-block rounded bg-surface-amber-2 px-1.5 py-0.5 text-xs text-ink-amber-6"
					:title="__('This feature is brand new and still experimental')"
					>{{ __('Experimental') }}</span
				>
			</div>
			<button
				v-if="!isLocal"
				type="button"
				class="shrink-0"
				:title="likeCount ? __('{0} likes', [likeCount]) : __('Like')"
				@click="toggleLike"
			>
				<LucideHeart
					class="h-4 w-4"
					:class="liked ? 'fill-current text-ink-red-5' : 'text-ink-gray-5'"
				/>
			</button>
		</div>

		<template v-if="!isLocal">
			<!-- user actions (frm.sidebar.add_user_action): a script-added link, e.g.
				 workspace.js "Go to Workspace" (href + target) or erpnext "See on
				 Website" (click). `href` navigates natively; `click` runs on top. -->
			<div v-if="userActions.length" class="flex flex-col gap-1">
				<a
					v-for="(action, i) in userActions"
					:key="i"
					:href="action.href || undefined"
					:target="action.target || undefined"
					class="flex cursor-pointer items-center gap-1 text-ink-gray-7 hover:text-ink-gray-9"
					@click="onUserAction(action, $event)"
				>
					<span v-if="action.html" v-html="action.html" />
					<span v-else>{{ action.label }}</span>
					<LucideExternalLink class="h-3 w-3" />
				</a>
			</div>

			<!-- assignments -->
			<section class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5 text-ink-gray-6">
						<LucideUsers class="h-3.5 w-3.5" />
						<span class="text-xs font-medium tracking-wide">{{
							__('Assigned To')
						}}</span>
					</div>
					<Button variant="ghost" size="sm" @click="addAssignment">
						<template #icon><LucidePlus class="h-4 w-4" /></template>
					</Button>
				</div>
				<div v-if="assignedUsers.length" class="flex flex-wrap gap-1.5">
					<div v-for="user in assignedUsers" :key="user" class="group relative">
						<Tooltip :text="fullName(user)">
							<Avatar
								:image="userInfo(user).image"
								:label="fullName(user)"
								size="md"
							/>
						</Tooltip>
						<button
							v-if="canAssignRemove(user)"
							type="button"
							class="absolute -right-1 -top-1 hidden rounded-full bg-surface-white p-px shadow ring-1 ring-outline-gray-2 group-hover:block"
							:title="__('Remove')"
							@click="removeAssignment(user)"
						>
							<LucideX class="h-3 w-3 text-ink-gray-6" />
						</button>
					</div>
				</div>
			</section>

			<!-- attachments -->
			<section class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<a
						role="button"
						class="flex items-center gap-1.5 text-ink-gray-6 hover:text-ink-gray-8"
						@click="exploreAttachments"
					>
						<LucidePaperclip class="h-3.5 w-3.5" />
						<span class="text-xs font-medium tracking-wide">{{
							__('Attachments')
						}}</span>
					</a>
					<Button
						v-if="canAddAttachment"
						variant="ghost"
						size="sm"
						@click="addAttachment"
					>
						<template #icon><LucidePlus class="h-4 w-4" /></template>
					</Button>
				</div>
				<div v-if="visibleAttachments.length" class="flex flex-col gap-1">
					<div
						v-for="a in visibleAttachments"
						:key="a.name"
						class="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-surface-gray-2"
					>
						<component
							:is="a.is_private ? LucideLock : LucideLockOpen"
							class="h-3.5 w-3.5 shrink-0 text-ink-gray-5"
						/>
						<a
							:href="fileUrl(a)"
							target="_blank"
							class="min-w-0 flex-1 truncate text-ink-gray-7 hover:text-ink-gray-9"
							:title="a.file_name"
							>{{ a.file_name }}</a
						>
						<button
							v-if="canDeleteAttachment"
							type="button"
							class="hidden shrink-0 text-ink-gray-5 hover:text-ink-red-5 group-hover:block"
							:title="__('Remove')"
							@click="removeAttachment(a)"
						>
							<LucideX class="h-3.5 w-3.5" />
						</button>
					</div>
					<a
						v-if="hasMoreAttachments"
						role="button"
						class="px-1.5 text-xs text-ink-gray-5 hover:text-ink-gray-8"
						@click="showAllAttachments = true"
						>{{ __('Show All') }}</a
					>
				</div>
			</section>

			<!-- tags (Vue-native editor) -->
			<FormTags v-if="showTags" :frm="frm" />

			<!-- shared -->
			<section class="flex flex-col gap-2 border-b border-outline-gray-1 pb-4">
				<div class="flex items-center justify-between">
					<a
						role="button"
						class="flex items-center gap-1.5 text-ink-gray-6 hover:text-ink-gray-8"
						@click="openShare"
					>
						<LucideShare2 class="h-3.5 w-3.5" />
						<span class="text-xs font-medium tracking-wide">{{
							__('Shared With')
						}}</span>
					</a>
					<Button variant="ghost" size="sm" @click="openShare">
						<template #icon><LucidePlus class="h-4 w-4" /></template>
					</Button>
				</div>
				<div v-if="sharedUsers.length || sharedEveryone" class="flex flex-wrap gap-1.5">
					<Tooltip v-if="sharedEveryone" :text="__('Everyone')">
						<Avatar :label="__('Everyone')" size="md" />
					</Tooltip>
					<Tooltip v-for="user in sharedUsers" :key="user" :text="fullName(user)">
						<Avatar :image="userInfo(user).image" :label="fullName(user)" size="md" />
					</Tooltip>
				</div>
			</section>

			<!-- follow -->
			<section v-if="followEnabled" class="flex items-center justify-between">
				<span class="text-xs font-medium uppercase tracking-wide text-ink-gray-6">{{
					__('Follow')
				}}</span>
				<Button
					variant="ghost"
					size="sm"
					:label="isFollowing ? __('Unfollow') : __('Follow')"
					@click="isFollowing ? unfollowDocument() : followDocument()"
				/>
			</section>

			<!-- created / modified / views -->
			<section class="flex flex-col gap-1 text-xs text-ink-gray-5">
				<div v-if="modifiedBy">
					{{ __('Last edited by {0}', [ownerLabel(modifiedBy)]) }} · {{ modifiedWhen }}
				</div>
				<div v-if="createdBy">
					{{ __('Created by {0}', [ownerLabel(createdBy)]) }} · {{ createdWhen }}
				</div>
				<div v-if="trackViews && viewCount">{{ __('{0} views', [viewCount]) }}</div>
			</section>
		</template>
	</div>
</template>
