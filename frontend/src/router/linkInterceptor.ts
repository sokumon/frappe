// Global click-capture that turns plain `<a href="/newdesk/…">` clicks into
// vue-router push-state navigation. Lots of legacy desk code (list rows, the
// sidebar, form links, comments) renders raw anchors with `/newdesk/…` hrefs
// when `frappe.vue_shell` is set; without this, every such click is a full
// page reload. This is the vue-shell equivalent of the legacy
// `$("body").on("click", "a", …)` handler in `frappe/public/js/.../router.js`.

import type { Router } from "vue-router"
import { APP_PREFIX } from "@/config"

function isInternal(pathname: string): boolean {
	return pathname === APP_PREFIX || pathname.startsWith(APP_PREFIX + "/")
}

export function installLinkInterceptor(router: Router) {
	document.addEventListener("click", (e) => {
		// a component handler already acted on this click
		if (e.defaultPrevented) return
		// only plain left-clicks — modifiers mean "open in new tab/window"
		if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return

		const anchor = (e.target as Element | null)?.closest?.("a")
		if (!anchor) return

		// delegate the external-link confirmation to the legacy helper if present
		if (window.frappe?.router?.show_external_link_warning_if_needed?.(anchor)) {
			e.preventDefault()
			return
		}

		// explicit opt-outs (mirrors the legacy guards)
		if (anchor.target && anchor.target !== "_self") return // _blank, etc.
		if (anchor.hasAttribute("download")) return
		if (anchor.getAttribute("onclick")) return // anchor has its own handler
		const rel = anchor.getAttribute("rel")
		if (rel && /\bexternal\b/.test(rel)) return

		const href = anchor.getAttribute("href")
		if (!href || href.startsWith("#")) return // pure hash / home sentinel

		// external host → let the browser navigate
		if (anchor.hostname !== window.location.hostname) return

		// only links under the SPA base are ours; anything else (legacy /app or
		// /desk desk, server-rendered pages) gets a real browser navigation
		if (!isInternal(anchor.pathname)) return

		e.preventDefault()
		// strip the base — vue-router re-adds it; search/hash round-trip through
		// the router's own parseQuery codec
		const to = anchor.pathname.slice(APP_PREFIX.length) + anchor.search + anchor.hash
		router.push(to || "/")
	})
}
