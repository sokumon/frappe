// Minimal port of `frappe.Application.load_bootinfo` (desk.js) for the vue shell.
//
// The legacy Application class does a lot of UI bootstrapping that the vue shell
// owns itself. This class only recreates the boot-data wiring other code relies
// on (globals, model sync, page cache, moment locale), and deliberately leaves
// out:
//   - setup_workspaces  -> built by the router (see router/compat.ts)
//   - frappe.router.setup() / set_route() -> owned by vue-router
//   - style injection (print_css) -> handled elsewhere
declare const moment: any

export class FrappeApp {
	constructor() {
		this.load_bootinfo()
	}

	load_bootinfo() {
		if (frappe.boot) {
			frappe.model.sync(frappe.boot.docs)
			this.check_metadata_cache_status()
			this.set_globals()
			this.sync_pages()
			this.setup_moment()
			// Populate frappe.defaults._user_permissions from boot (desk.js
			// Application.load_user_permissions). Without this, frappe.defaults'
			// user-permission filtering silently no-ops.
			frappe.defaults.load_user_permission_from_boot()

			frappe.boot.setup_complete = frappe.boot.sysdefaults["setup_complete"]
			frappe.user.name = frappe.boot.user.name
		} else {
			this.set_as_guest()
		}
		frappe.ui?.toolbar?.fetch_session_defaults?.()
	}

	check_metadata_cache_status() {
		if (frappe.boot.metadata_version != localStorage.metadata_version) {
			frappe.assets.clear_local_storage()
			frappe.assets.init_local_storage()
		}
	}

	set_globals() {
		frappe.session.user = frappe.boot.user.name
		frappe.session.logged_in_user = frappe.boot.user.name
		frappe.session.user_email = frappe.boot.user.email
		frappe.session.user_fullname = frappe.user_info().fullname

		frappe.user_defaults = frappe.boot.user.defaults
		frappe.user_roles = frappe.boot.user.roles
		frappe.sys_defaults = frappe.boot.sysdefaults

		frappe.ui.py_date_format = frappe.boot.sysdefaults.date_format
			.replace("dd", "%d")
			.replace("mm", "%m")
			.replace("yyyy", "%Y")
		frappe.boot.user.last_selected_values = {}
	}

	sync_pages() {
		// clear cached pages if timestamp is not found
		if (localStorage["page_info"]) {
			frappe.boot.allowed_pages = []
			const page_info = JSON.parse(localStorage["page_info"])
			for (const name in frappe.boot.page_info) {
				const p = frappe.boot.page_info[name]
				if (!page_info[name] || page_info[name].modified != p.modified) {
					delete localStorage["_page:" + name]
				}
				frappe.boot.allowed_pages.push(name)
			}
		} else {
			frappe.boot.allowed_pages = Object.keys(frappe.boot.page_info)
		}
		localStorage["page_info"] = JSON.stringify(frappe.boot.page_info)
	}

	setup_moment() {
		moment.updateLocale("en", {
			week: {
				dow: frappe.datetime.get_first_day_of_the_week_index(),
			},
		})
		moment.locale("en")
		moment.user_utc_offset = moment().utcOffset()
		if (frappe.boot.timezone_info) {
			moment.tz.add(frappe.boot.timezone_info)
		}
	}

	set_as_guest() {
		frappe.session.user = "Guest"
		frappe.session.user_email = ""
		frappe.session.user_fullname = "Guest"

		frappe.user_defaults = {}
		frappe.user_roles = ["Guest"]
		frappe.sys_defaults = {}
	}
}
