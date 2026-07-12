// Script-compat facades for the Vue-native form sidebar.
//
// erpnext/frappe client scripts call `frm.attachments.*` (get_attachments,
// attachment_uploaded, remove_attachment_by_filename, …), `frm.assign_to.*`,
// `frm.shared.refresh`, `frm.tags.refresh` and `frm.sidebar.*` at module load and
// in `refresh` handlers. Legacy created these as jQuery widgets (form/sidebar/*.js)
// that both held the data and rendered the DOM. In the Vue shell the RENDERING is
// owned by FormSidebar.vue; these facades keep only the DATA + action behaviour
// (same method names/shapes so scripts keep working) and, on every change, bump the
// reactive sidebar version so FormSidebar re-derives from `frm.get_docinfo()`.
//
// Data lives where legacy kept it: `frappe.model.docinfo[dt][dn]` (assignments,
// attachments, shared, tags) and `frm.doc` (_liked_by, image field). Endpoints are
// unchanged. Interactive pickers (add-assignment, share, upload) reuse the globals
// that ARE loaded in the shell: the bridged `frappe.ui.Dialog` and
// `frappe.ui.FileUploader` (list.bundle pulls in frappe/upload.js → file_uploader).
//
// @ts-nocheck — heavy interaction with untyped `window.frappe` / jQuery globals.
import { bumpSidebar } from './sidebarStore'

declare const frappe: any
// Resolve globals lazily: this module is imported (by vueForm.ts) at Vue-app init,
// BEFORE the desk bundles (libs/list) load — so capturing `window.$`/`__`/`cint` at
// module-eval time would freeze them to `undefined`/English fallbacks. Read them at
// call time instead.
const jq = () => (window as any).$ || (window as any).jQuery
const __ = (s: string, a?: any[]) => ((window as any).__ ? (window as any).__(s, a) : s)
const cint = (v: any) => ((window as any).cint ? (window as any).cint(v) : parseInt(v) || 0)

