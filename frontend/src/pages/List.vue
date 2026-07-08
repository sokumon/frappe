<script setup lang="ts">
// Doctype list view — the Vue `@framework/ui` ListView controls (Filter,
// QuickFilter, SortBy, ColumnSettings) + `useListView` state + the frappe-ui
// ListView table, replacing the legacy desk-mounted `frappe.views.ListView`.
//
// `useListBridge` makes the old per-doctype `frappe.listview_settings[doctype]`
// "just work": declarative hooks (add_fields, filters, formatters, get_indicator,
// get_form_link, hide_name_column, button, primary_action) map onto the controls
// and cell rendering, and a maximal `listview` shim runs `onload(listview)` with
// its `.page` wired to the real Navbar via the PageShell bridge.
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
	Badge,
	Button,
	Dropdown,
	ListView,
	ListHeader,
	ListRows,
	ListSelectBanner,
	ListFooter,
} from 'frappe-ui'
import PageShell from '@/components/PageShell.vue'
import { useListView } from '@framework/ui/ListView'
import { Filter } from '@framework/ui/Filter'
import { SortBy } from '@framework/ui/SortBy'
import { QuickFilter } from '@framework/ui/QuickFilter'
import { ColumnSettings } from '@framework/ui/ColumnSettings'
import { useListBridge } from '@/composables/useListBridge'

// route params: doctype (url slug), view and rest (from the route or /:slug).
const props = defineProps<{ doctype: string; view?: string; rest?: string }>()

// the url carries the slug ("sales-order"); the list needs the real doctype
const doctype =
	frappe.router.routes?.[props.doctype]?.doctype || frappe.router.unslug(props.doctype)

const title = computed(() => {
	const fn = (window as any).__ as ((s: string) => string) | undefined
	const name = frappe.router.doctype_layout || doctype
	return fn ? fn(name) : name
})

const shell = useTemplateRef<InstanceType<typeof PageShell>>('shell')

// Shared control state (Filter/QuickFilter share `filters`; ColumnSettings shares
// `columns` with the table's drag-resize) + the listview_settings bridge.
const view = useListView(doctype)
const bridge = useListBridge(doctype, view, { getPage: () => shell.value?.page })

const listOptions = computed(() => ({
	selectable: true,
	resizeColumn: true,
	showTooltip: false,
	// Row click navigates to the form (honoring settings.get_form_link) via the SPA router.
	getRowRoute: (row: any) => bridge.rowRoute(row),
}))

// Map a frappe indicator colour to a frappe-ui Badge theme.
const INDICATOR_THEME: Record<string, string> = {
	green: 'green',
	blue: 'blue',
	'light-blue': 'blue',
	cyan: 'blue',
	orange: 'orange',
	yellow: 'orange',
	red: 'red',
	pink: 'red',
	purple: 'purple',
	gray: 'gray',
	grey: 'gray',
	darkgrey: 'gray',
	black: 'gray',
}
const indicatorTheme = (c: string) => INDICATOR_THEME[c] ?? 'gray'

// frappe-ui's ListHeaderItem emits column drag-resize; write it into the shared
// columns ref (ColumnSettings reflects it, per the story).
function onColumnWidthUpdated(event: { key: string; width: string }) {
	view.columns.setWidth(event.key, event.width)
}
function onResizerDoubleClick(event: MouseEvent) {
	const resizer = (event.target as HTMLElement).closest('.cursor-col-resize')
	const header = resizer?.closest('.grid')
	if (!resizer || !header) return
	const index = Array.from(header.querySelectorAll('.cursor-col-resize')).indexOf(resizer)
	const column = bridge.wireColumns.value[index]
	if (column) view.columns.resetWidth(column.key)
}

