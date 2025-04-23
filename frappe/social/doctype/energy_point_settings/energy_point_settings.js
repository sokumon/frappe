// Copyright (c) 2019, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Energy Point Settings", {
	refresh: function (frm) {
		if (frm.doc.enabled) {
			frm.add_custom_button(__("Give Review Points"), show_review_points_dialog);
		}
		let app_link = "<a href='https://github.com/frappe/eps' target='_blank'>EPS</a>";
		frm.dashboard.add_comment(
			__(
				"Energy Point System will be removed from Framework in Version 16. Please install {0} app to continue using it.",
				[app_link]
			),
			"yellow",
			true
		);
	},
});

function show_review_points_dialog() {
	const dialog = new frappe.ui.Dialog({
		title: __("Give Review Points"),
		fields: [
			{
				label: "User",
				fieldname: "user",
				fieldtype: "Link",
				options: "User",
				reqd: 1,
			},
			{
				label: "Points",
				fieldname: "points",
				fieldtype: "Int",
				reqd: 1,
			},
		],
		primary_action: function (values) {
			frappe
				.xcall(
					"frappe.social.doctype.energy_point_log.energy_point_log.add_review_points",
					{
						user: values.user,
						points: values.points,
					}
				)
				.then(() => {
					frappe.show_alert({
						message: __("Successfully Done"),
						indicator: "green",
					});
				})
				.finally(() => dialog.hide());
		},
		primary_action_label: __("Submit"),
	});
	dialog.show();
}
