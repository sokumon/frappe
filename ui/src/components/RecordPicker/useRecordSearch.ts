import { ref } from "vue";
import { createResource, frappeRequest } from "frappe-ui";

/** Wire args for `frappe.desk.search.search_widget` (legacy
 *  `get_args_for_search` shape — filters are `[doctype, field, op, value]`
 *  tuples, `filter_fields` names extra columns to return). */
export interface RecordSearchArgs {
	doctype: string;
	txt: string;
	filters: unknown[][];
	filter_fields: string[];
	page_length: number;
	query?: string;
	as_dict: 1;
	query_filters_as_dict: true;
}

/**
 * Imperative search state over the two endpoints the picker needs — the desk
 * record search (parents) and `frappe.client.get_list` (child rows). Pure data:
 * over-fetches by 5 (desk convention) to detect "has more", slices to the page.
 */
export function useRecordSearch() {
	const results = ref<Record<string, any>[]>([]);
	const hasMore = ref(false);
	const loading = ref(false);

	const childResults = ref<Record<string, any>[]>([]);
	const childHasMore = ref(false);
	const childLoading = ref(false);

	const searchResource = createResource({
		url: "frappe.desk.search.search_widget",
		method: "POST",
		resourceFetcher: frappeRequest,
	});

	const childListResource = createResource({
		url: "frappe.client.get_list",
		method: "POST",
		resourceFetcher: frappeRequest,
	});

	async function search(args: RecordSearchArgs, pageLength: number): Promise<void> {
		loading.value = true;
		try {
			const rows: Record<string, any>[] = (await searchResource.submit(args)) || [];
			hasMore.value = rows.length > pageLength;
			results.value = rows.slice(0, pageLength);
		} finally {
			loading.value = false;
		}
	}

	/** Name-only parent search, for scoping the child query to matching parents. */
	async function searchParentNames(args: RecordSearchArgs): Promise<string[]> {
		const rows: Record<string, any>[] =
			(await searchResource.submit({ ...args, filter_fields: ["name"] })) || [];
		return rows.map((r) => r.name);
	}

	async function searchChildren(opts: {
		parentDoctype: string;
		childDoctype: string;
		childFieldname: string;
		childColumns: string[];
		parentNames: string[];
		pageLength: number;
	}): Promise<void> {
		childLoading.value = true;
		try {
			const filters: unknown[][] = [["parentfield", "=", opts.childFieldname]];
			if (opts.parentNames.length) filters.push(["parent", "in", opts.parentNames]);
			const rows: Record<string, any>[] =
				(await childListResource.submit({
					doctype: opts.childDoctype,
					filters,
					fields: ["name", "parent", ...opts.childColumns],
					parent: opts.parentDoctype,
					limit_page_length: opts.pageLength + 5,
					order_by: "parent",
				})) || [];
			childHasMore.value = rows.length > opts.pageLength;
			childResults.value = rows.slice(0, opts.pageLength);
		} finally {
			childLoading.value = false;
		}
	}

	return {
		results,
		hasMore,
		loading,
		childResults,
		childHasMore,
		childLoading,
		search,
		searchParentNames,
		searchChildren,
	};
}
