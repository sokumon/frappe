// Reactive docinfo trigger for the Vue-native form sidebar.
//
// The sidebar renders from `frm.get_docinfo()` (frappe.model.docinfo[dt][dn]) and
// `frm.doc` — PLAIN objects the script-compat facades mutate in place (matching
// legacy attachments.js / assign_to.js, which do `get_docinfo().attachments = […]`).
// Plain-object mutations aren't reactive, so widgets can't `watch` them directly.
//
// Instead we keep one monotonic counter and bump it whenever a facade (or a realtime
// `docinfo_update`, or a form refresh) changes sidebar-relevant state. FormSidebar.vue
// reads `sidebarVersion()` inside each computed, so the computed re-reads the mutated
// doc/docinfo on every bump. A single global counter is enough — the form sidebar only
// ever shows one document, and keying it per-document would miss doc-to-doc navigation
// (the frm's `docname` is a plain, non-reactive property, so a per-key computed would
// keep tracking the previous document's key). `bumpSidebar` still takes the
// doctype/docname for call-site clarity; they're not used to scope the counter.
import { ref } from 'vue'

const version = ref(0)

/** Reactive read: the current sidebar version (bumps on any sidebar-state change). */
export function sidebarVersion(_doctype?: string, _docname?: string): number {
	return version.value
}

/** Signal that sidebar-relevant docinfo/doc state changed; re-renders the widgets. */
export function bumpSidebar(_doctype?: string, _docname?: string): void {
	version.value++
}
