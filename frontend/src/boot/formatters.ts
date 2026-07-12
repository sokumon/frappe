// boot/formatters.ts
//
// frappe.format / frappe.form.formatters / frappe.form.link_formatters — port
// of frappe/public/js/frappe/form/formatters.js (desk/list/dialog/web bundles,
// none of which load in the Vue shell; until this port frappe.format was
// undefined here even though vueForm.formatValue, useListBridge and
// utils.build_summary_item call it, and erpnext client scripts assign
// frappe.form.link_formatters[...] at eval).
//
// Everything it reads is already ported and resolved at call time: frappe.meta
// / frappe.model (model/), frappe.utils + window cint/cstr/format_number/
// format_currency/repl (utils/), frappe.datetime (utils), frappe.dom (boot/dom),
// frappe.avatar (utils/common), jQuery + moment (boot/libs). Replaces the bare
// `frappe.form = { link_formatters: {} }` stub main.ts used to set for erpnext.
const w = window as any

// utils globals, resolved lazily so import order doesn't matter
const cint = (v: any, def?: any) => w.cint(v, def)
const cstr = (v: any) => w.cstr(v)
const is_null = (v: any) => w.is_null(v)
const format_number = (v: any, format: any, decimals?: any) => w.format_number(v, format, decimals)
const format_currency = (v: any, currency?: any, decimals?: any) =>
	w.format_currency(v, currency, decimals)
const repl = (s: string, dict: any) => w.repl(s, dict)
const __ = (txt: any, replace?: any) => (w.__ ? w.__(txt, replace) : txt)

type DocField = Record<string, any>
type FormatOptions = Record<string, any> | undefined

