/* Ported verbatim from frappe/public/js/frappe/utils/preview_email.js. Wrapped in an
 * install fn (see utils/index.ts) so it runs after the global `frappe` +
 * frappe.provide + jQuery are ready. Replaces the file that shipped in the
 * removed desk.bundle "framework bundle".
 *
 * frappe.preview_email (render an email template into a dialog)
 *
 * Globals ($, __, frappe, locals, cint, cstr, flt, repl, ...) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installPreviewEmail() {
frappe.preview_email = function (
	template,
	args,
	header,
	with_container = false,
	only_html = false
) {
	return frappe
		.call({
			method: "frappe.email.email_body.get_email_html",
			args: {
				subject: "Test",
				template,
				args,
				header,
				with_container,
			},
		})
		.then((r) => {
			var html = r.message;
			html = html.replace(/embed=/, "src=");
			if (only_html) {
				return html;
			}
			var d = frappe.msgprint({
				message: '<iframe width="100%" height="600px" style="border: none;"></iframe>',
				wide: true,
			});

			setTimeout(() => {
				d.$wrapper.find("iframe").contents().find("html").html(html);
				d.$wrapper.find(".modal-dialog").css("width", "70%");
			}, 1000);
		});
};

}
