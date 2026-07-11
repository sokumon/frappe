// RecordPicker — the multi-select record picker dialog (Vue counterpart of
// desk's `frappe.ui.form.MultiSelectDialog`, e.g. ERPNext's "Get Items From").
// Composes frappe-ui Dialog + ListView (selection) with FormLayout (setter
// filters) and Filter (advanced conditions); data via useRecordSearch.
export { default as RecordPicker } from "./RecordPicker.vue";
export { useRecordSearch } from "./useRecordSearch";
export type { RecordSearchArgs } from "./useRecordSearch";
export type {
	RecordPickerPayload,
	RecordPickerProps,
	RecordPickerQuery,
} from "./types";
