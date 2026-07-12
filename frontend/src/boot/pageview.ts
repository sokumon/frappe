// boot/pageview.ts
//
// The data-loading half of frappe/public/js/frappe/views/pageview.js (a
// desk.bundle file from the removed "framework bundle"). Only `with_page` (Page
// doc resolution: standard_pages / locals / localStorage / getpage fetch) is
// ported — Page.vue calls `frappe.views.pageview.with_page(name, cb)` then
// renders the page itself.
//
// Deliberately NOT ported (bucket-2 legacy rendering, replaced by Page.vue +
// the Vue router): `frappe.views.pageview.show`, the `frappe.views.Page` class,
// `frappe.show_message_page`, `frappe.show_not_found`/`show_not_permitted` — they
// render via legacy `frappe.container`. Page.vue optional-chains show_not_found,
// so its absence is a no-op (blank not-found), not an error. Add a Vue not-found
// later if desired.
//
// TIMING: only frappe.provide + reads (frappe.model/call/boot) at call time, so
// no eval-order constraint; installed at the model seam with the rest.

/* eslint-disable */
// @ts-nocheck
export function installPageview() {
	frappe.provide("frappe.views.pageview");
	frappe.provide("frappe.standard_pages");
	// with_page indexes frappe.pages; the page bridge (createPage.ts) also
	// creates it, but provide here too so this module is self-sufficient.
	frappe.provide("frappe.pages");

	frappe.views.pageview.with_page = function (name, callback) {
		if (frappe.standard_pages[name]) {
			if (!frappe.pages[name]) {
				frappe.standard_pages[name]();
			}
			callback();
			return;
		}

		if (
			(locals.Page && locals.Page[name] && locals.Page[name].script) ||
			name == window.page_name
		) {
			// already loaded
			callback();
		} else if (localStorage["_page:" + name] && frappe.boot.developer_mode != 1) {
			// cached in local storage
			frappe.model.sync(JSON.parse(localStorage["_page:" + name]));
			callback();
		} else if (name) {
			// get fresh
			return frappe.call({
				method: "frappe.desk.desk_page.getpage",
				args: { name: name },
				callback: function (r) {
					if (!r.docs._dynamic_page) {
						try {
							localStorage["_page:" + name] = JSON.stringify(r.docs);
						} catch (e) {
							console.warn(e);
						}
					}
					callback();
				},
				error: function () {
					// frappe.search may not exist in the Vue desk; guard it.
					frappe.search?.utils?.results_to_hide?.push(name);
				},
				freeze: true,
			});
		}
	};
}
