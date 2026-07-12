<script setup lang="ts">
// Vue-native tags editor for the form sidebar (replaces the legacy jQuery
// frappe.ui.TagEditor). Built on frappe-ui MultiSelect + Badge pills. Tags are
// free-form: the popover search hits `get_tags` for suggestions and offers a
// "Create …" entry for a brand-new tag. Add/remove call the tag endpoints and update
// the reactive `docinfo.tags` + `frm.doc._user_tags` in place, then bump the sidebar.
import { computed, ref } from 'vue'
import { Badge, MultiSelect } from 'frappe-ui'
import { bumpSidebar, sidebarVersion } from '@/form/sidebarStore'
import LucideX from '~icons/lucide/x'
import LucideChevronDown from '~icons/lucide/chevron-down'

declare const frappe: any
const __ = (window as any).__ || ((s: string, _a?: any[]) => s)

const props = defineProps<{ frm: any }>()

const version = computed(() => sidebarVersion(props.frm?.doctype, props.frm?.docname))

function docinfo(): any {
	try {
		return props.frm?.get_docinfo?.() || {}
	} catch {
		return {}
	}
}

// Source of truth: the doc's own `_user_tags` column (a standard field loaded with
// every doc, and what add_tag/remove_tag write). Prefer it over `docinfo.tags`:
// get_docinfo's get_tags is gated by a cached `has_tags(doctype)` that returns a
// stale `false` right after a doctype's first tag, yielding "" on reload — which the
// old `??` (only null/undefined) wouldn't fall through, so the tag vanished. `||`
// falls through an empty string.
const currentTags = computed<string[]>(() => {
	version.value
	const raw = props.frm?.doc?._user_tags || docinfo().tags || ''
	return String(raw)
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)
})

const canEdit = computed(() => {
	version.value
	const frm = props.frm
	return !!frm?.doc && frappe.model.can_write(frm.doctype, frm.docname)
})

// A stable-ish colour per tag so pills aren't all one shade.
const THEMES = ['gray', 'blue', 'green', 'orange', 'red'] as const
function themeFor(tag: string): typeof THEMES[number] {
	let h = 0
	for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
	return THEMES[h % THEMES.length]
}

// --- popover options: current tags + get_tags suggestions + a "create" entry ----
const query = ref('')
const fetched = ref<string[]>([])
const loading = ref(false)

const options = computed(() => {
	const seen = new Set<string>()
	const opts: any[] = []
	const push = (value: string, label?: string) => {
		if (seen.has(value)) return
		seen.add(value)
		opts.push({ label: label ?? value, value, theme: themeFor(value) })
	}
	currentTags.value.forEach((t) => push(t))
	fetched.value.forEach((t) => push(t))
	const q = query.value.trim()
	if (q && !seen.has(q)) opts.push({ label: __('Create "{0}"', [q]), value: q, theme: 'gray' })
	return opts
})

async function onQuery(q: string) {
	query.value = q
	loading.value = true
	try {
		const r = await frappe.xcall('frappe.desk.doctype.tag.tag.get_tags', {
			doctype: props.frm.doctype,
			txt: (q || '').trim().toLowerCase(),
		})
		fetched.value = (r || []).filter((t: string) => t)
	} finally {
		loading.value = false
	}
}

// Populate the dropdown with all existing system tags the first time it opens (an
// empty query returns every Tag), so users see options without having to type.
const openedOnce = ref(false)
function onOpen(open: unknown) {
	if (open && !openedOnce.value) {
		openedOnce.value = true
		onQuery('')
	}
}

function persist(list: string[]) {
	const value = list.join(',')
	const info = docinfo()
	if (info) info.tags = value
	if (props.frm?.doc) props.frm.doc._user_tags = value
	bumpSidebar(props.frm.doctype, props.frm.docname)
}

// Diff the incoming selection against the current tags, then add/remove via the
// endpoints. Optimistic: update local state first (so the pills react instantly),
// revert if a call fails.
async function applyChange(next: string[]) {
	const prev = currentTags.value
	const added = next.filter((t) => !prev.includes(t))
	const removed = prev.filter((t) => !next.includes(t))
	if (!added.length && !removed.length) return
	persist(next)
	query.value = ''
	try {
		for (const tag of added)
			await frappe.xcall('frappe.desk.doctype.tag.tag.add_tag', {
				tag,
				dt: props.frm.doctype,
				dn: props.frm.docname,
			})
		for (const tag of removed)
			await frappe.xcall('frappe.desk.doctype.tag.tag.remove_tag', {
				tag,
				dt: props.frm.doctype,
				dn: props.frm.docname,
			})
	} catch (e) {
		persist(prev) // revert on failure
		throw e
	}
}

const model = computed<string[]>({
	get: () => currentTags.value,
	set: (next) => applyChange(next),
})

function removeTag(value: string) {
	applyChange(currentTags.value.filter((v) => v !== value))
}
</script>

<template>
	<section class="flex flex-col gap-2">
		<!-- read-only: just the pills -->
		<div v-if="!canEdit" class="flex flex-wrap items-center gap-1">
			<Badge v-for="tag in currentTags" :key="tag" :theme="themeFor(tag)" size="md">
				{{ tag }}
			</Badge>
			<span v-if="!currentTags.length" class="text-sm text-ink-gray-4">{{
				__('No tags')
			}}</span>
		</div>

		<!-- editable: frappe-ui MultiSelect with badge pills in a custom trigger -->
		<MultiSelect
			v-else
			v-model="model"
			:options="options"
			:loading="loading"
			:placeholder="__('Add tags…')"
			:empty-text="__('No tags found')"
			@update:query="onQuery"
			@update:open="onOpen"
		>
			<template #trigger="{ open, selectedOptions, setOpen }">
				<button
					type="button"
					:data-state="open ? 'open' : 'closed'"
					class="flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded border border-outline-gray-2 px-1.5 py-1 text-left transition-colors hover:border-outline-gray-3 data-[state=open]:focus-ring"
					@click="setOpen(!open)"
				>
					<div class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
						<Badge
							v-for="option in selectedOptions"
							:key="option.value"
							:theme="(option as any).theme"
							size="md"
						>
							{{ option.value }}
							<template #suffix>
								<span
									role="button"
									tabindex="-1"
									class="-mr-0.5 inline-flex cursor-pointer items-center justify-center rounded-sm p-0.5 opacity-70 hover:opacity-100"
									@click.stop="removeTag(option.value)"
									@pointerdown.stop
								>
									<LucideX class="h-3 w-3" />
								</span>
							</template>
						</Badge>

						<span v-if="!selectedOptions.length" class="px-1 text-sm text-ink-gray-4">
							{{ __('Add tags…') }}
						</span>
					</div>

					<LucideChevronDown
						class="h-4 w-4 shrink-0 text-ink-gray-4 transition-transform"
						:class="open && 'rotate-180'"
					/>
				</button>
			</template>
		</MultiSelect>
	</section>
</template>