// ---------------------------------------------------------------------------
// Attachments — port of form/sidebar/attachments.js data ops (no DOM/preview).
// ---------------------------------------------------------------------------
class AttachmentsFacade {
	frm: any
	fieldname?: string
	constructor(frm: any) {
		this.frm = frm
	}
	bump() {
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	// FormSidebar.vue renders the list; refresh() just signals a re-read.
	refresh() {
		this.bump()
	}
	get_attachments() {
		return this.frm.get_docinfo()?.attachments || []
	}
	max_reached(raise_exception = false) {
		const attachment_count = Object.keys(this.get_attachments()).length
		const attachment_limit = this.frm.meta.max_attachments
		if (attachment_limit && attachment_count >= attachment_limit) {
			if (raise_exception) {
				frappe.throw({
					title: __('Attachment Limit Reached'),
					message: __('Maximum attachment limit of {0} has been reached.', [
						String(attachment_limit).bold(),
					]),
				})
			}
			return true
		}
		return false
	}
	can_delete_attachment() {
		if (this.frm.meta.protect_attached_files) {
			switch (this.frm.doc.docstatus) {
				case 0:
					return this.frm.has_perm('write')
				case 2:
					return this.frm.has_perm('write') && this.frm.has_perm('delete')
				default:
					return false
			}
		}
		return this.frm.has_perm('write')
	}
	get_file_url(attachment: any) {
		let file_url = attachment.file_url
		if (!file_url) {
			file_url =
				attachment.file_name.indexOf('files/') === 0
					? '/' + attachment.file_name
					: '/files/' + attachment.file_name
		}
		const is_web_url = /^(https?:)?\/\//i.test(file_url)
		file_url = encodeURI(file_url)
		if (!is_web_url) file_url = file_url.replace(/#/g, '%23')
		return file_url
	}
	get_file_id_from_file_url(file_url: string) {
		let fid: any
		jq().each(this.get_attachments(), (_i: number, attachment: any) => {
			if (attachment.file_url === file_url) {
				fid = attachment.name
				return false
			}
		})
		return fid
	}
	remove_attachment_by_filename(filename: string, callback?: () => void) {
		this.remove_attachment(this.get_file_id_from_file_url(filename), callback)
	}
	remove_attachment(fileid: string, callback?: () => void) {
		if (!fileid) {
			if (callback) callback()
			return
		}
		return frappe.call({
			method: 'frappe.desk.form.utils.remove_attach',
			type: 'DELETE',
			args: { fid: fileid, dt: this.frm.doctype, dn: this.frm.docname },
			callback: (r: any) => {
				if (r.exc) {
					if (!r._server_messages) frappe.msgprint(__('There were errors'))
					return
				}
				this.remove_fileid(fileid)
				this.frm.sidebar.reload_docinfo()
				if (callback) callback()
			},
		})
	}
	// Opener registered by FormSidebar.vue so this routes to the @framework/ui
	// <FileUploadDialog>. Falls back to the legacy uploader if the sidebar isn't
	// mounted (e.g. a script uploads while the sidebar is hidden).
	_openUploader: ((opts: { fieldname?: string; imageOnly?: boolean }) => void) | null = null
	new_attachment(fieldname?: string) {
		this.fieldname = fieldname || this.fieldname
		if (this._openUploader) {
			this._openUploader({ fieldname: this.fieldname })
			return
		}
		if (this.dialog) this.dialog.$wrapper?.remove()
		const restrictions: any = {}
		if (this.frm.meta.max_attachments) {
			restrictions.max_number_of_files =
				this.frm.meta.max_attachments - this.get_attachments().length
		}
		new frappe.ui.FileUploader({
			doctype: this.frm.doctype,
			docname: this.frm.docname,
			frm: this.frm,
			folder: 'Home/Attachments',
			on_success: (file_doc: any) => this.attachment_uploaded(file_doc),
			restrictions,
			make_attachments_public: this.frm.meta.make_attachments_public,
		})
	}
	get_args() {
		return { from_form: 1, doctype: this.frm.doctype, docname: this.frm.docname }
	}
	attachment_uploaded(attachment: any) {
		this.dialog && this.dialog.hide()
		this.update_attachment(attachment)
		this.frm.sidebar.reload_docinfo()
		if (this.fieldname) this.frm.set_value(this.fieldname, attachment.file_url)
	}
	update_attachment(attachment: any) {
		if (attachment.name) {
			this.add_to_attachments(attachment)
			this.refresh()
		}
	}
	add_to_attachments(attachment: any) {
		const form_attachments = this.get_attachments()
		for (const i in form_attachments) {
			if (form_attachments[i].name === attachment.name) return
		}
		form_attachments.push(attachment)
	}
	remove_fileid(fileid: string) {
		const attachments = this.get_attachments()
		const new_attachments = attachments.filter((a: any) => a.name != fileid)
		const docinfo = this.frm.get_docinfo()
		if (docinfo) docinfo.attachments = new_attachments
		this.refresh()
	}
	dialog: any = null
}

// ---------------------------------------------------------------------------
// AssignTo — port of form/sidebar/assign_to.js data ops + add/remove.
// ---------------------------------------------------------------------------
class AssignToFacade {
	frm: any
	assign_dialog: any = null
	constructor(frm: any) {
		this.frm = frm
	}
	refresh() {
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	// legacy render(assignments) stored them on docinfo; keep that so scripts that
	// call frm.assign_to.render(list) after their own xcall stay in sync.
	render(assignments: any[]) {
		const docinfo = this.frm.get_docinfo()
		if (docinfo) docinfo.assignments = assignments
		this.refresh()
	}
	add() {
		if (this.frm.is_new()) {
			frappe.throw(__('Please save the document before assignment'))
			return
		}
		const me = this
		const d = new frappe.ui.Dialog({
			title: __('Add to ToDo'),
			fields: [
				{
					label: __('Assign to me'),
					fieldtype: 'Check',
					fieldname: 'assign_to_me',
					default: 0,
					onchange() {
						d.set_value('assign_to', d.get_value('assign_to_me') ? frappe.session.user : '')
					},
				},
				{
					fieldtype: 'Link',
					fieldname: 'assign_to',
					label: __('Assign To'),
					options: 'User',
					reqd: 1,
					get_query: () => ({
						query: 'frappe.core.doctype.user.user.user_query',
						filters: { user_type: 'System User', enabled: 1 },
					}),
				},
				{ fieldtype: 'Column Break' },
				{ label: __('Complete By'), fieldtype: 'Date', fieldname: 'date' },
				{
					label: __('Priority'),
					fieldtype: 'Select',
					fieldname: 'priority',
					// Vue SelectField expects a newline-joined string, not an array.
					options: 'Low\nMedium\nHigh',
					default: 'Medium',
				},
				{ fieldtype: 'Section Break' },
				{ label: __('Comment'), fieldtype: 'Small Text', fieldname: 'description' },
			],
			primary_action_label: __('Add'),
			primary_action(values: any) {
				if (!values || !values.assign_to) return
				return frappe
					.xcall('frappe.desk.form.assign_to.add', {
						doctype: me.frm.doctype,
						name: me.frm.docname,
						assign_to: [values.assign_to],
						description: values.description,
						date: values.date,
						priority: values.priority,
					})
					.then((assignments: any[]) => {
						me.render(assignments)
						d.hide()
					})
			},
		})
		// Prefill the comment from the doc title, matching legacy.
		if (this.frm.meta.title_field) {
			d.set_value('description', this.frm.doc[this.frm.meta.title_field])
		}
		d.show()
	}
	remove(owner: string) {
		if (this.frm.is_new()) {
			frappe.throw(__('Please save the document before removing assignment'))
			return
		}
		return frappe
			.xcall('frappe.desk.form.assign_to.remove', {
				doctype: this.frm.doctype,
				name: this.frm.docname,
				assign_to: owner,
			})
			.then((assignments: any[]) => this.render(assignments))
	}
	close(owner: string) {
		return frappe
			.xcall('frappe.desk.form.assign_to.close', {
				doctype: this.frm.doctype,
				name: this.frm.docname,
				assign_to: owner,
			})
			.then((assignments: any[]) => this.render(assignments))
	}
}

// ---------------------------------------------------------------------------
// Share — port of form/sidebar/share.js: render (bump) + show() dialog.
// ---------------------------------------------------------------------------
class ShareFacade {
	frm: any
	shared: any[] | null = null
	constructor(frm: any) {
		this.frm = frm
	}
	refresh() {
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	get_shared() {
		return this.shared || this.frm.get_docinfo()?.shared || []
	}
	show() {
		const me = this
		const d = new frappe.ui.Dialog({
			title: __('Share {0} with', [__(this.frm.doc.name)]),
			fields: [
				{
					fieldtype: 'Link',
					fieldname: 'user',
					label: __('Share With'),
					options: 'User',
					get_query: () => ({
						filters: { user_type: 'System User', name: ['!=', frappe.session.user] },
					}),
				},
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Check', fieldname: 'read', label: __('Read'), default: 1 },
				{ fieldtype: 'Check', fieldname: 'write', label: __('Write') },
				{ fieldtype: 'Check', fieldname: 'share', label: __('Share') },
			],
			primary_action_label: __('Add'),
			primary_action(values: any) {
				if (!values || !values.user) return
				return frappe
					.xcall('frappe.share.add', {
						doctype: me.frm.doctype,
						name: me.frm.doc.name,
						user: values.user,
						read: cint(values.read),
						write: cint(values.write),
						share: cint(values.share),
						notify: 1,
					})
					.then(() => {
						me.shared = null // force re-read from reloaded docinfo
						me.frm.sidebar.reload_docinfo()
						d.set_value('user', '')
					})
			},
		})
		d.show()
	}
}

// ---------------------------------------------------------------------------
// Tags facade — the Vue-native <FormTags> renders + edits tags from the reactive
// `docinfo.tags` string. Scripts call `frm.tags.refresh(user_tags)` (from the sidebar
// coordinator on every refresh, and from erpnext); keep docinfo.tags in sync and bump
// so the component re-renders. `initialized`/`refreshing` mirror the legacy TagEditor
// flags some scripts read.
// ---------------------------------------------------------------------------
function makeTagsFacade(frm: any) {
	return {
		initialized: true,
		refreshing: false,
		refresh(user_tags?: string) {
			if (user_tags !== undefined && user_tags !== null) {
				const info = frm.get_docinfo?.()
				if (info) info.tags = user_tags
			}
			bumpSidebar(frm.doctype, frm.docname)
		},
	}
}

// ---------------------------------------------------------------------------
// Sidebar coordinator — replaces the jQuery frappe.ui.form.Sidebar. Owns the
// facades, the shared reload path, and the user-actions list.
// ---------------------------------------------------------------------------
class SidebarFacade {
	frm: any
	is_vue = true
	user_actions: any[] = []
	// Detached jQuery nodes — safe sinks for legacy/erpnext scripts that still bind to
	// `frm.sidebar.image_wrapper`/`.image_section`/`.sidebar` (e.g. image click handlers).
	// The Vue widgets own the real UI; events attached here simply never fire (Tier-3).
	sidebar: any
	image_wrapper: any
	image_section: any
	constructor(frm: any) {
		this.frm = frm
		this.sidebar = jq()('<div>')
		this.image_wrapper = jq()('<div>')
		this.image_section = jq()('<div>')
	}
	// render_form/refresh_header calls this; the sub-facades just bump the version.
	refresh() {
		// Scripts re-add their user actions on every `refresh` (e.g. workspace.js
		// add_user_action). Legacy rebuilt the sidebar each render, so clear here (this
		// runs in refresh_header, before the script `refresh` trigger repopulates).
		this.user_actions = []
		if (!this.frm.doc || this.frm.doc.__islocal) {
			bumpSidebar(this.frm.doctype, this.frm.docname)
			return
		}
		this.frm.assign_to?.refresh()
		this.frm.attachments?.refresh()
		this.frm.shared?.refresh()
		this.frm.tags?.refresh?.(this.frm.get_docinfo()?.tags)
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	// Re-fetch docinfo from the server and re-render the sidebar + timeline. Matches
	// the legacy Sidebar.reload_docinfo (used after attach/share/assignment changes).
	reload_docinfo(callback?: (docinfo: any) => void) {
		return frappe.call({
			method: 'frappe.desk.form.load.get_docinfo',
			args: { doctype: this.frm.doctype, name: this.frm.docname },
			callback: (r: any) => {
				if (callback) callback(r.docinfo)
				this.frm.timeline && this.frm.timeline.refresh()
				bumpSidebar(this.frm.doctype, this.frm.docname)
			},
		})
	}
	refresh_like() {
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	// user-actions ("Go to Workspace" / "See on Website" links). Rendered by
	// FormSidebar.vue from `user_actions`. Legacy callers treat the return value as the
	// jQuery `<a>` and chain onto it — `.add_user_action(label).attr("href", url)
	// .attr("target", "_blank")` (workspace.js) or `.on("click", fn)`. Return a
	// jQuery-like handle that writes those back onto the reactive `action`.
	add_user_action(label: string, click?: () => void) {
		const action: Record<string, any> = { label, click, href: null, target: null, html: null }
		this.user_actions.push(action)
		const bump = () => bumpSidebar(this.frm.doctype, this.frm.docname)
		bump()
		const handle: any = {
			length: 1,
			attr(key: string, val?: any) {
				if (val === undefined) return action[key]
				action[key] = val
				bump()
				return handle
			},
			on(evt: string, fn: any) {
				if (evt.split('.')[0] === 'click') action.click = fn
				return handle
			},
			html(h?: string) {
				if (h === undefined) return action.html
				action.html = h
				bump()
				return handle
			},
			text(t?: string) {
				if (t === undefined) return action.label
				action.label = t
				bump()
				return handle
			},
			addClass: () => handle,
			removeClass: () => handle,
			css: () => handle,
			appendTo: () => handle,
			find: () => handle,
		}
		return handle
	}
	clear_user_actions() {
		this.user_actions = []
		bumpSidebar(this.frm.doctype, this.frm.docname)
	}
	refresh_image() {}
}

/**
 * Create and attach the Vue-native sidebar facades onto a frm. Replaces the
 * deferred no-op stub — scripts keep calling the same methods, and FormSidebar.vue
 * renders from the same data.
 */
export function installSidebarFacades(frm: any) {
	frm.attachments = new AttachmentsFacade(frm)
	frm.assign_to = new AssignToFacade(frm)
	frm.shared = new ShareFacade(frm)
	// Tags: the Vue-native <FormTags> owns the UI; this facade holds the script-compat
	// `refresh(user_tags)` that keeps docinfo.tags in sync + bumps.
	frm.tags = makeTagsFacade(frm)
	// Wrap in a Proxy so unknown `frm.sidebar.*` members (deferred/rare bits of the
	// legacy Sidebar API) resolve to a safe no-op returning a detached node instead of
	// throwing — preserving the previous stub's "never break refresh" guarantee.
	const sidebar = new SidebarFacade(frm)
	frm.sidebar = new Proxy(sidebar, {
		get: (t: any, p: string) => (p in t ? t[p] : () => jq()('<div>')),
	})
	return frm.sidebar
}
