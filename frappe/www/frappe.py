import frappe
from frappe.utils.jinja_globals import bundled_asset
from frappe.www.desk import get_context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	context = {}
	if not frappe.conf.developer_mode:
		frappe.throw("This method is only meant for developer mode")
	context = get_context(context)
	for key in ["app_include_js", "app_include_css"]:
		context[key] = [bundled_asset(asset) for asset in context[key]]

	return context
