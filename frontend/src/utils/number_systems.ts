/* Ported from frappe/public/js/frappe/utils/number_systems.js.
 *
 * The original is a plain object literal that calls `__` (translate) at
 * module-eval. In the desk.bundle that was safe (translate.js runs first in the
 * same bundle), but here this module lives in the app graph and would evaluate
 * BEFORE initFrappe() -> installTranslate() defines window.__. So it's exported
 * as a memoized function: the (identity-ish) symbol translations run on first
 * access, by which point __ exists. Only consumer is utils.ts get_number_system.
 */
/* eslint-disable */
// @ts-nocheck
let cached
export default function number_systems() {
	if (cached) return cached
	cached = {
		default: [
			{
				divisor: 1.0e12,
				symbol: __("T", null, "Number system"),
			},
			{
				divisor: 1.0e9,
				symbol: __("B", null, "Number system"),
			},
			{
				divisor: 1.0e6,
				symbol: __("M", null, "Number system"),
			},
			{
				divisor: 1.0e3,
				symbol: __("K", null, "Number system"),
			},
		],
		indian: [
			{
				divisor: 1.0e7,
				symbol: __("Cr", null, "Number system"),
			},
			{
				divisor: 1.0e5,
				symbol: __("L", null, "Number system"),
			},
			{
				divisor: 1.0e3,
				symbol: __("K", null, "Number system"),
			},
		],
		nepalese: [
			{
				divisor: 1.0e11,
				symbol: __("Kh", null, "Number system"), // 10^11 is read as 1 Kharba
			},
			{
				divisor: 1.0e9,
				symbol: __("Ar", null, "Number system"), // 10^9 is read as 1 Arba
			},
			{
				divisor: 1.0e7,
				symbol: __("Cr", null, "Number system"),
			},
			{
				divisor: 1.0e5,
				symbol: __("L", null, "Number system"),
			},
			{
				divisor: 1.0e3,
				symbol: __("K", null, "Number system"),
			},
		],
	}
	return cached
}
