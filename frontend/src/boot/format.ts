/* Port of frappe/public/js/frappe/format.js (a desk.bundle file from the removed
 * "framework bundle"). The legacy file defined a `{}` / `{0}` positional string
 * formatter and attached it as `jQuery.format` (i.e. `$.format`).
 *
 * Here it's a plain exported `format()` (modernized: a closure counter replaces
 * the original `this.unkeyed_index` + `.bind(this)` dance — behaviour identical,
 * incl. numeric-only keys). translate.ts imports it directly, so that path no
 * longer needs jQuery. `installFormat()` still attaches `jQuery.format` for any
 * external caller (e.g. erpnext client scripts) that used `$.format`.
 */
export function format(str: string, args: any) {
	if (str == undefined) return str;

	let unkeyed_index = 0;
	return str.replace(/\{(\w*)\}/g, (match: string, key: any) => {
		if (key === "") {
			key = unkeyed_index;
			unkeyed_index++;
		}
		if (key == +key) {
			return args[key] !== undefined ? args[key] : match;
		}
	});
}

// Attaches $.format for legacy callers. Needs jQuery, so install after libs.
export function installFormat() {
	const jq = (window as any).jQuery;
	if (jq) jq.format = format;
}
