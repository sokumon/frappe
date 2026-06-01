import type { RouteRecordRaw } from "vue-router"
import { resolveSlug } from "./guards"

// Route ordering matters: routes with static segments (`/private`, `/view`,
// `/setup-wizard`) are scored higher than the dynamic catch-alls below them,
// so they win even though several patterns have the same segment count.
const routes: RouteRecordRaw[] = [
	{
		// home renders the Page view with an empty name; Page resolves that to
		// frappe.boot.home_page (mirrors legacy pageview.show("")).
		path: "/",
		name: "home",
		component: () => import("@/pages/Page.vue"),
		props: { name: "" },
	},
	{
		path: "/setup-wizard",
		name: "setup-wizard",
		component: () => import("@/pages/SetupWizard.vue"),
	},

	// workspaces
	{
		path: "/private/:workspace",
		name: "workspace-private",
		component: () => import("@/pages/Workspace.vue"),
		props: { isPrivate: true },
	},

	// standalone query report
	{
		path: "/query-report/:reportName",
		name: "query-report",
		component: () => import("@/pages/QueryReport.vue"),
	},

	// explicit list view, e.g. /event/view/calendar/default
	// `:rest(.*)?` captures the optional trailing path (calendar name, folder…)
	// ListView dispatches to the right view component based on :view.
	{
		path: "/:doctype/view/:view/:rest(.*)?",
		name: "list-view",
		component: () => import("@/pages/ListView.vue"),
	},

	// `:name(.+)` allows document names (and page args) that contain "/".
	// FormOrPage renders a Form when :doctype is a real doctype, otherwise a
	// Frappe Page whose trailing segments are the page's own route args
	// (e.g. /permission-manager/doctype).
	{
		path: "/:doctype/:name(.+)",
		name: "form",
		component: () => import("@/pages/FormOrPage.vue"),
	},

	// bare single segment: doctype list OR workspace – disambiguated in the
	// guard, then rendered by the dispatcher component.
	{
		path: "/:slug",
		name: "doctype-or-workspace",
		component: () => import("@/pages/DoctypeOrWorkspace.vue"),
		beforeEnter: resolveSlug,
	},

	{
		path: "/:pathMatch(.*)*",
		name: "not-found",
		component: () => import("@/pages/NotFound.vue"),
	},
]

export default routes
