<template>
	<Dialog v-model:open="open" :title="titleText" :size="size ?? '4xl'">
		<div class="flex flex-col gap-3">
			<!-- Search + setter filter row (3-column round-robin, desk parity). -->
			<FormLayout :layout="filterLayout" v-model:doc="filterDoc" />

			<!-- Advanced filter builder (controlled; conditions serialize to wire). -->
			<div v-if="showFilters" class="flex justify-end">
				<Filter v-model="conditions" :doctype="doctype" />
			</div>

			<!-- Parent results. v-show (not v-if) so the ListView instance — and its
			     selection Set — survives toggling into child mode and back. -->
			<div v-show="!childMode" class="flex h-72 flex-col overflow-hidden">
				<ListView
					class="h-full"
					:columns="parentColumns"
					:rows="parentRows"
					row-key="name"
					:options="listOptions"
					@update:selections="onParentSelections"
				/>
			</div>
			<div v-show="!childMode && hasMore" class="flex justify-center">
				<Button variant="subtle" :loading="loading" @click="loadMore">More</Button>
			</div>

			<!-- Child rows (item-level selection). -->
			<template v-if="childSelectionAvailable">
				<div v-show="childMode" class="flex h-72 flex-col overflow-hidden">
					<ListView
						class="h-full"
						:columns="childListColumns"
						:rows="childRows"
						row-key="name"
						:options="listOptions"
						@update:selections="onChildSelections"
					/>
				</div>
				<div v-show="childMode && childHasMore" class="flex justify-center">
					<Button variant="subtle" :loading="childLoading" @click="loadMoreChildren">
						More
					</Button>
				</div>
			</template>

			<!-- Extra data fields whose values ride into the pick args. -->
			<FormLayout
				v-if="dataFieldsLayout.length"
				:layout="dataFieldsLayout"
				v-model:doc="dataDoc"
			/>
		</div>

		<template #actions>
			<div class="flex w-full items-center gap-2">
				<div class="ml-auto flex flex-row-reverse gap-2">
					<Button variant="solid" @click="pick">
						{{ primaryActionLabel ?? "Get Items" }}
					</Button>
					<Button v-if="secondaryActionLabel" variant="outline" @click="makeNew">
						{{ secondaryActionLabel }}
					</Button>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { Button, Dialog, ListView, debounce } from "frappe-ui";
import { FormLayout, buildLayoutFromMeta } from "../FormLayout";
import type { RawMetaField } from "../FormLayout/types";
import { Filter, serializeFilters } from "../Filter";
import type { FilterCondition } from "../Filter";
import { useRecordSearch } from "./useRecordSearch";
import type { RecordSearchArgs } from "./useRecordSearch";
import type { RecordPickerPayload, RecordPickerProps } from "./types";

const props = defineProps<RecordPickerProps>();

const emit = defineEmits<{
	/** Primary action: the current selection + legacy-shaped args. */
	pick: [payload: RecordPickerPayload];
	/** Secondary action: caller routes to a new-doc form seeded from `values`. */
	makeNew: [values: Record<string, any>];
}>();

const open = defineModel<boolean>("open", { default: false });

const titleText = computed(() => props.title ?? `Select ${props.doctype}`);

const SEARCH_FIELD = "search_term";
const CHILD_TOGGLE_FIELD = "allow_child_item_selection";

const childSelectionAvailable = computed(() =>
	Boolean(props.childFieldname && props.childDoctype)
);

// --- filter row -----------------------------------------------------------
// Desk parity: search field first, setters round-robined across 3 columns,
// child-mode toggle under the search column.
const filterFields = computed<RawMetaField[]>(() => {
	const buckets: RawMetaField[][] = [
		[{ fieldtype: "Data", fieldname: SEARCH_FIELD, label: "Name" }],
		[],
		[],
	];
	(props.setters ?? []).forEach((setter, index) => {
		buckets[(index + 1) % 3].push(setter);
	});
	if (childSelectionAvailable.value) {
		buckets[0].push({
			fieldtype: "Check",
			fieldname: CHILD_TOGGLE_FIELD,
			label: `Select ${props.childDoctype}`,
		});
	}
	return [
		...buckets[0],
		{ fieldtype: "Column Break", fieldname: "rp_cb_1" },
		...buckets[1],
		{ fieldtype: "Column Break", fieldname: "rp_cb_2" },
		...buckets[2],
	];
});

const filterLayout = computed(() => buildLayoutFromMeta(filterFields.value));

const filterDoc = reactive<Record<string, any>>({});
// Seed setter defaults (legacy: object-form setter values prefill the fields).
watch(
	() => props.setters,
	(setters) => {
		for (const df of setters ?? []) {
			if (df.fieldname && df.default != null && filterDoc[df.fieldname] == null) {
				filterDoc[df.fieldname] = df.default;
			}
		}
	},
	{ immediate: true }
);

const dataFieldsLayout = computed(() =>
	props.dataFields?.length ? buildLayoutFromMeta(props.dataFields as RawMetaField[]) : []
);
const dataDoc = reactive<Record<string, any>>({});

const conditions = defineModel<FilterCondition[]>("conditions", { default: () => [] });

// --- search ---------------------------------------------------------------
const {
	results,
	hasMore,
	loading,
	childResults,
	childHasMore,
	childLoading,
	search,
	searchParentNames,
	searchChildren,
} = useRecordSearch();

const pageLength = reactive({ parent: props.pageLength ?? 20, child: 20 });

const childMode = computed(
	() => childSelectionAvailable.value && Boolean(filterDoc[CHILD_TOGGLE_FIELD])
);

