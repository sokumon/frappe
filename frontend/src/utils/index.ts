// utils/index.ts
//
// Installs the frappe util grab-bag onto the global `frappe` / `window`: the
// bare number/string helpers (cint, cstr, flt, format_currency, in_list...),
// frappe.utils.*, frappe.datetime.*, frappe.urllib, frappe.contacts, avatars,
// etc. These are verbatim ports of frappe/public/js/frappe/utils/*.js, which
// used to ship in the removed desk.bundle "framework bundle".
//
// TIMING: several files call `$.extend` / build jQuery at eval, so this must run
// AFTER libs.bundle (jQuery). It defines the primitives the ported model/* +
// user + erpnext code use at runtime, so main.ts installs it at the model seam
// (first non-libs script), BEFORE installModel / installUser.
//
// Ordering note: datatype must precede number_format — number_format ends with
// `Object.assign(window, { cint, ... })`, and that bare `cint` resolves to the
// global set by datatype. The rest are runtime-only, so order otherwise follows
// the original desk.bundle sequence.
import { installDatatype } from './datatype'
import { installUtilsCore } from './utils'
import { installCommon } from './common'
import { installNumberFormat } from './number_format'
import { installUrllib } from './urllib'
import { installPrettyDate } from './pretty_date'
import { installTools } from './tools'
import { installDatetime } from './datetime'
import { installHelp } from './help'
import { installHelpLinks } from './help_links'
import { installAddressAndContact } from './address_and_contact'
import { installPreviewEmail } from './preview_email'
import { installFileManager } from './file_manager'
import { installDiffview } from './diffview'
import { installDatatable } from './datatable'
import { installDashboardUtils } from './dashboard_utils'
import { installLogout } from './logout'
import { installWebTemplate } from './web_template'

export function installUtils() {
	installDatatype() // window.cstr / cint / validate_* / lstrip ... (base)
	installUtilsCore() // frappe.utils.* grab-bag
	installCommon() // frappe.avatar / get_palette / get_abbr
	installNumberFormat() // window.flt / format_currency / precision ... (needs datatype)
	installUrllib() // frappe.urllib
	installPrettyDate() // frappe.datetime.prettyDate / comment_when
	installTools() // frappe.tools + markdown
	installDatetime() // frappe.datetime.*
	installHelp() // frappe.help
	installHelpLinks() // frappe.help.help_links
	installAddressAndContact() // frappe.contacts
	installPreviewEmail() // frappe.preview_email
	installFileManager() // frappe.file_manager
	installDiffview() // frappe.ui.DiffView
	installDatatable() // frappe.utils.datatable
	installDashboardUtils() // frappe.dashboard_utils
	installLogout() // frappe.logout
	installWebTemplate() // frappe.utils.open_web_template_values_editor
}
