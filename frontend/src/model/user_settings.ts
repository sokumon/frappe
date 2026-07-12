/* Ported verbatim from frappe/public/js/frappe/model/user_settings.js. Wrapped in an
 * install fn so it runs after the global `frappe` + frappe.provide are ready
 * (see model/index.ts). Replaces the file that shipped in the removed
 * desk.bundle "framework bundle".
 *
 * frappe.model.user_settings (get/save/save_report/remove_report)
 *
 * Globals ($, __, frappe, locals, cint, cstr, flt, ...) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installUserSettings() {
frappe.provide("frappe.model.user_settings");

Object.assign(frappe.model.user_settings, {
	get: function (doctype) {
		return frappe
			.call("frappe.model.utils.user_settings.get", { doctype })
			.then((r) => JSON.parse(r.message || "{}"));
	},
	save: function (doctype, key, value) {
		if (frappe.session.user === "Guest") return Promise.resolve();

		const old_user_settings = frappe.model.user_settings[doctype] || {};
		const new_user_settings = structuredClone(old_user_settings); // deep copy

		if ($.isPlainObject(value)) {
			new_user_settings[key] = new_user_settings[key] || {};
			Object.assign(new_user_settings[key], value);
		} else {
			new_user_settings[key] = value;
		}

		const a = JSON.stringify(old_user_settings);
		const b = JSON.stringify(new_user_settings);
		if (a !== b) {
			// update if changed
			return this.update(doctype, new_user_settings);
		}
		return Promise.resolve(new_user_settings);
	},
	remove: function (doctype, key) {
		var user_settings = frappe.model.user_settings[doctype] || {};
		delete user_settings[key];

		return this.update(doctype, user_settings);
	},
	update: function (doctype, user_settings) {
		if (frappe.session.user === "Guest") return Promise.resolve();
		return frappe.call({
			method: "frappe.model.utils.user_settings.save",
			args: {
				doctype: doctype,
				user_settings: user_settings,
			},
			callback: function (r) {
				frappe.model.user_settings[doctype] = r.message;
			},
		});
	},
});

frappe.get_user_settings = function (doctype, key) {
	var settings = frappe.model.user_settings[doctype] || {};
	if (key) {
		settings = settings[key] || {};
	}
	return settings;
};

}
