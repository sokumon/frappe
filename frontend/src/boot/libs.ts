/* Replacement for libs.bundle.js (jquery-bootstrap.js + lib/moment.js + the
 * SetVueGlobals/Sortable globals) from the removed desk.bundle. Instead of
 * loading the built libs.bundle.js as a <script>, the frontend now depends on
 * these libs directly (yarn: jquery/bootstrap/popper.js/moment/moment-timezone/
 * sortablejs) and exposes the same window globals.
 *
 * Bootstrap 4's dist plugins attach $.fn.modal/tooltip/dropdown/... to the jQuery
 * instance on import (side-effect), so the side-effect imports below register
 * them; installLibs() then publishes $ / jQuery / moment / Sortable / SetVueGlobals
 * on window for the ported code + the erpnext/controls bundles (which read
 * window.$ etc. at eval).
 *
 * TIMING: installed FIRST in initFrappe(), before appendScripts, so window.$ /
 * moment exist before controls/erpnext bundles (and the seam installs that use
 * $ at eval) run. */
/* eslint-disable */
// @ts-nocheck
import jQuery from "jquery"
// Bootstrap 4 jQuery plugins — imported for side effects ($.fn.* registration).
import "bootstrap/js/dist/alert"
import "bootstrap/js/dist/button"
import "bootstrap/js/dist/carousel"
import "bootstrap/js/dist/collapse"
import "bootstrap/js/dist/dropdown"
import "bootstrap/js/dist/modal"
import "bootstrap/js/dist/popover"
import "bootstrap/js/dist/scrollspy"
import "bootstrap/js/dist/tab"
import "bootstrap/js/dist/toast"
import "bootstrap/js/dist/tooltip"
import "bootstrap/js/dist/util"
// moment-timezone build with bundled TZ data (matches lib/moment.js).
import momentTimezone from "moment-timezone/builds/moment-timezone-with-data-10-year-range.min.js"
import Sortable from "sortablejs"

export function installLibs() {
	window.jQuery = jQuery
	window.$ = jQuery
	window.moment = momentTimezone
	window.Sortable = Sortable

	// Legacy helper: erpnext/frappe mini-Vue-apps (file_uploader, form_builder,
	// workflow_builder, print_format_builder, user_onboarding) call SetVueGlobals(app)
	// to expose __ / frappe on their app instance.
	window.SetVueGlobals = (app) => {
		app.config.globalProperties.__ = window.__
		app.config.globalProperties.frappe = window.frappe
	}
}
