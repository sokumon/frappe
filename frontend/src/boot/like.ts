// boot/like.ts
//
// The two pure "like" helpers from frappe/public/js/frappe/ui/like.js (a
// desk.bundle file from the removed "framework bundle"). FormSidebar.vue and
// legacy list views call frappe.ui.is_liked / frappe.ui.get_liked_by, so they
// must exist globally — not owned by a component.
//
// The rest of like.js (toggle_like / setup_like_popover — jQuery + @popperjs/core
// popover) is reimplemented natively by the Vue sidebar, so it's intentionally
// not ported here. Add it later only if a bridged legacy view needs it.
//
// frappe.ui exists via installProvide (frappe.provide("frappe.ui.form")); these
// read frappe.session at call time, so no install-order constraint.
export function installLike() {
	frappe.ui.is_liked = function (doc: any) {
		return frappe.ui.get_liked_by(doc).includes(frappe.session.user)
	}

	frappe.ui.get_liked_by = function (doc: any) {
		return doc._liked_by ? JSON.parse(doc._liked_by) : []
	}
}
