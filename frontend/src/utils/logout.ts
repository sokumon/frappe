/* Ported verbatim from frappe/public/js/frappe/utils/logout.js. Wrapped in an
 * install fn (see utils/index.ts) so it runs after the global `frappe` +
 * frappe.provide + jQuery are ready. Replaces the file that shipped in the
 * removed desk.bundle "framework bundle".
 *
 * frappe.logout / frappe.handle_session_expired
 *
 * Globals ($, __, frappe, locals, cint, cstr, flt, repl, ...) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installLogout() {
frappe.logout = function () {
	frappe.call({
		method: "logout",
		callback: function (r) {
			if (r.exc) {
				return;
			}
			window.location.href = "/login";
		},
	});
};

}
