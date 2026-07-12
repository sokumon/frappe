// boot/translate.ts
//
// Native port of the legacy `frappe/translate.js` (the second file of the
// removed `desk.bundle.js` "framework bundle"). Defines the translation
// primitive `frappe._` and its global alias `window.__`, plus
// `frappe.get_languages`.
//
// TIMING: installed FIRST in initFrappe(), before installProvide(). `window.__`
// is referenced pervasively (libs.bundle's SetVueGlobals copies it onto Vue's
// globalProperties, and the ported model/* files call `__` at runtime), so the
// alias must exist as early as possible. It only reads `frappe._messages` /
// `frappe.boot` at call time (runtime), by which point provide + the boot merge
// have run — so eval order vs. provide is safe. Guards window.frappe itself so
// it doesn't depend on provide having run first.

import { format } from "@/boot/format"

declare const $: any

export function installTranslate() {
	if (!window.frappe) window.frappe = {}

	// for translation
	frappe._ = function (txt: string, replace?: any, context: string | null = null) {
		if (!txt) return txt
		if (typeof txt != "string") return txt

		let translated_text = ""

		let key = txt // txt.replace(/\n/g, "");
		if (context) {
			translated_text = frappe._messages[`${key}:${context}`]
		}

		if (!translated_text) {
			translated_text = frappe._messages[key] || txt
		}

		if (replace && typeof replace === "object") {
			translated_text = format(translated_text, replace)
		}
		return translated_text
	}

	window.__ = frappe._

	frappe.get_languages = function () {
		if (!frappe.languages) {
			frappe.languages = []
			$.each(frappe.boot.lang_dict, function (lang: string, value: string) {
				frappe.languages.push({ label: lang, value: value })
			})
			frappe.languages = frappe.languages.sort(function (a: any, b: any) {
				return a.value < b.value ? -1 : 1
			})
		}
		return frappe.languages
	}
}
