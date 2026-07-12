/* Modernized port of frappe/public/js/frappe/request.js (a desk.bundle file from
 * the removed "framework bundle").
 *
 * WHAT CHANGED vs the legacy file:
 *   - The transport is no longer jQuery `$.ajax`. `frappe.request.call` now drives
 *     frappe-ui's `createResource` over a custom `resourceFetcher` (native fetch).
 *     A legacy `async: false` caller still gets a synchronous XMLHttpRequest path.
 *   - All the surrounding semantics are preserved verbatim: `frappe.call` /
 *     `frappe.xcall` signatures, the full response envelope is kept (so
 *     `frappe.model.sync(data)`, `__messages`, `_link_titles`, `task_id` async
 *     subscribe, `_server_messages` / `exc` handling in cleanup all still work),
 *     the per-status handlers, exception handlers, error dialog, `on_error`
 *     registry, and `after_ajax` / `after_server_call` (ajax_count is now tracked
 *     manually around fetch since jQuery's ajaxSend/ajaxComplete don't see fetch).
 *   - `frappe.call(...)` still returns a Promise that resolves to the full
 *     response `data` (callers do `.then((r) => r.message)`); `.abort()` is
 *     attached to that promise for `query_report`'s last_ajax.abort().
 *   - Trivial jQuery utils swapped for native ($.extend -> Object.assign,
 *     $.isArray -> Array.isArray, $.isPlainObject/$.isArray -> typeof object,
 *     $.each -> forEach). The peripheral DOM bits (freeze, btn disable,
 *     body[data-ajax-state]) stay on jQuery — those are not the request core.
 *
 * TIMING: registers `$(document).ajaxSend/ajaxComplete` at eval, so installs
 * after libs (jQuery). frappe.call is used at runtime by controls/erpnext, and
 * request.call uses frappe.model / frappe.utils / frappe.dom at runtime — all
 * present by then. main.ts installs it at the model seam.
 *
 * Globals ($, __, cint, strip, frappe) resolve off window. */
/* eslint-disable */
// @ts-nocheck
import { createResource } from "frappe-ui"

