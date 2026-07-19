// Contract tests for the workspace rail's data layer (getWorkspaceRail.ts), the
// Vue port of workspace_dock.js + the selector helpers it reads off the legacy
// Sidebar. They pin the behaviours that are easy to regress: which app the rail
// belongs to, which workspaces that app offers, and where each cell lands.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

// getSidebar renders icons through frappe-ui's `Icon`; the rail only cares that
// an icon component comes back, so keep the real component out of the suite.
vi.mock('frappe-ui/icons', () => ({ Icon: { name: 'Icon', render: () => null } }))

const USER = 'alice@example.com'

function slug(name: string) {
	return (name || '').toLowerCase().replace(/ /g, '-')
}

function installFrappe(overrides: Record<string, any> = {}) {
	const workspaces = [
		{ name: 'Stock', title: 'Stock', icon: 'package', public: 1, standard: 1, app: 'erpnext' },
		{ name: 'Accounting', icon: 'accounting', public: 1, standard: 1, app: 'erpnext' },
		{ name: 'Build', icon: 'tool', public: 1, standard: 1, app: 'frappe' },
		// pinned into erpnext's rail by the add_app_to_rail hook
		{ name: 'GST', icon: 'receipt', public: 1, standard: 1, app: 'india_compliance' },
		// public but user-created -> belongs to no app's list
		{ name: 'Custom Hub', icon: 'star', public: 1, standard: 0, app: null },
		{ name: 'My Notes', icon: 'file', public: 0, standard: 0, for_user: USER },
	]

	;(globalThis as any).frappe = {
		session: { user: USER },
		router: { slug, on: () => {} },
		get_route: () => [],
		workspaces: Object.fromEntries(workspaces.map((w) => [slug(w.name), w])),
		boot: {
			user_workspaces: [],
			app_rail_host: { india_compliance: 'erpnext' },
			app_data: [
				{
					app_name: 'frappe',
					app_title: 'Frappe',
					app_logo_url: '/frappe.svg',
					workspaces: ['Build'],
				},
				{
					app_name: 'erpnext',
					app_title: 'ERPNext',
					app_logo_url: '/erpnext.svg',
					// GST is folded in server-side (get_app_rail_map)
					workspaces: ['Stock', 'Accounting', 'GST'],
				},
			],
			workspace_sidebar_item: {
				stock: {
					label: 'Stock',
					app: 'erpnext',
					items: [
						{ type: 'Section Break', label: 'Items' },
						{ type: 'Link', link_type: 'DocType', link_to: 'Item', label: 'Item' },
					],
				},
				// no items -> a cell has to fall back to the workspace's own page
				accounting: { label: 'Accounting', app: 'erpnext', items: [] },
				gst: { label: 'GST', app: 'india_compliance', items: [] },
				build: { label: 'Build', app: 'frappe', items: [] },
				'custom hub': { label: 'Custom Hub', items: [] },
			},
			...(overrides.boot ?? {}),
		},
		...overrides,
	}
}

// Fresh module state per test: getSidebar's `sidebar` is a singleton whose
// computeds only re-run when the active sidebar changes.
async function load(activeSidebar?: string) {
	vi.resetModules()
	const { useWorkspaceRail } = await import('@/composables/getWorkspaceRail')
	const { useWorkspaceSidebar } = await import('@/composables/getSidebar')
	const { sidebar } = useWorkspaceSidebar()
	if (activeSidebar) sidebar.setup(activeSidebar)
	return useWorkspaceRail()
}

beforeEach(() => installFrappe())