// Bulk actions over the live selection (the default banner slot is overridden, so
// we re-add ListSelectBanner). Delete uses the desk bulk-delete endpoint.
function bulkActions(selected: Set<any>, unselectAll: () => void) {
	const names = bridge.shim.get_checked_items(true)
	return [
		{
			label: 'Delete',
			onClick: () => {
				const __ = (window as any).__ || ((s: string) => s)
				frappe.confirm(__('Delete {0} item(s)?', [names.length]), () => {
					frappe
						.call({
							method: 'frappe.desk.reportview.delete_items',
							args: { doctype, items: names },
						})
						.then(() => {
							unselectAll()
							bridge.reload()
						})
				})
			},
		},
	]
}

// Run the primary action + onload once BOTH the doctype (meta + __list_js) is ready
// AND the page bridge exists (mounted), so page.* calls land on the Navbar.
const mounted = ref(false)
let inited = false
onMounted(() => {
	mounted.value = true
	frappe.realtime?.init?.()
	;(window as any).cur_list = bridge.shim
})
watch(
	[bridge.ready, mounted],
	([r, m]) => {
		if (r && m && !inited) {
			inited = true
			bridge.setupPrimaryAction()
			bridge.runOnload()
		}
	},
	{ immediate: true }
)
</script>

<template>
	<!-- legacy-styles=false: the list is now the Vue ListView, so keep the legacy
		 desk SCSS off the main section. -->
	<PageShell ref="shell" :title="title" :legacy-styles="false">
		<div class="flex h-full min-h-0 flex-1 flex-col gap-3 px-4 py-3">
			<!-- Toolbar: quick filters (left) + Filter / Sort / Columns (right). -->
			<div class="flex shrink-0 items-start gap-2">
				<QuickFilter
					class="flex-1"
					v-model:filters="view.filters.conditions.value"
					v-model:fields="view.quickFilter.fields.value"
					v-model:customizing="view.quickFilter.customizing.value"
					:doctype="doctype"
				/>
				<template v-if="!view.quickFilter.customizing.value">
					<Filter v-model="view.filters.conditions.value" :doctype="doctype" />
					<SortBy v-model="view.sort.by.value" :doctype="doctype" />
					<ColumnSettings
						v-model="view.columns.shown.value"
						:doctype="doctype"
						:can-reset="view.columns.isCustomized.value"
						@reset="view.columns.reset()"
					/>
				</template>
			</div>

			<!-- Table: frappe-ui ListView fed by the bridge's wire columns + display rows. -->
			<ListView
				class="min-h-0 flex-1"
				:columns="bridge.wireColumns.value"
				:rows="bridge.displayRows.value"
				row-key="name"
				:options="listOptions"
				@update:selections="bridge.setSelections"
			>
				<ListHeader
					@columnWidthUpdated="onColumnWidthUpdated"
					@dblclick="onResizerDoubleClick"
				/>
				<ListRows />

				<!-- Cells: indicator pill, per-row button, formatter/standard HTML. -->
				<template #cell="{ column, item }">
					<template v-if="column.key === '_indicator'">
						<Badge
							v-if="item"
							:label="item[0]"
							:theme="indicatorTheme(item[1])"
							variant="subtle"
						/>
					</template>
					<template v-else-if="column.key === '_button'">
						<Button
							v-if="bridge.button.value && bridge.button.value.show(item)"
							variant="subtle"
							:label="bridge.button.value.get_label(item)"
							@click.prevent.stop="bridge.button.value.action(item)"
						/>
					</template>
					<span
						v-else-if="item && item.__html !== undefined"
						class="truncate text-base"
						v-html="item.__html"
					/>
					<span v-else class="truncate text-base">{{ item }}</span>
				</template>

				<ListSelectBanner>
					<template #actions="{ selections, unselectAll }">
						<Dropdown :options="bulkActions(selections, unselectAll)">
							<Button icon="lucide-more-horizontal" variant="ghost" />
						</Dropdown>
					</template>
				</ListSelectBanner>
			</ListView>

			<!-- Footer: page-length + Load More + "N of total". -->
			<ListFooter
				class="shrink-0"
				v-model="bridge.pageLength.value"
				:options="{ rowCount: bridge.rowCount.value, totalCount: bridge.totalCount.value }"
				@loadMore="bridge.loadMore()"
			/>
		</div>
	</PageShell>
</template>