export function installRequest() {
// My HTTP Request

frappe.provide("frappe.request");
frappe.provide("frappe.request.error_handlers");
frappe.request.url = "/";
frappe.request.ajax_count = 0;
frappe.request.waiting_for_ajax = [];
frappe.request.logs = {};

// Apps opt into native `application/json` request bodies (instead of
// form-encoding per-key JSON-stringified values) by setting
// `use_json_request_body = True` in their `hooks.py`.
frappe.request.app_uses_json = function (cmd) {
	if (!cmd) return false;
	let app = cmd === "run_doc_method" ? "frappe" : cmd.split(".")[0];
	let apps = (frappe.boot && frappe.boot.json_request_apps) || [];
	return apps.includes(app);
};

frappe.xcall = function (method, params, type, opts = {}) {
	return new Promise((resolve, reject) => {
		frappe.call({
			method: method,
			args: params,
			type: type || "POST",
			callback: (r) => {
				resolve(r.message);
			},
			error: (r) => {
				reject(r?.message);
			},
			...opts,
		});
	});
};

// generic server call (call page, object)
frappe.call = function (opts) {
	if (!frappe.is_online()) {
		frappe.show_alert(
			{
				indicator: "orange",
				message: __("Connection Lost"),
				subtitle: __("You are not connected to Internet. Retry after sometime."),
			},
			3
		);
	}
	if (typeof arguments[0] === "string") {
		opts = {
			method: arguments[0],
			args: arguments[1],
			callback: arguments[2],
			headers: arguments[3],
		};
	}

	if (opts.quiet) {
		opts.no_spinner = true;
	}
	var args = Object.assign({}, opts.args);

	// cmd
	if (opts.module && opts.page) {
		args.cmd = opts.module + ".page." + opts.page + "." + opts.page + "." + opts.method;
	} else if (opts.doc) {
		Object.assign(args, {
			cmd: "run_doc_method",
			docs: frappe.get_doc(opts.doc.doctype, opts.doc.name),
			method: opts.method,
			args: opts.args,
		});
	} else if (opts.method) {
		args.cmd = opts.method;
	}

	// Pick the request body encoding from the app that owns the endpoint, unless
	// the caller explicitly set `opts.json` as an escape hatch.
	let json = opts.json != null ? opts.json : frappe.request.app_uses_json(args.cmd);

	var callback = function (data, response_text) {
		if (data.task_id) {
			// async call, subscribe
			frappe.realtime.subscribe(data.task_id, opts);

			if (opts.queued) {
				opts.queued(data);
			}
		} else if (opts.callback) {
			// ajax
			return opts.callback(data, response_text);
		}
	};

	let url = opts.url;
	if (!url) {
		let prefix = "/api/method/";
		if (opts.api_version) {
			prefix = `/api/${opts.api_version}/method/`;
		}
		url = prefix + args.cmd;
		delete args.cmd;
	}

	// debouce if required
	if (opts.debounce && frappe.request.is_fresh(args, opts.debounce)) {
		return Promise.resolve();
	}

	return frappe.request.call({
		type: opts.type || "POST",
		args: args,
		success: callback,
		error: opts.error,
		always: opts.always,
		btn: opts.btn,
		freeze: opts.freeze,
		freeze_message: opts.freeze_message,
		headers: opts.headers || {},
		error_handlers: opts.error_handlers || {},
		async: opts.async,
		silent: opts.silent,
		api_version: opts.api_version,
		url,
		cache: opts.cache,
		json,
	});
};

frappe.request.call = function (opts) {
	// JSON body only applies to non-GET requests (GET carries no meaningful body).
	opts.use_json = opts.json && (opts.type || "POST").toUpperCase() !== "GET";

	frappe.request.prepare(opts);

	var statusCode = {
		200: function (data, xhr) {
			opts.success_callback && opts.success_callback(data, xhr.responseText);
		},
		401: function (xhr) {
			if (frappe.app.session_expired_dialog && frappe.app.session_expired_dialog.display) {
				frappe.app.redirect_to_login();
			} else {
				frappe.app.handle_session_expired();
			}
			opts.error_callback && opts.error_callback();
		},
		404: function (xhr) {
			frappe.msgprint({
				title: __("Not found"),
				indicator: "red",
				message: __("The resource you are looking for is not available"),
				re_route: true,
			});
			opts.error_callback && opts.error_callback();
		},
		403: function (xhr) {
			const user_id = document.cookie
				.split(";")
				.find((c) => c.trim().startsWith("user_id="))
				?.split("=")[1];
			if (
				user_id === "Guest" ||
				(frappe.session.user === "Guest" && frappe.session.logged_in_user !== "Guest")
			) {
				// session expired
				frappe.app.handle_session_expired();
			} else if (xhr.responseJSON && xhr.responseJSON._error_message) {
				frappe.msgprint({
					title: __("Not permitted"),
					indicator: "red",
					message: xhr.responseJSON._error_message,
					re_route: true,
				});

				xhr.responseJSON._server_messages = null;
			} else if (xhr.responseJSON && xhr.responseJSON._server_messages) {
				var _server_messages = JSON.parse(xhr.responseJSON._server_messages);

				// avoid double messages
				if (_server_messages.indexOf(__("Not permitted")) !== -1) {
					return;
				}
			} else {
				frappe.msgprint({
					title: __("Not permitted"),
					indicator: "red",
					message: __(
						"You do not have enough permissions to access this resource. Please contact your manager to get access."
					),
				});
			}
			opts.error_callback && opts.error_callback();
		},
		508: function (xhr) {
			frappe.utils.play_sound("error");
			frappe.msgprint({
				title: __("Please try again"),
				indicator: "red",
				message: __(
					"Another transaction is blocking this one. Please try again in a few seconds."
				),
			});
			opts.error_callback && opts.error_callback();
		},
		413: function (data, xhr) {
			frappe.msgprint({
				indicator: "red",
				title: __("File too big"),
				message: __("File size exceeded the maximum allowed size of {0} MB", [
					(frappe.boot.max_file_size || 5242880) / 1048576,
				]),
			});
			opts.error_callback && opts.error_callback();
		},
		417: function (xhr) {
			var r = xhr.responseJSON;
			if (!r) {
				try {
					r = JSON.parse(xhr.responseText);
				} catch (e) {
					r = xhr.responseText;
				}
			}

			opts.error_callback && opts.error_callback(r);
		},
		501: function (data, xhr) {
			if (typeof data === "string") data = JSON.parse(data);
			opts.error_callback && opts.error_callback(data, xhr.responseText);
		},
		500: function (xhr) {
			frappe.utils.play_sound("error");
			try {
				opts.error_callback && opts.error_callback();
				frappe.request.report_error(xhr, opts);
			} catch (e) {
				frappe.request.report_error(xhr, opts);
			}
		},
		504: function (xhr) {
			frappe.msgprint(__("Request Timed Out"));
			opts.error_callback && opts.error_callback();
		},
		502: function (xhr) {
			frappe.msgprint(__("Internal Server Error"));
			opts.error_callback && opts.error_callback();
		},
	};

	var exception_handlers = {
		QueryTimeoutError: function () {
			frappe.utils.play_sound("error");
			frappe.msgprint({
				title: __("Request Timeout"),
				indicator: "red",
				message: __("Server was too busy to process this request. Please try again."),
			});
		},
		QueryDeadlockError: function () {
			frappe.utils.play_sound("error");
			frappe.msgprint({
				title: __("Deadlock Occurred"),
				indicator: "red",
				message: __(
					"Server failed to process this request because of a concurrent conflicting request. Please try again."
				),
			});
		},
	};

	const method = (opts.type || "POST").toUpperCase();

	// Headers (was ajax_args.headers). jQuery set Content-Type itself; here we
	// set it explicitly per body encoding below.
	const headers = Object.assign(
		{
			"X-Frappe-CSRF-Token": frappe.csrf_token || window.csrf_token,
			Accept: "application/json",
			"X-Frappe-CMD": (opts.args && opts.args.cmd) || "",
		},
		opts.headers
	);
	if (opts.args && opts.args.doctype) {
		headers["X-Frappe-Doctype"] = encodeURIComponent(opts.args.doctype);
	}

	// URL + body per encoding. `prepare()` already JSON-stringifies object/array
	// values for the non-JSON path, so form-encoding is a flat URLSearchParams.
	let url = opts.url || frappe.request.url;
	let body = undefined;
	const to_query_string = (obj) => {
		const p = new URLSearchParams();
		for (const key in obj) {
			const v = obj[key];
			if (v === undefined) continue;
			p.append(key, v === null ? "" : v);
		}
		return p.toString();
	};
	const append_qs = (u, qs) => (qs ? u + (u.includes("?") ? "&" : "?") + qs : u);

	if (method === "GET") {
		url = append_qs(url, to_query_string(opts.args));
		// jQuery appended a cache-buster for GET unless cache was on.
		if (window.dev_server || !opts.cache) {
			url = append_qs(url, "_=" + Date.now());
		}
	} else if (opts.use_json) {
		// native JSON body instead of form-encoded args
		body = JSON.stringify(opts.args);
		headers["Content-Type"] = "application/json; charset=UTF-8";
	} else {
		body = to_query_string(opts.args);
		headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
	}

	frappe.last_request = opts.use_json ? body : opts.args;

	// Build a jqXHR-shaped shim so the (verbatim) statusCode / exception / cleanup
	// logic below works unchanged against a fetch Response or a sync XHR.
	const build_xhr = (status, responseJSON, responseText, getHeader) => ({
		status,
		responseJSON,
		responseText,
		statusCode: () => ({ status }),
		getResponseHeader: (name) => (getHeader ? getHeader(name) : null),
	});

	// ---- response processing (ported from .done / .always / .fail) ----
	const process_done = function (data, xhr) {
		try {
			if (typeof data === "string") data = JSON.parse(data);

			// sync attached docs
			if (data.docs || data.docinfo) {
				frappe.model.sync(data);
			}

			// sync translated messages
			if (data.__messages) {
				Object.assign(frappe._messages, data.__messages);
			}

			// sync link titles
			if (data._link_titles) {
				if (!frappe._link_titles) {
					frappe._link_titles = {};
				}
				Object.assign(frappe._link_titles, data._link_titles);
			}

			// callbacks
			var status_code_handler = statusCode[xhr.statusCode().status];
			if (status_code_handler) {
				status_code_handler(data, xhr);
			}
		} catch (e) {
			console.log("Unable to handle success response", data);
			console.error(e);
		}
	};

	const process_always = function (data) {
		try {
			if (typeof data === "string") {
				data = JSON.parse(data);
			}
			if (data && data.responseText) {
				data = JSON.parse(data.responseText);
			}
		} catch (e) {
			data = null;
			// pass
		}
		frappe.request.cleanup(opts, data);
		if (opts.always) {
			opts.always(data);
		}
	};

	const process_fail = function (xhr) {
		try {
			if (xhr.getResponseHeader("content-type") == "application/json" && xhr.responseText) {
				var data;
				try {
					data = JSON.parse(xhr.responseText);
				} catch (e) {
					console.log("Unable to parse reponse text");
					console.log(xhr.responseText);
					console.log(e);
				}
				if (data && data.exception) {
					// frappe.exceptions.CustomError: (1024, ...) -> CustomError
					var exception = data.exception.split(".").at(-1).split(":").at(0);
					var exception_handler = exception_handlers[exception];
					if (exception_handler) {
						exception_handler(data);
						return;
					}
				}
			}
			var status_code_handler = statusCode[xhr.statusCode().status];
			if (status_code_handler) {
				status_code_handler(xhr);
				return;
			}
			// if not handled by error handler!
			opts.error_callback && opts.error_callback(xhr);
		} catch (e) {
			console.log("Unable to handle failed response");
			console.error(e);
		}
	};

	// ---- legacy synchronous path (async: false) via native XHR ----
	if (opts.async === false) {
		const xhr = new XMLHttpRequest();
		xhr.open(method, url, false);
		for (const h in headers) xhr.setRequestHeader(h, headers[h]);
		frappe.request.ajax_count++;
		try {
			xhr.send(body);
		} catch (e) {
			// network error; fall through to cleanup below
		}
		dec_ajax_count();
		let data = null;
		try {
			data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
		} catch (e) {
			data = xhr.responseText;
		}
		const shim = build_xhr(xhr.status, data, xhr.responseText, (n) =>
			xhr.getResponseHeader(n)
		);
		try {
			if (xhr.status >= 200 && xhr.status < 300) {
				process_done(data, shim);
			} else {
				process_fail(shim);
			}
		} finally {
			process_always(data);
		}
		return Promise.resolve(data);
	}

	// ---- modern path: createResource over a native-fetch resourceFetcher ----
	let resource;
	const promise = new Promise((resolve, reject) => {
		resource = createResource({
			url,
			method,
			// full-envelope fetcher: never throws on HTTP errors (returns ok:false)
			// so status-code handling stays in process_done/process_fail; only real
			// network failures reject -> onError.
			resourceFetcher: async (fetchOpts) => {
				frappe.request.ajax_count++;
				try {
					const response = await fetch(url, {
						method,
						headers,
						body,
						credentials: "same-origin",
						signal: fetchOpts && fetchOpts.signal,
					});
					const text = await response.text();
					let data = null;
					try {
						data = text ? JSON.parse(text) : null;
					} catch (e) {
						data = text;
					}
					return { response, text, data, ok: response.ok, status: response.status };
				} finally {
					dec_ajax_count();
				}
			},
			onSuccess: (result) => {
				const xhr = build_xhr(result.status, result.data, result.text, (n) =>
					result.response.headers.get(n)
				);
				try {
					if (result.ok) {
						process_done(result.data, xhr);
						resolve(result.data);
					} else {
						process_fail(xhr);
						reject(result.data);
					}
				} finally {
					process_always(result.data);
				}
			},
			onError: (err) => {
				// network failure (fetch itself threw), not an HTTP status error
				try {
					process_always(null);
				} finally {
					reject(err);
				}
			},
		});
		resource.fetch();
	});
	// query_report keeps last_ajax and calls .abort() on it.
	promise.abort = () => {
		try {
			resource && resource.abort();
		} finally {
			process_always(null);
		}
	};
	return promise;
};

// ajax_count bookkeeping for after_ajax / after_server_call. jQuery's
// ajaxSend/ajaxComplete (below) cover any remaining $.ajax callers; fetch calls
// increment/decrement here.
function dec_ajax_count() {
	frappe.request.ajax_count--;
	if (!frappe.request.ajax_count) {
		(frappe.request.waiting_for_ajax || []).forEach((fn) => fn());
		frappe.request.waiting_for_ajax = [];
	}
}

frappe.request.is_fresh = function (args, threshold) {
	// return true if a request with similar args has been sent recently
	if (!frappe.request.logs[args.cmd]) {
		frappe.request.logs[args.cmd] = [];
	}

	for (let past_request of frappe.request.logs[args.cmd]) {
		// check if request has same args and was made recently
		if (
			new Date() - past_request.timestamp < threshold &&
			frappe.utils.deep_equal(args, past_request.args)
		) {
			console.log("throttled");
			return true;
		}
	}

	// log the request
	frappe.request.logs[args.cmd].push({ args: args, timestamp: new Date() });
	return false;
};

// call execute serverside request
frappe.request.prepare = function (opts) {
	$("body").attr("data-ajax-state", "triggered");

	// btn indicator
	if (opts.btn) $(opts.btn).prop("disabled", true);

	// freeze page
	if (opts.freeze) frappe.dom.freeze(opts.freeze_message);

	// stringify args if required (skipped when sending a native JSON body)
	if (!opts.use_json) {
		for (var key in opts.args) {
			if (opts.args[key] && typeof opts.args[key] === "object") {
				opts.args[key] = JSON.stringify(opts.args[key]);
			}
		}
	}

	// no cmd?
	if (!opts.args.cmd && !opts.url) {
		console.log(opts);
		throw "Incomplete Request";
	}

	opts.success_callback = opts.success;
	opts.error_callback = opts.error;
	delete opts.success;
	delete opts.error;
};

frappe.request.cleanup = function (opts, r) {
	// stop button indicator
	if (opts.btn) {
		$(opts.btn).prop("disabled", false);
	}

	$("body").attr("data-ajax-state", "complete");

	// un-freeze page
	if (opts.freeze) frappe.dom.unfreeze();

	if (r) {
		// session expired? - Guest has no business here!
		if (
			r.session_expired ||
			(frappe.session.user === "Guest" && frappe.session.logged_in_user !== "Guest")
		) {
			frappe.app.handle_session_expired();
			return;
		}

		// error handlers
		let global_handlers = frappe.request.error_handlers[r.exc_type] || [];
		let request_handler = opts.error_handlers ? opts.error_handlers[r.exc_type] : null;
		let handlers = [].concat(global_handlers, request_handler).filter(Boolean);

		if (r.exc_type) {
			handlers.forEach((handler) => {
				handler(r);
			});
		}

		// show messages
		//
		let messages;
		if (opts.api_version == "v2") {
			messages = r.messages;
		} else if (r._server_messages) {
			messages = JSON.parse(r._server_messages);
		}
		if (messages && !opts.silent) {
			// show server messages if no handlers exist
			if (handlers.length === 0) {
				frappe.hide_msgprint();
				frappe.msgprint(messages);
			}
		}

		// show errors
		if (r.exc) {
			r.exc = JSON.parse(r.exc);
			if (r.exc instanceof Array) {
				r.exc.forEach((exc) => {
					if (exc) {
						console.error(exc);
					}
				});
			} else {
				console.error(r.exc);
			}
		}

		// debug messages
		if (r._debug_messages) {
			if (opts.args) {
				console.log("======== arguments ========");
				console.log(opts.args);
			}
			console.log("======== debug messages ========");
			JSON.parse(r._debug_messages).forEach((v) => {
				console.log(v);
			});
			console.log("======== response ========");
			delete r._debug_messages;
			console.log(r);
			console.log("========");
		}
	}

	frappe.last_response = r;
};

frappe.after_server_call = () => {
	if (frappe.request.ajax_count) {
		return new Promise((resolve) => {
			frappe.request.waiting_for_ajax.push(() => {
				resolve();
			});
		});
	} else {
		return null;
	}
};

frappe.after_ajax = function (fn) {
	return new Promise((resolve) => {
		if (frappe.request.ajax_count) {
			frappe.request.waiting_for_ajax.push(() => {
				if (fn) return resolve(fn());
				resolve();
			});
		} else {
			if (fn) return resolve(fn());
			resolve();
		}
	});
};

frappe.request.report_error = function (xhr, request_opts) {
	var data = JSON.parse(xhr.responseText);
	var exc;
	if (data.exc) {
		try {
			exc = (JSON.parse(data.exc) || []).join("\n");
		} catch (e) {
			exc = data.exc;
		}
		delete data.exc;
	} else {
		exc = "";
	}

	const copy_markdown_to_clipboard = () => {
		const code_block = (snippet) => "```\n" + snippet + "\n```";

		let request_data = Object.assign({}, request_opts);
		request_data.request_id = xhr.getResponseHeader("X-Frappe-Request-Id");
		const traceback_info = [
			"### App Versions",
			code_block(JSON.stringify(frappe.boot.versions, null, "\t")),
			"### Route",
			code_block(frappe.get_route_str()),
			"### Traceback",
			code_block(exc),
			"### Request Data",
			code_block(JSON.stringify(request_data, null, "\t")),
			"### Response Data",
			code_block(JSON.stringify(data, null, "\t")),
		].join("\n");
		frappe.utils.copy_to_clipboard(traceback_info);
	};

	var show_communication = function () {
		var error_report_message = [
			"<h5>Please type some additional information that could help us reproduce this issue:</h5>",
			'<div style="min-height: 100px; border: 1px solid #bbb; \
				border-radius: 5px; padding: 15px; margin-bottom: 15px;"></div>',
			"<hr>",
			"<h5>App Versions</h5>",
			"<pre>" + JSON.stringify(frappe.boot.versions, null, "\t") + "</pre>",
			"<h5>Route</h5>",
			"<pre>" + frappe.get_route_str() + "</pre>",
			"<hr>",
			"<h5>Error Report</h5>",
			"<pre>" + exc + "</pre>",
			"<hr>",
			"<h5>Request Data</h5>",
			"<pre>" + JSON.stringify(request_opts, null, "\t") + "</pre>",
			"<hr>",
			"<h5>Response JSON</h5>",
			"<pre>" + JSON.stringify(data, null, "\t") + "</pre>",
		].join("\n");

		var communication_composer = new frappe.views.CommunicationComposer({
			subject: "Error Report [" + frappe.datetime.nowdate() + "]",
			recipients: error_report_email,
			message: error_report_message,
			doc: {
				doctype: "User",
				name: frappe.session.user,
			},
		});
		communication_composer.dialog.$wrapper.css(
			"z-index",
			cint(frappe.msg_dialog.$wrapper.css("z-index")) + 1
		);
	};

	if (exc) {
		var error_report_email = frappe.boot.error_report_email;

		request_opts = frappe.request.cleanup_request_opts(request_opts);

		if (!frappe.error_dialog) {
			frappe.error_dialog = new frappe.ui.Dialog({
				title: __("Server Error"),
			});
		}

		if (error_report_email) {
			frappe.error_dialog.set_primary_action(__("Report"), () => {
				show_communication();
				frappe.error_dialog.hide();
			});
		} else {
			frappe.error_dialog.set_primary_action(__("Copy error to clipboard"), () => {
				copy_markdown_to_clipboard();
				frappe.error_dialog.hide();
			});
		}
		frappe.error_dialog.wrapper.classList.add("msgprint-dialog");

		let parts = strip(exc).split("\n");

		let dialog_html = parts[parts.length - 1];

		if (data._exc_source) {
			dialog_html += "<br>";
			dialog_html += `Possible source of error: ${data._exc_source.bold()} `;
		}

		frappe.error_dialog.$body.html(dialog_html);
		frappe.error_dialog.show();
	}
};

frappe.request.cleanup_request_opts = function (request_opts) {
	let doc = (request_opts.args || {}).doc;
	if (doc) {
		// `doc` may be a JSON string (form-encoded mode) or a native object (JSON mode)
		let was_string = typeof doc === "string";
		if (was_string) doc = JSON.parse(doc);
		frappe.utils.mask_passwords(doc);
		request_opts.args.doc = was_string ? JSON.stringify(doc) : doc;
	}

	if (request_opts.args) {
		frappe.utils.mask_passwords(request_opts.args);
	}

	return request_opts;
};

frappe.request.on_error = function (error_type, handler) {
	frappe.request.error_handlers[error_type] = frappe.request.error_handlers[error_type] || [];
	frappe.request.error_handlers[error_type].push(handler);
};

// Any remaining $.ajax callers (e.g. sync SVG icon fetches) still keep the
// counter accurate; fetch calls are counted in the resourceFetcher above.
$(document).ajaxSend(function () {
	frappe.request.ajax_count++;
});

$(document).ajaxComplete(function () {
	dec_ajax_count();
});
}

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


