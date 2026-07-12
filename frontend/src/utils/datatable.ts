/* Ported verbatim from frappe/public/js/frappe/utils/datatable.js. Wrapped in an
 * install fn (see utils/index.ts) so it runs after the global `frappe` +
 * frappe.provide + jQuery are ready. Replaces the file that shipped in the
 * removed desk.bundle "framework bundle".
 *
 * frappe.utils.datatable.get_translations (frappe-datatable i18n)
 *
 * Globals ($, __, frappe, locals, cint, cstr, flt, repl, ...) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installDatatable() {
frappe.provide("frappe.utils.datatable");

frappe.utils.datatable.get_translations = function () {
	let translations = {};
	translations[frappe.boot.lang] = {
		"Sort Ascending": __("Sort Ascending"),
		"Sort Descending": __("Sort Descending"),
		"Reset sorting": __("Reset sorting"),
		"Remove column": __("Remove column"),
		"No Data": __("No Data"),
		"{count} cells copied": {
			1: __("{count} cell copied"),
			default: __("{count} cells copied"),
		},
		"{count} rows selected": {
			1: __("{count} row selected"),
			default: __("{count} rows selected"),
		},
	};

	return translations;
};

}
