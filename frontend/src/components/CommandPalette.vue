<script setup lang="ts">
// ⌘K palette — the Vue replacement for the legacy navbar Awesome Bar
// (ui/toolbar/awesome_bar.js, which the Vue shell never loads). Everything it
// shows comes from `frappe.search.utils` (search/searchUtils.ts) by way of
// search/commandPalette.ts. Mounted once, in App.vue.
//
// This deliberately does NOT use frappe-ui's <CommandPalette>: that component
// reads the query with `<ComboboxInput v-model="searchQuery">`, but
// @headlessui/vue's ComboboxInput has no `modelValue` prop and emits only
// `change` — so `modelValue` lands on the <input> as a dead attribute, the
// update listener never fires, and its `update:searchQuery` never emits. The
// palette would stay frozen on its empty-query results no matter what you type.
// (helpdesk hand-rolled its own palette for the same reason.) So we keep
// frappe-ui's <Dialog> + markup and bind the `change` event headlessui really
// emits. Rows render through CommandPaletteItem.vue.
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { Dialog } from 'frappe-ui'
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/vue'
import CommandPaletteItem from '@/components/CommandPaletteItem.vue'
import {
	buildGroups,
	globalLoading,
	open,
	query,
	requestGlobalSearch,
	selectItem,
	type PaletteItem,
} from '@/search/commandPalette'

// `SetVueGlobals(app)` (boot/libs.ts) is only ever applied to the legacy
// mini-Vue-apps, never to the shell app, so `__` is not on globalProperties —
// templates have to alias it in setup. Same as FormTimeline.vue / FormTags.vue.
const __ = (window as any).__ || ((s: string, _a?: any[]) => s)

// markRaw: handed to <component :is>, and a reactive proxy around a component
// definition makes Vue warn and re-render needlessly.
const itemComponent = markRaw(CommandPaletteItem)

const inputRef = ref<any>(null)
const groups = computed(() => buildGroups(query.value, itemComponent))
const hasItems = computed(() => groups.value.some((g) => g.items.length))

// ComboboxInput emits `change` (a native input event), not `update:modelValue`.
function onInput(e: Event) {
	query.value = (e.target as HTMLInputElement).value
}

// Local matches are synchronous (fuzzy_search over boot); global-search hits are
// fetched debounced and merge into a Documents group when they land.
watch(query, (txt) => requestGlobalSearch(txt))

// Each open starts from a clean slate, and the input owns focus. The Dialog
// mounts its body lazily, so focus has to wait a tick.
watch(open, (isOpen) => {
	if (!isOpen) return
	query.value = ''
	nextTick(() => {
		const el = inputRef.value?.$el ?? inputRef.value
		el?.focus?.()
		if (el) el.value = ''
	})
})

function onSelect(item: PaletteItem | null) {
	selectItem(item)
}
</script>

<template>
	<!-- `bare`: no dialog chrome, so the input and the results list run edge to
	     edge. DialogContent still supplies the surface, rounding and shadow. -->
	<Dialog v-model="open" size="xl" position="top" bare>
		<template #default>
			<div>
				<Combobox nullable @update:model-value="onSelect">
					<div class="relative">
						<div class="absolute inset-y-0 left-0 flex items-center pl-4.5">
							<span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
						</div>
						<ComboboxInput
							ref="inputRef"
							:placeholder="__('Search or type a command')"
							class="w-full border-none bg-transparent py-3 pl-11.5 pr-4.5 text-base text-ink-gray-8 placeholder-ink-gray-4 focus:ring-0"
							autocomplete="off"
							@change="onInput"
						/>
					</div>
					<ComboboxOptions
						class="max-h-96 overflow-auto border-t border-outline-gray-1"
						static
						:hold="true"
					>
						<div
							class="mb-2 mt-4.5 first:mt-3"
							v-for="group in groups"
							:key="group.title"
						>
							<div class="mb-2.5 px-4.5 text-base text-ink-gray-5">
								{{ group.title }}
							</div>
							<ComboboxOption
								v-for="item in group.items"
								:key="item.name"
								v-slot="{ active }"
								:value="item"
								class="px-2.5"
							>
								<component :is="group.component" :item="item" :active="active" />
							</ComboboxOption>
						</div>

						<div
							v-if="!hasItems"
							class="px-4.5 py-6 text-center text-base text-ink-gray-5"
						>
							{{ globalLoading ? __('Searching…') : __('No results found') }}
						</div>
					</ComboboxOptions>
				</Combobox>
			</div>
		</template>
	</Dialog>
</template>