describe('useWorkspaceRail', () => {
	it('lists the workspaces of the app whose sidebar is on screen', async () => {
		const { app, workspaces } = await load('Stock')

		expect(app.value?.app_name).toBe('erpnext')
		expect(workspaces.value.map((w) => w.label)).toEqual([
			'Stock',
			'Accounting',
			'GST',
			// public custom workspaces belong to no app list, so they're appended…
			'Custom Hub',
			// …then the user's private ones
			'My Notes',
		])
		// another app's workspace never leaks in
		expect(workspaces.value.map((w) => w.name)).not.toContain('Build')
	})

	it('highlights only the workspace whose sidebar is shown', async () => {
		const { workspaces } = await load('Stock')

		expect(workspaces.value.filter((w) => w.active).map((w) => w.name)).toEqual(['Stock'])
	})

	it('lands on the workspace’s first sidebar link, else its own page', async () => {
		const { workspaces } = await load('Stock')
		const to = Object.fromEntries(workspaces.value.map((w) => [w.name, w.to]))

		expect(to['Stock']).toBe('/item') // first link, skipping the Section Break
		expect(to['Accounting']).toBe('/accounting') // no links -> workspace page
		expect(to['My Notes']).toBe('/private/my-notes') // private workspaces are prefixed
	})

	it('resolves a companion app to the host app it is pinned into', async () => {
		// GST belongs to india_compliance, which `add_app_to_rail` pins into erpnext,
		// so the rail stays erpnext's rather than flipping to a shell of its own.
		const { app, workspaces } = await load('GST')

		expect(app.value?.app_name).toBe('erpnext')
		expect(workspaces.value.filter((w) => w.active).map((w) => w.name)).toEqual(['GST'])
		expect(workspaces.value.map((w) => w.name)).toContain('Stock')
	})

	it('treats the user’s curated selection as authoritative', async () => {
		installFrappe({ boot: { user_workspaces: ['Build', 'Stock'] } })
		const { workspaces } = await load('Stock')

		// exactly the curated set, in its order — no appless-custom or private extras
		expect(workspaces.value.map((w) => w.name)).toEqual(['Build', 'Stock'])
	})

	it('gives a custom workspace no app context, and falls back for the logo', async () => {
		const { app, logo } = await load('Custom Hub')

		expect(app.value).toBeNull()
		expect(logo.value.url).toBe('/frappe.svg')
	})

	// The page-level opt-out (PageShell's `hideWorkspaceDock`), the port of
	// Sidebar.page_hides_dock.
	describe('page opt-out', () => {
		it('hides the rail while a mounted page opts out, and only while it does', async () => {
			const { hidden } = await load('Stock')
			const { useHideWorkspaceRail } = await import('@/composables/getWorkspaceRail')
			expect(hidden.value).toBe(false)

			const hide = ref(true)
			const page = effectScope()
			page.run(() => useHideWorkspaceRail(() => hide.value))
			expect(hidden.value).toBe(true)

			hide.value = false
			await nextTick()
			expect(hidden.value).toBe(false)

			hide.value = true
			await nextTick()
			expect(hidden.value).toBe(true)

			// unmounting the page drops its opt-out
			page.stop()
			expect(hidden.value).toBe(false)
		})

		it('keeps the incoming page’s opt-out when the outgoing page tears down', async () => {
			// During a route change both PageShells are alive for a tick, and the
			// outgoing one unmounts last — a single shared flag would let its
			// teardown un-hide the rail the incoming page asked to hide.
			const { hidden } = await load('Stock')
			const { useHideWorkspaceRail } = await import('@/composables/getWorkspaceRail')

			const outgoing = effectScope()
			outgoing.run(() => useHideWorkspaceRail(() => true))
			const incoming = effectScope()
			incoming.run(() => useHideWorkspaceRail(() => true))

			outgoing.stop()
			expect(hidden.value).toBe(true)

			incoming.stop()
			expect(hidden.value).toBe(false)
		})
	})

	it('names the sidebar explicitly when a cell is clicked', async () => {
		const { workspaces } = await load('Stock')
		const { useWorkspaceSidebar } = await import('@/composables/getSidebar')
		const { sidebar } = useWorkspaceSidebar()

		workspaces.value.find((w) => w.name === 'Accounting')!.select()

		expect(sidebar.name).toBe('Accounting')
	})
})
