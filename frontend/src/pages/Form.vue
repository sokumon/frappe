<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Notifications from '~icons/lucide/bell'
import Deals from '~icons/lucide/briefcase'
import Organizations from '~icons/lucide/building'
import Search from '~icons/lucide/search'
import Tasks from '~icons/lucide/check-square'
import Notes from '~icons/lucide/clipboard'
import Link from '~icons/lucide/link'
import EmailTemplates from '~icons/lucide/mail'
import CallLogs from '~icons/lucide/phone'
import Contacts from '~icons/lucide/user-check'
import Leads from '~icons/lucide/users'
import { Sidebar, Button, Dropdown } from 'frappe-ui'
import { Breadcrumbs, Badge } from 'frappe-ui'
import OldDeskView from '@/components/OldDeskView.vue'
import LucideHouse from '~icons/lucide/house'
import LucideView from '~icons/lucide/user-star'
import { useTemplateRef, onMounted, onUnmounted, onSetup, watch } from 'vue'
import Moon from '~icons/lucide/moon'
import Settings from '~icons/lucide/settings'
import User from '~icons/lucide/User'
import router from '@/router'
import registerCheck from '@/composables/check.js'
import registerSelect from '@/composables/select.js'
import registerDate from '@/composables/date.js'
function toggleTheme() {
	const currentTheme = document.documentElement.getAttribute('data-theme')
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
	document.documentElement.setAttribute('data-theme', newTheme)
}
let currentSidebar = 'stock'

let menu_items = [
	{ label: 'Toggle Theme', icon: Moon, onClick: toggleTheme },
	{
		label: 'Help',
		to: '/help',
		icon: Settings,
		onClick: () => {
			alert('Help clicked!')
		},
	},
	{
		label: 'Logout',
		to: '/logout',
		icon: User,
		onClick: () => alert('Logging out...'),
	},
]
let standard_items = [
	{ label: 'Notifications', icon: Notifications, to: '' },
	{ label: 'Search', icon: Search, to: '' },
]

let custom_buttons = ref({})
const crmSidebar = reactive({
	header: {
		title: 'Stock',
		subtitle: 'ERPNext',
		logo: frappe.utils.get_desktop_icon('Stock', 'Solid'),
		menuItems: menu_items,
	},
	sections: [
		{
			label: '',
			items: standard_items,
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
	],
})
// import { useWorkspaceSidebar } from '@/composables/getSidebar';
const formcontainer = useTemplateRef('form-view-container')
let form: any
let is_dirty

const options = [
	{ label: 'Edit', icon: 'edit', onClick: () => console.log('Edit clicked') },
	{
		label: 'Delete',
		icon: 'trash-2',
		theme: 'red',
		onClick: () => console.log('Delete clicked'),
	},
]
onMounted(async () => {
	frappe.model.with_doctype('Item', function () {
		frappe.ui.form.Form.prototype.add_custom_button = function (label, callback, grp) {
			if (!grp) {
				custom_buttons.value[label] = []
				custom_buttons.value[label].push({ label: label, onClick: callback })
				return
			}
			if (custom_buttons.value[grp]) {
				custom_buttons.value[grp].push({ label: label, onClick: callback })
			} else {
				custom_buttons.value[grp] = []
				custom_buttons.value[grp].push({ label: label, onClick: callback })
			}
			frappe.custom_buttons = custom_buttons.value
		}
		// frappe.ui.form.ControlCheck = check
		// ;
		let check = registerCheck()
		frappe.ui.form.ControlCheck = check
		let select = registerSelect()
		frappe.ui.form.ControlSelect = select
		let date = registerDate()
		frappe.ui.form.ControlDate = date
		frappe.ui.form.Form.prototype.script_manager = {
			trigger: async function (name, callback) {
				console.log(name, callback)
			},
		}
		form = new frappe.ui.form.Form('Item', formcontainer.value.el, true)

		// }
		frappe.model.with_doc('Item', 'SKU010', (name, r) => {
			if (r && r['403']) return // not permitted
			let doc = frappe.get_doc('Item', 'SKU010')
			let indicator = frappe.get_indicator(doc)
			debugger
			form.refresh('SKU010')
			if (indicator.length) {
				theme.value = indicator[1]
				badgeContent.value = indicator[0]
			}
			const breadcrumbs = computed(() => {
				const currRoute = router.query.view
				return currRoute
			})
			console.log(form.$wrapper)
			form.$wrapper.on('dirty', function () {
				// Show badge as dirty
				badgeContent.value = 'Not Saved'
				theme.value = 'orange'
			})
		})
	})
})
function save() {
	form.save('Save')
}

import { Avatar } from 'frappe-ui'
let theme = ref('grey')
let badgeContent = ref('status')
</script>

<template>
	<Sidebar :header="crmSidebar.header" :sections="crmSidebar.sections" />
	<div class="flex-1 flex flex-col h-full overflow-auto">
		<nav class="bg-surface-white border-b px-2 py-2.5 h-12 flex justify-between w-full">
			<div class="flex align-items-center gap-2">
				<Breadcrumbs
					:items="[
						{ icon: LucideHouse, route: { name: 'Home' } },
						{ label: 'Stock', route: '/stock' },
						{
							label: 'Item',
							route: '/item',
						},
						{
							label: 'SKU010',
						},
					]"
				>
					<template #prefix="{ item }">
						<component :is="item.icon" class="size-4" />
					</template>
				</Breadcrumbs>
				<Badge :theme="theme" size="lg"> {{ badgeContent }}</Badge>
			</div>
			<div class="flex gap-2">
				<Dropdown
					v-if="Object.keys(custom_buttons).length"
					v-for="[name, actions] in Object.entries(custom_buttons)"
					:options="actions"
				>
					<Button>{{ name }}</Button>
				</Dropdown>
				<Button variant="solid" @click="save"> Save</Button>
			</div>
		</nav>
		<OldDeskView
			ref="form-view-container"
			class="form-view-container w-full h-full flex flex-col"
		/>
		<div class="form-sidebar flex"></div>
	</div>
</template>
