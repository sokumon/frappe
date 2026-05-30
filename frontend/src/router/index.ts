import { createRouter, createWebHistory } from "vue-router"
import type { LocationQuery, LocationQueryRaw } from "vue-router"
import { APP_PREFIX } from "@/config"
import routes from "./routes"
import { gate } from "./guards"
import { installCompat, syncCompatState } from "./compat"

// ---------------------------------------------------------------------------
// query codec
//
// Legacy `frappe.route_options` routinely holds objects/arrays (list filters),
// which the old router serialised as JSON. We keep that behaviour so those
// values survive a round-trip, while leaving plain scalar params untouched so
// ordinary URLs stay readable.
// ---------------------------------------------------------------------------

function parseQuery(search: string): LocationQuery {
	const out: Record<string, any> = {}
	const params = new URLSearchParams(search)
	params.forEach((value, key) => {
		// only attempt JSON for things that clearly are JSON (object/array/string)
		if (/^[{["]/.test(value)) {
			try {
				out[key] = JSON.parse(value)
				return
			} catch {
				// fall through, keep raw
			}
		}
		out[key] = value
	})
	return out as LocationQuery
}

function stringifyQuery(query: LocationQueryRaw): string {
	const parts: string[] = []
	for (const key in query) {
		const value = query[key]
		if (value === undefined || value === null) continue
		const encoded = typeof value === "object" ? JSON.stringify(value) : String(value)
		parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`)
	}
	return parts.join("&")
}

const router = createRouter({
	history: createWebHistory(APP_PREFIX),
	routes,
	parseQuery,
	stringifyQuery,
})

// setup-wizard / rename gate runs first on every navigation
router.beforeEach(gate)

// keep the legacy frappe.* surface in sync after each successful navigation
router.afterEach((to, _from, failure) => {
	if (failure) return
	syncCompatState(to)
})

// install frappe.set_route / get_route / route_options / emitter shims
installCompat(router)

export default router
