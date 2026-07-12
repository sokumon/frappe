/* Ported verbatim from frappe/public/js/frappe/dom.js (a desk.bundle file from
 * the removed "framework bundle"). Wrapped in an install fn so it runs after the
 * global frappe + frappe.provide + jQuery are ready (it uses $ at eval:
 * $(window).on(online/offline)).
 *
 * frappe.dom.* + frappe.run_serially / is_online / scrub / slug / unscrub / ellipsis / timeout / get_modal / get_data_pill / load_image / create_shadow_element / freeze/unfreeze + online/offline alerts. Also scope_page_css CSS @scope machinery.
 *
 * Globals ($, __, cstr, repl, cur_frm, frappe) resolve off window. */
/* eslint-disable */
// @ts-nocheck
export function installDom() {
// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt

// add a new dom element
frappe.provide("frappe.dom");

frappe.dom = {
	id_count: 0,
	freeze_count: 0,
	by_id: function (id) {
		return document.getElementById(id);
	},
	get_unique_id: function () {
		const id = "unique-" + frappe.dom.id_count;
		frappe.dom.id_count++;
		return id;
	},
	set_unique_id: function (ele) {
		var $ele = $(ele);
		if ($ele.attr("id")) {
			return $ele.attr("id");
		}
		var id = "unique-" + frappe.dom.id_count;
		$ele.attr("id", id);
		frappe.dom.id_count++;
		return id;
	},
	eval: function (txt) {
		if (!txt) return;
		new Function(txt)();
	},

	remove_script_and_style: function (txt) {
		const evil_tags = ["script", "style", "noscript", "title", "meta", "base", "head"];
		const unsafe_tags = ["link"];

		if (!this.unsafe_tags_regex) {
			const evil_and_unsafe_tags = evil_tags.concat(unsafe_tags);
			const regex_str = evil_and_unsafe_tags.map((t) => `<([\\s]*)${t}`).join("|");
			this.unsafe_tags_regex = new RegExp(regex_str, "im");
		}

		// if no unsafe tags are present return as is to prevent unncessary expensive parsing
		if (!txt || !this.unsafe_tags_regex.test(txt)) {
			return txt;
		}

		const parser = new DOMParser();
		const doc = parser.parseFromString(txt, "text/html");
		const body = doc.body;
		let found = !!doc.head.innerHTML;

		for (const tag of evil_tags) {
			for (const element of body.getElementsByTagName(tag)) {
				found = true;
				element.parentNode.removeChild(element);
			}
		}

		for (const element of body.getElementsByTagName("link")) {
			const relation = element.getAttribute("rel");
			if (relation && relation.toLowerCase().trim() === "stylesheet") {
				found = true;
				element.parentNode.removeChild(element);
			}
		}

		if (found) {
			return body.innerHTML;
		} else {
			// don't disturb
			return txt;
		}
	},
	is_element_in_viewport: function (el, tolerance = 0) {
		//special bonus for those using jQuery
		if (typeof jQuery === "function" && el instanceof jQuery) {
			el = el[0];
		}

		var rect = el.getBoundingClientRect();

		return (
			rect.top + tolerance >= 0 &&
			rect.left + tolerance >= 0 &&
			rect.bottom - tolerance <= $(window).height() &&
			rect.right - tolerance <= $(window).width()
		);
	},

	is_element_in_modal(element) {
		return Boolean($(element).parents(".modal").length);
	},

	set_style: function (txt, id) {
		if (!txt) return;

		var se = document.createElement("style");
		se.type = "text/css";

		if (id) {
			var element = document.getElementById(id);
			if (element) {
				element.parentNode.removeChild(element);
			}
			se.id = id;
		}

		if (se.styleSheet) {
			se.styleSheet.cssText = txt;
		} else {
			se.appendChild(document.createTextNode(txt));
		}
		document.getElementsByTagName("head")[0].appendChild(se);
		return se;
	},
	// Wrap legacy page CSS (frappe.views.Page#pagedoc.style, injected via set_style)
	// so it participates in the same CSS @scope as the desk bundle — see
	// scss/desk/new_index.scss: `@scope (.old-desk-view, .modal) to (.tw)`.
	//
	// Why: in the Vue shell the desk's Bootstrap/component styles are scoped, which
	// gives them scope-proximity precedence in the cascade. Unscoped page CSS sits at
	// "infinite" proximity, so it loses every equal-specificity collision to a scoped
	// desk rule (e.g. .navbar beating a page's .navbar-container). Sharing the scope
	// root makes proximity tie, so source order decides again — and page CSS is
	// injected after the bundle, so it wins, exactly as before @scope existed.
	//
	// Two transforms are applied before wrapping, because native CSS and @scope don't
	// mix the way authored page CSS expects:
	//
	// 1. FLATTEN native nesting (`&`). Inside an @scope body the nesting selector `&`
	//    resolves to `:where(:scope)` (the scope root, at ZERO specificity), NOT to the
	//    parent rule's selector. So `.desktop-modal { & .modal-dialog { … } }` would
	//    degrade from `.desktop-modal .modal-dialog` (0,2,0) to roughly
	//    `:where(:scope) .modal-dialog` (0,1,0). Resolving `&` to explicit ancestor
	//    selectors up front removes every `&`, preserving meaning and specificity.
	//
	// 2. Make selectors ROOT-INCLUSIVE. Inside @scope a selector only matches elements
	//    *below* the scope root — the scope root element itself is matchable solely via
	//    `:scope`, never by a class/tag selector that happens to match it. Bootstrap
	//    appends modals to <body>, so the modal element IS the `.modal` scope root; a
	//    page rule like `.desktop-modal .modal-dialog .modal-content { … }` (whose lead
	//    compound `.desktop-modal` targets that root) therefore matches NOTHING. For
	//    every selector we additionally emit a `:scope`-merged variant
	//    (`:scope.desktop-modal .modal-dialog .modal-content`) so root-targeting rules
	//    apply; the variant is harmless for descendant-targeting rules (it just won't
	//    match anything). Verified against Chrome's @scope implementation.
	//
	// Caveat handled here: top-level "global" rules can't live inside @scope, because
	// the scope roots (.old-desk-view / .modal) are descendants of <html>. Rules
	// targeting :root / html / body / [data-theme], and name-defining or blockless
	// at-rules (@keyframes, @font-face, @import, …), are hoisted out and left at the
	// top level; everything else is scoped. @media/@supports/@container are split
	// recursively so their inner rules get the same treatment.
	scope_page_css: function (css) {
		if (!css || !css.trim()) return css;
		const flat = frappe.dom._flatten_nesting(css);
		const { globals, scopable } = frappe.dom._split_scopable_css(flat);
		let out = globals;
		if (scopable.trim()) {
			const rooted = frappe.dom._make_root_inclusive(scopable);
			out +=
				(out ? "\n\n" : "") + `@scope (.old-desk-view, .modal) to (.tw) {\n${rooted}\n}`;
		}
		return out;
	},
	// Resolve native CSS nesting into flat top-level rules, so no `&` (or implicit
	// descendant nesting) survives to be reinterpreted by the @scope wrapper above.
	// Each nested rule's selector is combined with its parent(s): `&` is replaced by
	// the parent selector, and a nested selector without `&` is prefixed as a
	// descendant. @media/@supports/@container groups are preserved around their
	// (flattened) contents; other at-rules (@keyframes, @font-face, …) pass through.
	_flatten_nesting: function (css) {
		const result = [];
		const walk = (body, parents) => {
			const nodes = frappe.dom._parse_css_nodes(body);
			const decls = nodes.filter((n) => n.body === null);
			// A rule's own declarations come before its nested rules, matching source.
			if (decls.length) {
				const block = decls.map((n) => n.raw).join("\n");
				result.push(
					parents && parents.length ? `${parents.join(",\n")} {\n${block}\n}` : block
				);
			}
			for (const node of nodes) {
				if (node.body === null) continue;
				if (node.is_at && /^@(media|supports|container)\b/i.test(node.prelude)) {
					const start = result.length;
					walk(node.body, parents);
					const inner = result.splice(start);
					result.push(`${node.prelude} {\n${inner.join("\n")}\n}`);
				} else if (node.is_at) {
					result.push(node.raw);
				} else {
					walk(node.body, frappe.dom._combine_selectors(parents, node.prelude));
				}
			}
		};
		walk(css, null);
		return result.join("\n");
	},
	// Combine a parent selector list with a (possibly comma-separated) child selector
	// list: substitute `&` with each parent, or prefix as a descendant when `&` is
	// absent. At the top level (no parents) the child selectors pass through unchanged.
	_combine_selectors: function (parents, prelude) {
		const children = frappe.dom._split_selector_list(prelude);
		if (!parents || !parents.length) return children;
		const out = [];
		for (const parent of parents) {
			for (const child of children) {
				out.push(
					child.indexOf("&") !== -1 ? child.replace(/&/g, parent) : `${parent} ${child}`
				);
			}
		}
		return out;
	},
	// Split a selector list on top-level commas only (ignoring commas inside () or []).
	_split_selector_list: function (sel) {
		const parts = [];
		let depth = 0;
		let cur = "";
		for (const ch of sel) {
			if (ch === "(" || ch === "[") depth++;
			else if (ch === ")" || ch === "]") depth--;
			if (ch === "," && depth === 0) {
				if (cur.trim()) parts.push(cur.trim());
				cur = "";
			} else {
				cur += ch;
			}
		}
		if (cur.trim()) parts.push(cur.trim());
		return parts;
	},
	// Rewrite each style rule's selector list so it also matches the scope root (see
	// transform #2 in scope_page_css). Recurses through @media/@supports/@container;
	// leaves at-rules and declarations untouched. Expects nesting already flattened.
	_make_root_inclusive: function (css) {
		const out = [];
		for (const node of frappe.dom._parse_css_nodes(css)) {
			if (node.body === null) {
				out.push(node.raw);
			} else if (node.is_at && /^@(media|supports|container)\b/i.test(node.prelude)) {
				out.push(`${node.prelude} {\n${frappe.dom._make_root_inclusive(node.body)}\n}`);
			} else if (node.is_at) {
				out.push(node.raw);
			} else {
				const selectors = frappe.dom
					._split_selector_list(node.prelude)
					.map((s) => frappe.dom._root_inclusive_selector(s))
					.join(",\n");
				out.push(`${selectors} {\n${node.body}\n}`);
			}
		}
		return out.join("\n");
	},
	// Given one complex selector, return it plus a `:scope`-merged variant whose lead
	// compound is anchored to the scope root, e.g.
	// `.desktop-modal .modal-dialog` → `.desktop-modal .modal-dialog, :scope.desktop-modal .modal-dialog`.
	// Selectors that already reference :scope, or start with a combinator or universal
	// `*` (nothing sensible to merge onto), are returned unchanged.
	_root_inclusive_selector: function (sel) {
		sel = sel.trim();
		if (!sel || /:scope\b/.test(sel) || /^[>+~]/.test(sel)) return sel;
		const { lead, rest } = frappe.dom._split_leading_compound(sel);
		if (!lead || lead[0] === "*") return sel;
		return `${sel}, :scope${lead}${rest}`;
	},
	// Split a complex selector into its leading compound and the remainder (starting at
	// the first top-level combinator — descendant space, >, + or ~). Combinators inside
	// () or [] are ignored.
	_split_leading_compound: function (sel) {
		let depth = 0;
		for (let i = 0; i < sel.length; i++) {
			const c = sel[i];
			if (c === "(" || c === "[") depth++;
			else if (c === ")" || c === "]") depth--;
			else if (
				depth === 0 &&
				(c === " " || c === "\t" || c === "\n" || c === ">" || c === "+" || c === "~")
			) {
				return { lead: sel.slice(0, i), rest: sel.slice(i) };
			}
		}
		return { lead: sel, rest: "" };
	},
	_split_scopable_css: function (css) {
		const globals = [];
		const scopable = [];
		for (const node of frappe.dom._parse_css_nodes(css)) {
			if (node.is_at && /^@(media|supports|container)\b/i.test(node.prelude)) {
				// Conditional group rule: split its body so inner globals stay global
				// (still gated by the condition) and inner rules get scoped.
				const inner = frappe.dom._split_scopable_css(node.body);
				if (inner.globals.trim()) globals.push(`${node.prelude} {\n${inner.globals}\n}`);
				if (inner.scopable.trim())
					scopable.push(`${node.prelude} {\n${inner.scopable}\n}`);
			} else if (node.is_at) {
				// @keyframes / @font-face / @import / @charset / @property / @page /
				// @layer / @namespace / anything else → must stay at the top level.
				globals.push(node.raw);
			} else if (frappe.dom._selector_targets_root(node.prelude)) {
				globals.push(node.raw);
			} else {
				scopable.push(node.raw);
			}
		}
		return { globals: globals.join("\n"), scopable: scopable.join("\n") };
	},
	// Tokenize the top level of a stylesheet into rules, skipping comments and
	// strings. Returns { is_at, prelude, body, raw } per node (body is null for
	// blockless at-rules like `@import "...";`).
	_parse_css_nodes: function (css) {
		const nodes = [];
		const n = css.length;
		let i = 0;
		const skip_string = (pos) => {
			const quote = css[pos++];
			while (pos < n) {
				if (css[pos] === "\\") pos += 2;
				else if (css[pos] === quote) return pos + 1;
				else pos++;
			}
			return pos;
		};
		const skip_comment = (pos) => {
			const end = css.indexOf("*/", pos + 2);
			return end === -1 ? n : end + 2;
		};
		while (i < n) {
			if (/\s/.test(css[i])) {
				i++;
				continue;
			}
			if (css[i] === "/" && css[i + 1] === "*") {
				i = skip_comment(i);
				continue;
			}
			const start = i;
			let brace = -1;
			let semi = -1;
			while (i < n) {
				const c = css[i];
				if (c === "/" && css[i + 1] === "*") {
					i = skip_comment(i);
					continue;
				}
				if (c === '"' || c === "'") {
					i = skip_string(i);
					continue;
				}
				if (c === "{") {
					brace = i;
					break;
				}
				if (c === ";") {
					semi = i;
					break;
				}
				i++;
			}
			if (brace === -1 && semi === -1) {
				const raw = css.slice(start).trim();
				if (raw) nodes.push({ is_at: raw[0] === "@", prelude: raw, body: null, raw });
				break;
			}
			if (semi !== -1 && (brace === -1 || semi < brace)) {
				// blockless statement, e.g. `@import "x";` (keep the trailing ';')
				const raw = css.slice(start, semi + 1).trim();
				i = semi + 1;
				nodes.push({
					is_at: raw[0] === "@",
					prelude: css.slice(start, semi).trim(),
					body: null,
					raw,
				});
				continue;
			}
			// block rule: walk to the matching close brace
			const prelude = css.slice(start, brace).trim();
			let depth = 1;
			i = brace + 1;
			const body_start = i;
			while (i < n && depth > 0) {
				const c = css[i];
				if (c === "/" && css[i + 1] === "*") {
					i = skip_comment(i);
					continue;
				}
				if (c === '"' || c === "'") {
					i = skip_string(i);
					continue;
				}
				if (c === "{") depth++;
				else if (c === "}") depth--;
				i++;
			}
			const body = css.slice(body_start, depth === 0 ? i - 1 : i);
			const raw = css.slice(start, i).trim();
			nodes.push({ is_at: prelude[0] === "@", prelude, body, raw });
		}
		return nodes;
	},
	// A style rule must stay unscoped when any selector in its list targets the
	// document root or an ancestor of the scope root — :root, html, body, or the
	// [data-theme] attribute Frappe sets on <html>. Those subjects live above
	// .old-desk-view, so they can never match from inside @scope.
	_selector_targets_root: function (selector) {
		return selector.split(",").some((sel) => {
			const s = sel.trim();
			return (
				/^(html|body)(\s|,|\.|#|\[|:|>|\+|~|$)/i.test(s) ||
				/^:root(\s|,|\.|#|\[|:|>|\+|~|$)/i.test(s) ||
				/^\[data-theme/i.test(s)
			);
		});
	},
	add: function (parent, newtag, className, cs, innerHTML, onclick) {
		if (parent && parent.substr) parent = frappe.dom.by_id(parent);
		var c = document.createElement(newtag);
		if (parent) parent.appendChild(c);

		// if image, 3rd parameter is source
		if (className) {
			if (newtag.toLowerCase() == "img") c.src = className;
			else c.className = className;
		}
		if (cs) frappe.dom.css(c, cs);
		if (innerHTML) c.innerHTML = innerHTML;
		if (onclick) c.onclick = onclick;
		return c;
	},
	css: function (ele, s) {
		if (ele && s) {
			$.extend(ele.style, s);
		}
		return ele;
	},
	activate: function ($parent, $child, common_class, active_class = "active") {
		$parent.find(`.${common_class}.${active_class}`).removeClass(active_class);
		$child.addClass(active_class);
	},
	freeze: function (msg, css_class) {
		// blur
		if (!$("#freeze").length) {
			var freeze = $('<div id="freeze" class="modal-backdrop fade"></div>')
				.on("click", function () {
					if (cur_frm && cur_frm.cur_grid) {
						cur_frm.cur_grid.toggle_view();
						return false;
					}
				})
				.appendTo("#body");

			freeze.html(
				repl(
					'<div class="freeze-message-container"><div class="freeze-message"><p class="lead">%(msg)s</p></div></div>',
					{ msg: msg || "" }
				)
			);

			setTimeout(function () {
				freeze.addClass("in");
			}, 1);
		} else {
			$("#freeze").addClass("in");
		}

		if (css_class) {
			$("#freeze").addClass(css_class);
		}

		frappe.dom.freeze_count++;
	},
	unfreeze: function () {
		if (!frappe.dom.freeze_count) return; // anything open?
		frappe.dom.freeze_count--;
		if (!frappe.dom.freeze_count) {
			var freeze = $("#freeze").removeClass("in").remove();
		}
	},
	save_selection: function () {
		// via http://stackoverflow.com/questions/5605401/insert-link-in-contenteditable-element
		if (window.getSelection) {
			var sel = window.getSelection();
			if (sel.getRangeAt && sel.rangeCount) {
				var ranges = [];
				for (var i = 0, len = sel.rangeCount; i < len; ++i) {
					ranges.push(sel.getRangeAt(i));
				}
				return ranges;
			}
		} else if (document.selection && document.selection.createRange) {
			return document.selection.createRange();
		}
		return null;
	},
	restore_selection: function (savedSel) {
		if (savedSel) {
			if (window.getSelection) {
				var sel = window.getSelection();
				sel.removeAllRanges();
				for (var i = 0, len = savedSel.length; i < len; ++i) {
					sel.addRange(savedSel[i]);
				}
			} else if (document.selection && savedSel.select) {
				savedSel.select();
			}
		}
	},
	is_touchscreen: function () {
		return "ontouchstart" in window;
	},
	handle_broken_images(container) {
		$(container)
			.find("img")
			.on("error", (e) => {
				const $img = $(e.currentTarget);
				$img.addClass("no-image");
			});
	},
	scroll_to_bottom(container) {
		const $container = $(container);
		$container.scrollTop($container[0].scrollHeight);
	},
	file_to_base64(file_obj) {
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = function () {
				resolve(reader.result);
			};
			reader.readAsDataURL(file_obj);
		});
	},
	scroll_to_section(section_name) {
		setTimeout(() => {
			const section = $(`a:contains("${section_name}")`);
			if (section.length) {
				if (section.parent().hasClass("collapsed")) {
					// opens the section
					section.click();
				}
				frappe.ui.scroll(section.parent().parent());
			}
		}, 200);
	},
	pixel_to_inches(pixels) {
		const div = $(
			'<div id="dpi" style="height: 1in; width: 1in; left: 100%; position: fixed; top: 100%;"></div>'
		);
		div.appendTo(document.body);

		const dpi_x = document.getElementById("dpi").offsetWidth;
		const inches = pixels / dpi_x;
		div.remove();

		return inches;
	},
};

frappe.ellipsis = function (text, max) {
	if (!max) max = 20;
	text = cstr(text);
	if (text.length > max) {
		text = text.substr(0, max) + "...";
	}
	return text;
};

frappe.run_serially = function (tasks) {
	var result = Promise.resolve();
	tasks.forEach((task) => {
		if (task) {
			result = result.then ? result.then(task) : Promise.resolve();
		}
	});
	return result;
};

frappe.load_image = (src, onload, onerror, preprocess = () => {}) => {
	var tester = new Image();
	tester.onload = function () {
		onload(this);
	};
	tester.onerror = onerror;

	preprocess(tester);
	tester.src = src;
};

frappe.timeout = (seconds) => {
	return new Promise((resolve) => {
		setTimeout(() => resolve(), seconds * 1000);
	});
};

frappe.scrub = frappe.slug = function (text, spacer = "_") {
	return text.replace(/ /g, spacer).toLowerCase();
};

frappe.unscrub = function (txt) {
	return frappe.model.unscrub(txt);
};

frappe.get_data_pill = (
	label,
	target_id = null,
	remove_action = null,
	image = null,
	colored = false
) => {
	let color = "",
		style = "";
	if (colored) {
		color = frappe.get_palette(label);
		style = `background-color: var(${color[0]}); color: var(${color[1]})`;
	}
	let data_pill_wrapper = $(`
		<button class="data-pill btn" style="${style}">
			<div class="flex align-center ellipsis">
				${image ? image : ""}
				<span class="pill-label ellipsis">${label} </span>
			</div>
		</button>
	`);
	if (remove_action) {
		let remove_btn = $(`
			<span class="remove-btn cursor-pointer flex align-items-center">
				${frappe.utils.icon("x", "sm")}
			</span>
		`);
		if (typeof remove_action === "function") {
			remove_btn.click(() => {
				remove_action(target_id || label, data_pill_wrapper);
			});
		}
		data_pill_wrapper.append(remove_btn);
	}
	return data_pill_wrapper;
};

frappe.get_modal = function (title, content) {
	return $(`<div class="modal fade" style="overflow: auto;" tabindex="-1">
		<div class="modal-dialog">
			<div class="modal-content">
				<div class="modal-header">
					<div class="fill-width flex title-section">
						<span class="indicator hidden"></span>
						<h4 class="modal-title">${title}</h4>
					</div>
					<div class="modal-actions d-flex">
						<button class="btn btn-ghost btn-modal-minimize icon-btn hide">
							${frappe.utils.icon("minimize-2")}
						</button>
						<button class="btn btn-ghost btn-modal-close icon-btn" data-dismiss="modal">
							${frappe.utils.icon("x", "sm")}
						</button>
					</div>
				</div>
				<div class="modal-body ui-front">${content}</div>
				<div class="modal-footer hide">
					<div class="custom-actions"></div>
					<div class="standard-actions">
						<button type="button" class="btn btn-secondary btn-sm hide btn-modal-secondary">
						</button>
						<button type="button" class="btn btn-primary btn-sm hide btn-modal-primary">
							${__("Confirm")}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>`);
};

frappe.is_online = function () {
	if (frappe.boot.developer_mode == 1) {
		// always online in developer_mode
		return true;
	}
	if ("onLine" in navigator) {
		return navigator.onLine;
	}
	return true;
};

frappe.create_shadow_element = function (wrapper, html, css, js) {
	let random_id = "custom-block-" + frappe.utils.get_random(5).toLowerCase();

	class CustomBlock extends HTMLElement {
		constructor() {
			super();

			// html
			let div = document.createElement("div");
			div.innerHTML = frappe.dom.remove_script_and_style(html);

			// link global desk css
			let link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = frappe.assets.bundled_asset("desk.bundle.css");

			// css
			let style = document.createElement("style");
			style.textContent = css;

			// javascript
			let script = document.createElement("script");
			script.textContent = `
				(function() {
					let cname = ${JSON.stringify(random_id)};
					let root_element = document.querySelector(cname).shadowRoot;
					${js}
				})();
			`;

			this.attachShadow({ mode: "open" });
			this.shadowRoot?.appendChild(link);
			this.shadowRoot?.appendChild(div);
			this.shadowRoot?.appendChild(style);
			this.shadowRoot?.appendChild(script);
		}
	}

	if (!customElements.get(random_id)) {
		customElements.define(random_id, CustomBlock);
	}
	wrapper.innerHTML = `<${random_id}></${random_id}>`;
};

// bind online/offline events
$(window).on("online", function () {
	if (document.hidden) return;
	frappe.show_alert({
		indicator: "green",
		message: __("You are connected to internet."),
	});
});

$(window).on("offline", function () {
	if (document.hidden) return;
	frappe.show_alert({
		indicator: "orange",
		message: __("Connection lost. Some features might not work."),
	});
});

}