export function installFormatters() {
	frappe.provide('frappe.form.formatters')

	// erpnext client scripts register into this at module eval; keep whatever
	// landed before this install ran
	frappe.form.link_formatters = frappe.form.link_formatters || {}

	frappe.form.formatters = {
		_right: function (value: any, options: FormatOptions) {
			if (options && (options.inline || options.only_value)) {
				return value
			} else {
				return "<div style='text-align: right'>" + value + '</div>'
			}
		},
		_apply_custom_formatter: function (value: any, df: DocField) {
			/* you can add a custom formatter in df.formatter
			example:
				frappe.meta.docfield_map[df.parent][df.fieldname].formatter = (value) => {
					if (value==='Test') return '😜';
				}
			*/
			if (df) {
				const std_df =
					frappe.meta.docfield_map[df.parent] &&
					frappe.meta.docfield_map[df.parent][df.fieldname]
				if (std_df && std_df.formatter && typeof std_df.formatter === 'function') {
					value = std_df.formatter(value, df)
				}
			}
			return value
		},
		Data: function (value: any, df: DocField) {
			if (df && df.options == 'URL') {
				if (!value) return ''
				return `<a href="${value}" title="Open Link" target="_blank">${value}</a>`
			}
			if (df && df.options == 'IBAN') {
				if (!value) return ''
				return frappe.utils.get_formatted_iban(value)
			}
			value = value == null ? '' : value

			return frappe.form.formatters._apply_custom_formatter(value, df)
		},
		Autocomplete: function (value: any, df: DocField) {
			return __(frappe.form.formatters['Data'](value, df))
		},
		Select: function (value: any, df: DocField) {
			return __(frappe.form.formatters['Data'](value, df))
		},
		Float: function (value: any, docfield: DocField, options: FormatOptions, doc: any) {
			if (value === null) {
				return ''
			}

			// don't allow 0 precision for Floats, hence or'ing with null
			let precision =
				docfield.precision ||
				cint(frappe.boot.sysdefaults && frappe.boot.sysdefaults.float_precision) ||
				null
			if (docfield.options && docfield.options.trim()) {
				// options points to a currency field, but expects precision of float!
				docfield.precision = precision
				return frappe.form.formatters.Currency(value, docfield, options, doc)
			} else {
				// show 1.000000 as 1
				if (!(options || {}).always_show_decimals && !is_null(value)) {
					const temp = cstr(value).split('.')
					if (temp[1] == undefined || cint(temp[1]) === 0) {
						precision = 0
					}
				}

				value = value == null || value === '' ? '' : value

				return frappe.form.formatters._right(format_number(value, null, precision), options)
			}
		},
		Int: function (value: any, docfield: DocField, options: FormatOptions) {
			if (value === null) {
				return ''
			}

			if (cstr(docfield.options).trim() === 'File Size') {
				return frappe.form.formatters.FileSize(value)
			}
			return frappe.form.formatters._right(value == null ? '' : cint(value), options)
		},
		Percent: function (value: any, docfield: DocField, options: FormatOptions) {
			if (value === null) {
				return ''
			}

			const valuePrecision = value?.toString().split('.')[1]?.length || 0

			const precision =
				docfield.precision ||
				cint(frappe.boot.sysdefaults && frappe.boot.sysdefaults.float_precision) ||
				2
			return frappe.form.formatters._right(
				format_number(value, null, Math.min(precision, valuePrecision)) + '%',
				options
			)
		},
		Rating: function (value: any, docfield: DocField) {
			let rating_html = ''
			const number_of_stars = docfield.options || 5
			value = value * number_of_stars
			value = Math.round(value * 2) / 2 // roundoff number to nearest 0.5
			Array.from({ length: cint(number_of_stars) }, (_, i) => i + 1).forEach((i) => {
				rating_html += `<svg class="icon icon-md" data-rating=${i} viewBox="0 0 24 24" fill="none">
					<path class="right-half ${
						i <= (value || 0) ? 'star-click' : ''
					}" d="M11.9987 3.00011C12.177 3.00011 12.3554 3.09303 12.4471 3.27888L14.8213 8.09112C14.8941 8.23872 15.0349 8.34102 15.1978 8.3647L20.5069 9.13641C20.917 9.19602 21.0807 9.69992 20.7841 9.9892L16.9421 13.7354C16.8243 13.8503 16.7706 14.0157 16.7984 14.1779L17.7053 19.4674C17.7753 19.8759 17.3466 20.1874 16.9798 19.9945L12.2314 17.4973C12.1586 17.459 12.0786 17.4398 11.9987 17.4398V3.00011Z" fill="var(--star-fill)" stroke="var(--star-fill)"/>
					<path class="left-half ${
						i <= (value || 0) || i - 0.5 == value ? 'star-click' : ''
					}" d="M11.9987 3.00011C11.8207 3.00011 11.6428 3.09261 11.5509 3.27762L9.15562 8.09836C9.08253 8.24546 8.94185 8.34728 8.77927 8.37075L3.42887 9.14298C3.01771 9.20233 2.85405 9.70811 3.1525 9.99707L7.01978 13.7414C7.13858 13.8564 7.19283 14.0228 7.16469 14.1857L6.25116 19.4762C6.18071 19.8842 6.6083 20.1961 6.97531 20.0045L11.7672 17.5022C11.8397 17.4643 11.9192 17.4454 11.9987 17.4454V3.00011Z" fill="var(--star-fill)" stroke="var(--star-fill)"/>
				</svg>`
			})
			return `<div class="rating">
				${rating_html}
			</div>`
		},
		Currency: function (value: any, docfield: DocField, options: FormatOptions, doc: any) {
			if (value === null) {
				return ''
			}

			const currency = frappe.meta.get_field_currency(docfield, doc)

			let precision
			if (typeof docfield.precision == 'number') {
				precision = docfield.precision
			} else {
				precision = cint(
					docfield.precision || frappe.boot.sysdefaults.currency_precision || 2
				)
			}

			// If you change anything below, it's going to hurt a company in UAE, a bit.
			if (precision > 2) {
				const parts = cstr(value).split('.') // should be minimum 2, comes from the DB
				const decimals = parts.length > 1 ? parts[1] : '' // parts.length == 2 ???

				if (decimals.length < 3 || decimals.length < precision) {
					const fraction =
						frappe.model.get_value(':Currency', currency, 'fraction_units') || 100 // if not set, minimum 2.

					if (decimals.length < cstr(fraction).length) {
						precision = cstr(fraction).length - 1
					}
				}
			}

			value = value == null || value === '' ? '' : value
			value = format_currency(value, currency, precision)

			if (options && options.only_value) {
				return value
			} else {
				return frappe.form.formatters._right(value, options)
			}
		},
		Check: function (value: any) {
			return `<input type="checkbox" disabled
				class="disabled-${cint(value) ? 'selected' : 'deselected'}">`
		},

		Link: function (value: any, docfield: DocField, options: FormatOptions, doc: any) {
			const doctype = docfield._options || docfield.options
			const original_value = value
			let link_title = frappe.utils.get_link_title(doctype, value)

			if (link_title === value) {
				link_title = null
			}

			if (value && value.match && value.match(/^['"].*['"]$/)) {
				value.replace(/^.(.*).$/, '$1')
			}

			if (options && (options.for_print || options.only_value)) {
				return get_link_display_value(doctype, link_title, value)
			}

			if (frappe.form.link_formatters[doctype]) {
				// don't apply formatters in case of composite (parent field of same type)
				if (doc && doctype !== doc.doctype) {
					value = frappe.form.link_formatters[doctype](value, doc, docfield)
				}
			}

			if (!value) {
				return ''
			}
			if (value[0] == "'" && value[value.length - 1] == "'") {
				return value.substring(1, value.length - 1)
			}
			if (docfield && docfield.link_onclick) {
				return repl('<a onclick="%(onclick)s" href="#">%(value)s</a>', {
					onclick: docfield.link_onclick.replace(/"/g, '&quot;') + '; return false;',
					value: value,
				})
			} else if (docfield && doctype) {
				if (frappe.model.can_read(doctype)) {
					const a = document.createElement('a')
					a.href = `/desk/${encodeURIComponent(
						frappe.router.slug(doctype)
					)}/${encodeURIComponent(original_value)}`
					a.dataset.doctype = doctype
					a.dataset.name = original_value
					a.dataset.value = original_value
					// textContent, not legacy innerText: identical on a
					// detached node, and innerText doesn't exist in jsdom
					a.textContent = __((options && options.label) || link_title || value)
					return a.outerHTML
				} else {
					return get_link_display_value(doctype, link_title, value)
				}
			} else {
				return get_link_display_value(doctype, link_title, value)
			}
		},
		Date: function (value: any) {
			if (!frappe.datetime.str_to_user) {
				return value
			}
			if (value) {
				value = frappe.datetime.str_to_user(value, false, true)
				// handle invalid date
				if (value === 'Invalid date') {
					value = null
				}
			}

			return value || ''
		},
		DateRange: function (value: any) {
			if (Array.isArray(value)) {
				return __('{0} to {1}', [
					frappe.datetime.str_to_user(value[0]),
					frappe.datetime.str_to_user(value[1]),
				])
			} else {
				return value || ''
			}
		},
		Datetime: function (value: any) {
			if (value) {
				return w
					.moment(frappe.datetime.convert_to_user_tz(value))
					.format(
						frappe.boot.sysdefaults.date_format.toUpperCase() +
							' ' +
							(frappe.boot.sysdefaults.time_format || 'HH:mm:ss')
					)
			} else {
				return ''
			}
		},
		Text: function (value: any, df?: DocField) {
			if (value) {
				const tags = ['<p', '<div', '<br', '<table']
				let match = false

				for (let i = 0; i < tags.length; i++) {
					if (value.match(tags[i])) {
						match = true
						break
					}
				}

				if (!match) {
					value = frappe.utils.replace_newlines(value)
				}
			}

			return frappe.form.formatters.Data(value, df)
		},
		Time: function (value: any) {
			if (value) {
				value = frappe.datetime.str_to_user(value, true)
			}

			return value || ''
		},
		Duration: function (value: any, docfield: DocField) {
			if (value) {
				const duration_options = frappe.utils.get_duration_options(docfield)
				value = frappe.utils.get_formatted_duration(value, duration_options)
			}

			return value || '0s'
		},
		LikedBy: function (value: any) {
			let html = ''
			JSON.parse(value || '[]').forEach((v: any) => {
				if (v) html += frappe.avatar(v)
			})
			return html
		},
		Tag: function (value: any) {
			let html = ''
			;(value || '').split(',').forEach((v: string) => {
				if (v) {
					const ev = frappe.utils.escape_html(v)
					html += `
					<span
						class="data-pill btn-xs align-center ellipsis"
						style="background-color: var(--control-bg); box-shadow: none; margin-right: 4px;"
						data-field="_user_tags" data-label="${ev}">
						${ev}
					</span>`
				}
			})
			return html
		},
		Comment: function (value: any) {
			return value
		},
		Assign: function (value: any) {
			let html = ''
			JSON.parse(value || '[]').forEach((v: any) => {
				if (v) {
					const ev = frappe.utils.escape_html(v)
					html += `<span class="label label-warning" style="margin-right: 7px;" data-field="_assign">${ev}</span>`
				}
			})
			return html
		},
		SmallText: function (value: any) {
			return frappe.form.formatters.Text(value)
		},
		TextEditor: function (value: any) {
			let formatted_value = frappe.form.formatters.Text(value)
			// to use ql-editor styles
			try {
				if (
					!w.$(formatted_value).find('.ql-editor').length &&
					!w.$(formatted_value).hasClass('ql-editor')
				) {
					formatted_value = `<div class="ql-editor read-mode">${formatted_value}</div>`
				}
			} catch (e) {
				formatted_value = `<div class="ql-editor read-mode">${formatted_value}</div>`
			}

			return formatted_value
		},
		Code: function (value: any) {
			return '<pre>' + (value == null ? '' : w.$('<div>').text(value).html()) + '</pre>'
		},
		WorkflowState: function (value: any) {
			const workflow_state = frappe.get_doc('Workflow State', value)
			if (workflow_state) {
				return repl(
					"<span class='label label-%(style)s' \
					data-workflow-state='%(value)s'\
					style='padding-bottom: 4px; cursor: pointer;'>\
					%(icon)s %(value)s</span>",
					{
						value: value,
						style: workflow_state.style.toLowerCase(),
						icon: workflow_state.icon
							? frappe.utils.icon(workflow_state.icon, 'xs', '', '', '', true)
							: '',
					}
				)
			} else {
				return "<span class='label'>" + value + '</span>'
			}
		},
		Email: function (value: any) {
			return w.$('<div></div>').text(value).html()
		},
		FileSize: function (value: any) {
			value = cint(value)
			if (value > 1048576) {
				return (value / 1048576).toFixed(2) + 'M'
			} else if (value > 1024) {
				return (value / 1024).toFixed(2) + 'K'
			}
			return value
		},
		TableMultiSelect: function (rows: any[], df: DocField, options: FormatOptions) {
			rows = rows || []
			const meta = frappe.get_meta(df.options)
			const link_field = meta.fields.find((f: DocField) => f.fieldtype === 'Link')
			const formatted_values = rows.map((row) => {
				const value = row[link_field.fieldname]
				return `<span class="text-nowrap">
					${frappe.format(value, link_field, options, row)}
				</span>`
			})
			return formatted_values.join(', ')
		},
		Color: (value: any) => {
			if (!value) return ''
			const escaped_value = frappe.utils.escape_html(value)
			return `<div>
				<div class="selected-color" style="background-color: ${escaped_value}"></div>
				<span class="color-value">${escaped_value}</span>
			</div>`
		},
		Icon: (value: any) => {
			if (!value) return ''
			const escaped_value = frappe.utils.escape_html(value)
			if (frappe.utils.is_emoji(value)) {
				return `<div class='flex' style='gap: 8px;'>
					<span class="icon-value">${escaped_value}</span>
				</div>`
			}
			return `<div class='flex' style='gap: 8px;'>
				<div class="selected-icon">${frappe.utils.icon(escaped_value, 'md')}</div>
				<span class="icon-value">${escaped_value}</span>
			</div>`
		},
		Attach: format_attachment_url,
		AttachImage: format_attachment_url,
	}

	frappe.form.get_formatter = function (fieldtype: string) {
		if (!fieldtype) fieldtype = 'Data'
		return frappe.form.formatters[fieldtype.replace(/ /g, '')] || frappe.form.formatters.Data
	}

	frappe.format = function (value: any, df: DocField, options?: FormatOptions, doc?: any) {
		let mask_readonly = false
		if (df?.parent) {
			const mask_fields = frappe.get_meta(df.parent)?.masked_fields
			mask_readonly = mask_fields?.includes(df.fieldname)
		}

		if (!df || mask_readonly) df = { fieldtype: 'Data' }
		if (df.fieldname == '_user_tags') df = { ...df, fieldtype: 'Tag' }
		let fieldtype = df.fieldtype || 'Data'

		// format Dynamic Link as a Link
		if (fieldtype === 'Dynamic Link') {
			fieldtype = 'Link'
			df._options = doc ? doc[df.options] : null
		}

		const formatter = df.formatter || frappe.form.get_formatter(fieldtype)

		let formatted = formatter(value, df, options, doc)

		if (typeof formatted == 'string') formatted = frappe.dom.remove_script_and_style(formatted)

		return formatted
	}

	frappe.get_format_helper = function (doc: any) {
		const helper = {
			get_formatted: function (fieldname: string) {
				const df = frappe.meta.get_docfield(doc.doctype, fieldname)
				if (!df) {
					console.log('fieldname not found: ' + fieldname)
				}
				return frappe.format(doc[fieldname], df, { inline: 1 }, doc)
			},
		}
		Object.assign(helper, doc)
		return helper
	}

	frappe.form.link_formatters['User'] = function (value: any, doc: any, docfield: DocField) {
		const full_name =
			doc && (doc.full_name || (docfield && doc[`${docfield.fieldname}_full_name`]))
		return full_name || value
	}
}

function get_link_display_value(doctype: string, link_title: any, value: any) {
	const translated_doctypes = frappe.boot?.translated_doctypes || []
	if (translated_doctypes.includes(doctype)) {
		return __(link_title || value)
	}
	return link_title || value
}

function format_attachment_url(url: string) {
	const escaped = frappe.utils.escape_html(url)
	return url ? `<a href="${escaped}" target="_blank">${escaped}</a>` : ''
}
