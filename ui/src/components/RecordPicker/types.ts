import type { RawMetaField } from "../FormLayout/types";

/** Legacy `get_query` contract: static filters and/or a custom server search
 *  method (`query`) passed through to `frappe.desk.search.search_widget`. */
export interface RecordPickerQuery {
	filters?: Record<string, unknown> | unknown[][];
	query?: string;
}

/** Props for `<RecordPicker>` — the multi-select record picker dialog (the Vue
 *  counterpart of desk's `frappe.ui.form.MultiSelectDialog`). */
export interface RecordPickerProps {
	/** Doctype whose records are being picked. */
	doctype: string;
	/** Dialog title; defaults to "Select {doctype}". */
	title?: string;
	/** Filter-row field defs rendered above the results (legacy `setters`,
	 *  normalized to the array form). Their values become `=` filters (`like`
	 *  for Data) and ride into the pick payload's `args`. */
	setters?: RawMetaField[];
	/** Extra input fields below the results whose values ride into `args`
	 *  (legacy `data_fields`). */
	dataFields?: RawMetaField[];
	/** Legacy `get_query` hook. */
	getQuery?: () => RecordPickerQuery;
	/** Show the advanced Filter builder (legacy `add_filters_group`). */
	showFilters?: boolean;
	/** Child-row selection mode (legacy `allow_child_item_selection`): the
	 *  Table fieldname on the parent doctype... */
	childFieldname?: string;
	/** ...and its child doctype + the child columns to show. */
	childDoctype?: string;
	childColumns?: string[];
	/** Result columns override (legacy `columns`, used with a custom `query`). */
	columns?: string[];
	primaryActionLabel?: string;
	/** Label for the secondary "make new" action; the button hides when absent. */
	secondaryActionLabel?: string;
	/** Parent page size (legacy page_length). */
	pageLength?: number;
	/** frappe-ui Dialog size. */
	size?: string;
}

/** What the primary action hands back. */
export interface RecordPickerPayload {
	/** Checked parent names, plus the parents of any checked child rows. */
	selections: string[];
	/** Checked child row names (child-selection mode). */
	childSelections: string[];
	/** Setter values + data-field values + the custom-filter dict, in the
	 *  legacy `action(selections, args)` shape. */
	args: Record<string, any>;
}
