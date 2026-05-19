<script setup lang="ts">
import { reactive, ref } from 'vue'
import Notifications from '~icons/lucide/bell'
import Deals from '~icons/lucide/briefcase'
import Organizations from '~icons/lucide/building'
import Tasks from '~icons/lucide/check-square'
import Notes from '~icons/lucide/clipboard'
import Link from '~icons/lucide/link'
import EmailTemplates from '~icons/lucide/mail'
import Moon from '~icons/lucide/moon'
import CallLogs from '~icons/lucide/phone'
import Settings from '~icons/lucide/settings'
import User from '~icons/lucide/user'
import Contacts from '~icons/lucide/user-check'
import Leads from '~icons/lucide/users'
import { Sidebar } from 'frappe-ui'
import { Breadcrumbs } from 'frappe-ui'
import LucideHouse from '~icons/lucide/house'
import LucideList from '~icons/lucide/list'
import LucideView from '~icons/lucide/user-star'
import { useTemplateRef, onMounted, onUnmounted, onSetup } from 'vue'
let primary_action_label = ref('')
function toggleTheme() {
	const currentTheme = document.documentElement.getAttribute('data-theme')
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
	document.documentElement.setAttribute('data-theme', newTheme)
}

const crmSidebar = reactive({
	header: {
		title: 'Frappe CRM',
		subtitle: 'Jane Doe',
		logo: 'https://raw.githubusercontent.com/frappe/crm/develop/.github/logo.svg',
		menuItems: [
			{ label: 'Toggle Theme', icon: Moon, onClick: toggleTheme },
			{
				label: 'Help',
				to: '/help',
				icon: Settings,
				onClick: () => alert('Help clicked!'),
			},
			{
				label: 'Logout',
				to: '/logout',
				icon: User,
				onClick: () => alert('Logging out...'),
			},
		],
	},
	sections: [
		{
			label: '',
			items: [{ label: 'Notifications', icon: Notifications, to: '' }],
		},
		{
			label: '',
			items: [
				{ label: 'Leads', icon: Leads, to: '/leads' },
				{ label: 'Deals', icon: Deals, to: '/deals' },
				{ label: 'Contacts', icon: Contacts, to: '/contacts' },
				{ label: 'Organizations', icon: Organizations, to: '/organizations' },
				{ label: 'Notes', icon: Notes, to: '/notes' },
				{ label: 'Tasks', icon: Tasks, to: '/tasks' },
				{ label: 'Call Logs', icon: CallLogs, to: '/call-logs' },
				{
					label: 'Email Templates',
					icon: EmailTemplates,
					to: '/email-templates',
				},
			],
		},
		{
			label: 'Views',
			collapsible: true,
			items: [
				{ label: 'My Open Deals', icon: Link, to: '/my-open-deals' },
				{ label: 'Partnership Deals', icon: Link, to: '/partnership-deals' },
				{ label: 'Unassigned Deals', icon: Link, to: '/unassigned-deals' },
				{
					label: 'Enterprise Pipeline',
					icon: Link,
					to: '/enterprise-pipeline',
				},
			],
		},
	],
})
const container = useTemplateRef('list-view-container')
onMounted(async () => {
	frappe.realtime.init()
	frappe.views.ListView.prototype.set_primary_action = function () {
		if (this.can_create && !frappe.boot.read_only) {
			const doctype_name = __(frappe.router.doctype_layout) || __(this.doctype)
			const add_button_label = __('Add {0}', [doctype_name], 'Primary action in list view')
			primary_action_label.value = add_button_label
			// if (frappe.is_mobile()) {
			// 	create_button.append(__("Add"));
			// } else {
			// 	this._trim_primary_action_if_overflow(create_button, add_button_label);
			// }
		}
	}
	let list_view = new frappe.views.ListView({
		doctype: 'Item',
		parent: container.value,
	})
})
</script>

<template>
	<Sidebar :header="crmSidebar.header" :sections="crmSidebar.sections" />
	<div class="flex flex-col w-full">
		<nav class="bg-surface-white border-b px-2 py-2.5 h-12 flex justify-between w-full">
			<Breadcrumbs
				:items="[
					{ icon: LucideHouse, route: { name: 'Home' } },
					{ label: 'Stock', route: '/stock' },
					{
						label: 'Item',
					},
				]"
			>
				<template #prefix="{ item }">
					<component :is="item.icon" class="size-4" />
				</template>
			</Breadcrumbs>
			<div>
				<Button variant="solid">{{ primary_action_label }}</Button>
			</div>
		</nav>
		<div ref="list-view-container" class="old-desk-view list-view-container w-full h-full">
			<div class="page-form"></div>
		</div>
	</div>
</template>
