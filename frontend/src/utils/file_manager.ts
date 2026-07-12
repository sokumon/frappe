/* Ported verbatim from frappe/public/js/frappe/utils/file_manager.js. Wrapped in an
 * install fn (see utils/index.ts) so it runs after the global `frappe` +
 * frappe.provide + jQuery are ready. Replaces the file that shipped in the
 * removed desk.bundle "framework bundle".
 *
 * frappe.file_manager (move/delete file helpers)
 *
 * Globals ($, __, frappe, locals, cint, cstr, flt, repl, ...) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installFileManager() {
frappe.provide("frappe.file_manager");

frappe.file_manager = (function () {
	let files_to_move = [];
	let old_folder = null;
	let new_folder = null;

	function cut(files, old_folder_) {
		files_to_move = files;
		old_folder = old_folder_;
	}

	function paste(new_folder_) {
		return new Promise((resolve, reject) => {
			if (files_to_move.length === 0 || !old_folder) {
				reset();
				resolve();
				return;
			}
			new_folder = new_folder_;

			frappe
				.call({
					method: "frappe.core.api.file.move_file",
					args: {
						file_list: files_to_move,
						new_parent: new_folder,
						old_parent: old_folder,
					},
					callback: (r) => {
						reset();
						resolve(r);
					},
				})
				.fail(reject);
		});
	}

	function reset() {
		files_to_move = [];
		old_folder = null;
		new_folder = null;
	}

	return {
		cut,
		paste,
		get can_paste() {
			return Boolean(files_to_move.length > 0 && old_folder);
		},
		get old_folder() {
			return old_folder;
		},
		get files_to_move() {
			return files_to_move;
		},
	};
})();

}
