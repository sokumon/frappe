<script setup lang="ts">
// FormTimeline — the document activity feed for the Vue form, rendered by
// @framework/ui's <ActivityTimeline> + useActivityTimeline (backend:
// frappe.desk.form.activity), aiming for parity with the legacy
// frappe/public/js/frappe/form/footer/form_timeline.js + base_timeline.js.
//
// The composable owns the feed (emails, comments, likes, assignments,
// attachments, workflow, info logs, folded versions) + realtime + email paging.
// This component adds the legacy PARITY layer:
//   - actions the legacy timeline wired: reply/reply-all + compose (New Email),
//     New Event, comment edit/delete/publish, the "show all activity" toggle,
//     and the document-email link;
//   - the activity rows the new backend doesn't emit — views, shares, milestones,
//     custom (additional_timeline_content) and web-page-view count — backfilled
//     from frm.get_docinfo() as `legacy_log` custom rows merged into the feed.
//
// Interactions reuse the legacy desk globals (frappe.views.CommunicationComposer /
// InteractionComposer, frappe.desk.form.utils.*), so behaviour matches the old
// footer exactly.
import { computed, markRaw, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { Button, Switch, Dropdown } from 'frappe-ui'
import { ActivityTimeline, EmailItem, CommentItem, useActivityTimeline } from '@framework/ui'
import type { CustomActivity } from '@framework/ui'
// Gutter icons for the backfilled rows, as components: GutterIcon renders a
// component `activity.icon` directly, whereas a `lucide-*` string only renders if
// it's one of the ui's curated LUCIDE_ICON_CLASS keys (ours aren't).
import LucideEye from '~icons/lucide/eye'
import LucideShare2 from '~icons/lucide/share-2'
import LucideMilestone from '~icons/lucide/milestone'
import LucidePencil from '~icons/lucide/pencil'
import LucideInfo from '~icons/lucide/info'

const props = defineProps<{ frm: any }>()

const __ = (window as any).__ || ((s: string, args?: any[]) => (args ? s : s))
const doctype: string = props.frm.doctype
const docname: string = props.frm.docname

// Feed + realtime + email pagination (cached per doctype:docname; this component
// is keyed by name in Form.vue, so it reconstructs per document).
const { activities, loading: activityLoading, reload } = useActivityTimeline(doctype, docname)
// Re-wrap in a host-Vue computed: the composable's refs come from @framework/ui's
// Vue instance, which the template type-checker won't auto-unwrap (dual Vue types).
const loading = computed(() => activityLoading.value)
// Pagination is intentionally NOT passed to <ActivityTimeline>: the form feed
// flows in the page (not a fixed-height chat panel), and the paginate-gated
// scroll-to-bottom-on-open (useTimelineScroll) would scroll the whole form down to
// the timeline on open. Opting out keeps the page at the top; the feed shows the
// loaded activity without a Load More control.

// "Show all activity" vs communications-only (legacy `only_communication`).
const onlyCommunication = ref(false)
// Which comment row is in inline-edit mode (keyed by activity.key).
const editingKey = ref<string | null>(null)

// --- docinfo helpers --------------------------------------------------------
function docinfo(): any {
	// get_docinfo() does frappe.model.docinfo[doctype][docname] unguarded, so it
	// throws before docinfo is loaded — treat "not ready" as an empty feed.
	try {
		return props.frm?.get_docinfo?.() || {}
	} catch {
		return {}
	}
}
function userInfo(user: string) {
	const info = frappe.user_info?.(user) || {}
	return { email: user, fullname: info.fullname || user, image: info.image }
}
function fullname(user: string): string {
	return frappe.utils.escape_html(frappe.user_info?.(user)?.fullname || user || '')
}
function bold(v: any): string {
	return `<b>${frappe.utils.escape_html(v == null ? '' : String(v))}</b>`
}
function commentWhen(ts?: string): string {
	if (!ts) return ''
	// prettyDate -> plain "10 minutes ago"; comment_when would return a
	// `<span class="frappe-timestamp">` HTML wrapper (we render this as text).
	return frappe.datetime?.prettyDate?.(ts) || ''
}

// --- Backfill: legacy rows the new backend doesn't emit ---------------------
const backfillRows = ref<CustomActivity[]>([])
function legacyLog(
	key: string,
	timestamp: string,
	html: string,
	icon: Component,
	owner?: string
): CustomActivity {
	return {
		type: 'legacy_log',
		key,
		timestamp,
		// cast: markRaw returns @framework/ui's Vue `Component` type, a distinct
		// instance from the host's — assignable at runtime, not to the TS checker.
		icon: markRaw(icon) as any,
		author: owner ? userInfo(owner) : undefined,
		data: { html },
	}
}
// The `#item-legacy_log` slot's `activity.data` is typed `unknown` (CustomActivity),
// so read the html through a helper.
function logHtml(activity: any): string {
	return activity?.data?.html ?? ''
}
function computeBackfill() {
	const info = docinfo()
	const frm = props.frm
	const rows: CustomActivity[] = []

	for (const v of info.views || []) {
		rows.push(
			legacyLog(
				`view:${v.name}`,
				v.creation,
				__('{0} viewed this', [fullname(v.owner)]),
				LucideEye,
				v.owner
			)
		)
	}
	// share_logs carry pre-rendered HTML content (legacy renders it verbatim).
	for (const s of info.share_logs || []) {
		rows.push(legacyLog(`share:${s.name || s.creation}`, s.creation, s.content, LucideShare2))
	}
	for (const m of info.milestones || []) {
		const field = frappe.meta.get_label(frm.doctype, m.track_field)
		rows.push(
			legacyLog(
				`milestone:${m.name}`,
				m.creation,
				__('{0} changed {1} to {2}', [fullname(m.owner), field, bold(m.value)]),
				LucideMilestone,
				m.owner
			)
		)
	}
	// additional_timeline_content: app-injected rows (content or a template).
	;(info.additional_timeline_content || []).forEach((c: any, i: number) => {
		let html = c.content
		if (!html && c.template) {
			try {
				html = frappe.render_template(c.template, c.template_data)
			} catch (e) {
				html = ''
			}
		}
		rows.push(legacyLog(`custom:${i}:${c.creation || ''}`, c.creation, html || '', LucideInfo))
	})
	// "last edited this" (the backend emits creation, not modified).
	if (frm.doc?.modified) {
		rows.push(
			legacyLog(
				'modified',
				frm.doc.modified,
				__('{0} last edited this', [fullname(frm.doc.modified_by)]),
				LucidePencil,
				frm.doc.modified_by
			)
		)
	}
	backfillRows.value = rows

	// Web page views (async), when website tracking is on and the doc has a route.
	if (frm.doc?.route && Number(frappe.boot?.website_tracking_enabled)) {
		frappe.utils.get_page_view_count?.(frm.doc.route).then((res: any) => {
			backfillRows.value = [
				...backfillRows.value,
				legacyLog(
					'web_views',
					frm.doc.modified,
					__('{0} Web page views', [res.message]),
					LucideEye
				),
			]
		})
	}
}

// Merge backfill into the feed and order newest-first (most recent action on top,
// matching the legacy desk timeline).
const feed = computed(() =>
	[...activities.value, ...backfillRows.value].sort((a, b) =>
		(b.timestamp ?? '').localeCompare(a.timestamp ?? '')
	)
)
// Communications-only view hides everything but emails + comments (legacy toggle).
const displayFeed = computed(() =>
	onlyCommunication.value
		? feed.value.filter((a) => a.type === 'email' || a.type === 'comment')
		: feed.value
)

// --- Header state -----------------------------------------------------------
const hasCommunications = computed(() => {
	const info = docinfo()
	return Boolean(info.communications?.length || info.comments?.length)
})
const canEmail = computed(() => {
	try {
		return !!frappe.model.can_email(null, props.frm)
	} catch {
		return false
	}
})
const allowEvents = computed(() => !!props.frm?.meta?.allow_events_in_timeline)
const documentEmail = computed(() => docinfo().document_email)
const documentEmailMessage = computed(() =>
	documentEmail.value
		? __('Add to this activity by mailing to {0}', [
				`<a class="document-email-link font-medium underline" role="button">${documentEmail.value}</a>`,
		  ])
		: ''
)
function onDocEmailClick(e: MouseEvent) {
	const target = e.target as HTMLElement
	if (target.classList.contains('document-email-link')) {
		frappe.utils.copy_to_clipboard(target.textContent || '')
	}
}

// --- Email actions (reply / reply-all / compose) ----------------------------
function getRecipient(): string {
	const frm = props.frm
	if (frm.email_field) return frm.doc[frm.email_field]
	return frm.doc.email_id || frm.doc.email || ''
}
// Reconstruct a Communication-like doc from the email activity for the composer.
function commDoc(activity: any) {
	const d = activity?.data
	if (!d) return null
	return {
		name: d.name,
		sender: d.sender,
		subject: d.subject,
		recipients: d.to,
		cc: d.cc,
		bcc: d.bcc,
		content: d.content,
	}
}
function composeMail(activity: any = null, replyAll = false) {
	const frm = props.frm
	const last = commDoc(activity)
	const stripHtml = (window as any).strip_html || ((s: string) => s)
	const cstr = (window as any).cstr || ((s: any) => (s == null ? '' : String(s)))

	const args: any = {
		doc: frm.doc,
		frm,
		recipients: last && last.sender != frappe.session.user_email ? last.sender : getRecipient(),
		is_a_reply: Boolean(last),
		title: last ? __('Reply') : null,
		last_email: last,
		subject: last && last.subject,
		reply_all: replyAll,
		sender: last?.sender,
	}

	const emailAccounts = (frappe.boot.email_accounts || [])
		.filter(
			(a: any) =>
				!['All Accounts', 'Sent', 'Spam', 'Trash'].includes(a.email_account) &&
				a.enable_outgoing
		)
		.map((e: any) => e.email_id)

	if (last && args.is_a_reply) {
		args.cc = ''
		if (
			emailAccounts.includes(frappe.session.user_email) &&
			last.sender != frappe.session.user_email &&
			last.recipients
		) {
			const recipients = last.recipients.split(',').map((r: string) => r.trim())
			args.cc =
				recipients.filter((r: string) => r != frappe.session.user_email).join(', ') + ', '
		}
		if (replyAll) {
			args.cc += cstr(last.cc)
			args.bcc = cstr(last.bcc)
		}
	}

	if (frm.doctype === 'Communication') {
		args.message = ''
		args.last_email = frm.doc
		args.recipients = frm.doc.sender
		args.subject = __('Re: {0}', [frm.doc.subject])
	} else {
		const commentValue = frappe.markdown(frm.comment_box?.get_value?.() || '')
		args.message = stripHtml(commentValue) ? commentValue : ''
	}

	new frappe.views.CommunicationComposer(args)
}

function newEvent() {
	const frm = props.frm
	new frappe.views.InteractionComposer({
		doc: frm.doc,
		frm,
		recipients: getRecipient(),
		txt: frappe.markdown(frm.comment_box?.get_value?.() || ''),
	})
}

// --- Comment actions (edit / delete / publish) ------------------------------
function docinfoComment(name: string): any {
	return (docinfo().comments || []).find((c: any) => c.name === name)
}
function canManageComment(activity: any): boolean {
	return frappe.session.user === activity.author?.email || frappe.user.has_role('System Manager')
}
function saveComment(activity: any, content: string) {
	frappe
		.xcall('frappe.desk.form.utils.update_comment', { name: activity.data.name, content })
		.then(() => {
			frappe.utils.play_sound?.('click')
			editingKey.value = null
			reload()
			computeBackfill()
		})
}
function deleteComment(activity: any) {
	frappe.confirm(__('Delete comment?'), () => {
		frappe
			.xcall('frappe.client.delete', { doctype: 'Comment', name: activity.data.name })
			.then(() => {
				frappe.utils.play_sound?.('delete')
				reload()
			})
	})
}
function publishComment(activity: any) {
	const current = docinfoComment(activity.data.name)
	const publish = !current?.published
	const message = publish
		? __(
				'Would you like to publish this comment? This means it will become visible to website/portal users.'
		  )
		: __(
				'Would you like to unpublish this comment? This means it will no longer be visible to website/portal users.'
		  )
	frappe.confirm(message, () => {
		frappe
			.xcall('frappe.desk.form.utils.update_comment_publicity', {
				name: activity.data.name,
				publish,
			})
			.then(() => {
				frappe.utils.play_sound?.('click')
				reload()
			})
	})
}
function commentMenu(activity: any) {
	const items: any[] = []
	if (frappe.model.can_delete('Comment')) {
		items.push({ label: __('Delete'), onClick: () => deleteComment(activity) })
	}
	items.push({
		label: docinfoComment(activity.data.name)?.published ? __('Unpublish') : __('Publish'),
		onClick: () => publishComment(activity),
	})
	return items
}

onMounted(computeBackfill)
// Recompute the backfill when the live feed changes (a realtime update or reload
// usually means docinfo — views/shares/etc. — changed too).
watch(activities, computeBackfill)
</script>

<template>
	<div class="form-timeline flex flex-col gap-3">
		<!-- Header: Activity title, "show all activity" toggle, New Email / Event. -->
		<div class="flex items-center justify-between gap-3">
			<h4 class="text-lg font-semibold text-ink-gray-9">{{ __('Activity') }}</h4>
			<div class="flex items-center gap-3">
				<label
					v-if="hasCommunications"
					class="flex items-center gap-2 text-sm text-ink-gray-6"
				>
					<span>{{ __('Show all activity') }}</span>
					<Switch
						:modelValue="!onlyCommunication"
						@update:modelValue="(v: boolean) => (onlyCommunication = !v)"
					/>
				</label>
				<Button
					v-if="canEmail"
					variant="subtle"
					icon-left="lucide-plus"
					:label="__('New Email')"
					@click="composeMail()"
				/>
				<Button
					v-if="allowEvents"
					variant="subtle"
					icon-left="lucide-calendar"
					:label="__('New Event')"
					@click="newEvent()"
				/>
			</div>
		</div>

		<!-- Document email link (mail-in to this activity). -->
		<div
			v-if="documentEmail"
			class="text-sm text-ink-gray-6"
			@click="onDocEmailClick"
			v-html="documentEmailMessage"
		/>

		<ActivityTimeline :activities="displayFeed" :loading="loading">
			<!-- Emails: reply / reply-all. -->
			<template #item-email="{ activity }">
				<EmailItem :email="activity">
					<template #actions>
						<Button
							variant="ghost"
							icon="lucide-reply"
							:tooltip="__('Reply')"
							@click="composeMail(activity, false)"
						/>
						<Button
							variant="ghost"
							icon="lucide-reply-all"
							:tooltip="__('Reply All')"
							@click="composeMail(activity, true)"
						/>
					</template>
				</EmailItem>
			</template>

			<!-- Comments: inline edit + delete / publish menu. -->
			<template #item-comment="{ activity }">
				<CommentItem
					:comment="activity"
					:editable="editingKey === activity.key"
					@save="(content: string) => saveComment(activity, content)"
					@discard="editingKey = null"
				>
					<template v-if="canManageComment(activity)" #actions>
						<Button
							variant="ghost"
							icon="lucide-pencil"
							:tooltip="__('Edit')"
							@click="editingKey = activity.key"
						/>
						<Dropdown :options="commentMenu(activity)">
							<Button variant="ghost" icon="lucide-more-horizontal" />
						</Dropdown>
					</template>
				</CommentItem>
			</template>

			<!-- Backfilled legacy rows (views / shares / milestones / custom / web views).
			     Mirrors LogItem's one-liner layout (ps-[13px] + leading-6 + right-aligned
			     time) so these align with the backend log rows in the same thread. -->
			<template #item-legacy_log="{ activity }">
				<div
					class="flex flex-1 items-center gap-1.5 ps-[13px] text-sm leading-6 text-ink-gray-6"
				>
					<span
						class="min-w-0 [&_b]:font-medium [&_b]:text-ink-gray-8"
						v-html="logHtml(activity)"
					/>
					<span class="ml-auto whitespace-nowrap text-sm text-ink-gray-5">
						{{ commentWhen(activity.timestamp) }}
					</span>
				</div>
			</template>
		</ActivityTimeline>
	</div>
</template>