/** Legacy `get_args_for_search`: static get_query filters + setter values +
 *  the filter builder's wire conditions, as `[doctype, field, op, value]`. */
function getSearchArgs(): RecordSearchArgs {
	const query = props.getQuery?.() ?? {};
	const filters: unknown[][] = [];

	const staticFilters = query.filters ?? {};
	if (Array.isArray(staticFilters)) {
		filters.push(...staticFilters.map((f) => (f.length === 4 ? f : [props.doctype, ...f])));
	} else {
		for (const [key, value] of Object.entries(staticFilters)) {
			if (Array.isArray(value)) filters.push([props.doctype, key, value[0], value[1]]);
			else filters.push([props.doctype, key, "=", value]);
		}
	}

	const filterFieldnames: string[] = [];
	for (const df of props.setters ?? []) {
		if (!df.fieldname) continue;
		filterFieldnames.push(df.fieldname);
		const value = filterDoc[df.fieldname];
		if (value == null || value === "") continue;
		if (df.fieldtype === "Data")
			filters.push([props.doctype, df.fieldname, "like", `%${value}%`]);
		else filters.push([props.doctype, df.fieldname, "=", value]);
	}

	for (const [field, op, value] of serializeFilters(conditions.value)) {
		filters.push([props.doctype, field, op, value]);
	}

	return {
		doctype: props.doctype,
		txt: filterDoc[SEARCH_FIELD] ?? "",
		filters,
		filter_fields: filterFieldnames,
		page_length: pageLength.parent + 5,
		query: query.query || "",
		as_dict: 1,
		query_filters_as_dict: true,
	};
}

async function runSearch() {
	if (childMode.value) {
		await searchChildren({
			parentDoctype: props.doctype,
			childDoctype: props.childDoctype!,
			childFieldname: props.childFieldname!,
			childColumns: props.childColumns ?? [],
			parentNames: await searchParentNames(getSearchArgs()),
			pageLength: pageLength.child,
		});
	} else {
		await search(getSearchArgs(), pageLength.parent);
	}
}

const debouncedSearch = debounce(runSearch, 300);

// Search on open, and re-search as the user types/edits filters.
watch(open, (isOpen) => isOpen && runSearch(), { immediate: true });
watch([filterDoc, conditions], () => open.value && debouncedSearch(), { deep: true });

function loadMore() {
	pageLength.parent += 20;
	runSearch();
}

function loadMoreChildren() {
	pageLength.child += 20;
	runSearch();
}

// --- results + selection ---------------------------------------------------
function unscrub(name: string): string {
	return name.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const resultColumnKeys = computed<string[]>(() => {
	// Custom query + explicit columns override (legacy get_datatable_columns).
	if (props.getQuery?.()?.query && props.columns?.length) return props.columns;
	return ["name", ...(props.setters ?? []).map((df) => df.fieldname!).filter(Boolean)];
});

const parentColumns = computed(() =>
	resultColumnKeys.value.map((key) => {
		const setter = (props.setters ?? []).find((df) => df.fieldname === key);
		return { label: setter?.label || unscrub(key), key };
	})
);

// Selected rows persist across searches (legacy selected_items): rows no longer
// in the results are prepended so they stay visible and checked.
const selectedRows = reactive(new Map<string, Record<string, any>>());

const parentRows = computed(() => {
	const inResults = new Set(results.value.map((r) => r.name));
	const sticky = [...selectedRows.values()].filter((r) => !inResults.has(r.name));
	return [...sticky, ...results.value];
});

function onParentSelections(selections: Set<string>) {
	for (const name of [...selectedRows.keys()]) {
		if (!selections.has(name)) selectedRows.delete(name);
	}
	for (const name of selections) {
		if (selectedRows.has(name)) continue;
		const row = parentRows.value.find((r) => r.name === name);
		if (row) selectedRows.set(name, { ...row });
	}
}

const childListColumns = computed(() => [
	{ label: unscrub(props.doctype), key: "parent" },
	...(props.childColumns ?? []).map((key) => ({ label: unscrub(key), key })),
]);

const childRows = computed(() => childResults.value);

const selectedChildNames = reactive(new Set<string>());

function onChildSelections(selections: Set<string>) {
	selectedChildNames.clear();
	for (const name of selections) selectedChildNames.add(name);
}

const listOptions = {
	selectable: true,
	showTooltip: false,
	resizeColumn: false,
	emptyState: { title: "No records found", description: "" },
};

// --- actions ----------------------------------------------------------------
/** Legacy `get_custom_filters`: the builder's conditions as a fieldname dict. */
function customFiltersDict(): Record<string, unknown> {
	return serializeFilters(conditions.value).reduce(
		(acc, [field, op, value]) => Object.assign(acc, { [field]: [op, value] }),
		{} as Record<string, unknown>
	);
}

function setterValues(): Record<string, any> {
	const values: Record<string, any> = {};
	for (const df of props.setters ?? []) {
		if (df.fieldname) values[df.fieldname] = filterDoc[df.fieldname] ?? undefined;
	}
	return values;
}

function pick() {
	const checkedChildren = childResults.value.filter((r) => selectedChildNames.has(r.name));
	const parentsOfChildren = [...new Set(checkedChildren.map((r) => r.parent))];
	const payload: RecordPickerPayload = {
		selections: [...new Set([...selectedRows.keys(), ...parentsOfChildren])],
		childSelections: checkedChildren.map((r) => r.name),
		args: {
			...setterValues(),
			...dataDoc,
			...customFiltersDict(),
			filtered_children: checkedChildren.map((r) => r.name),
		},
	};
	emit("pick", payload);
}

function makeNew() {
	emit("makeNew", setterValues());
}
</script>
