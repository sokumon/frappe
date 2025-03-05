import frappe


@frappe.whitelist()
def get_sidebar_items():
	portal_sidebar_items = frappe.get_all(
		"Portal Menu Item", fields=["title", "route", "role"], filters={"enabled": 1}
	)
	valid_portal_sidebar_items = get_valid_sidebar_items(portal_sidebar_items)
	return valid_portal_sidebar_items


def get_valid_sidebar_items(portal_sidebar_items):
	# should cache all this
	valid_sidebar_items = []
	for r in frappe.get_roles(frappe.session.user):
		for s in portal_sidebar_items:
			if s["role"] == r:
				valid_sidebar_items.append(s)
	return valid_sidebar_items
