<template>
	<div
		class="flex h-full flex-col overflow-auto border-r bg-surface-menu-bar px-2 py-2"
		style="width: 240px"
	>
		<div id="app-switcher" class="flex flex-col">
			<button
				class="flex items-center rounded-md w-[13rem] p-2 text-left hover:bg-surface-gray-3"
			>
				<Framework class="size-8 shrink-0 rounded" />
				<div
					class="flex flex-1 flex-col text-left duration-300 ease-in-out ml-2 w-auto opacity-100"
				>
					<div class="text-base font-medium text-ink-gray-8 leading-none">Framework</div>
					<div class="mt-1 text-sm leading-none text-gray-700">soham</div>
				</div>
				<ChevronDown />
			</button>
		</div>
		<nav id="sidebar-items" class="flex-col mt-2" style="flex: 1 1 0%">
			<RouterLink
				v-for="item in sidebar_info.items"
				:to="item.route"
				class="flex items-center rounded px-2 py-1 text-ink-gray-7 transition focus:outline-none focus-visible:ring focus-visible:ring-gray-400 hover:bg-surface-gray-2"
			>
				{{ item.title }}
			</RouterLink>
		</nav>
		<div
			class="-all flex h-7 cursor-pointer items-center rounded pl-2 pr-1 text-gray-800 duration-300 ease-in-out w-full hover:bg-gray-100"
		>
			<span class="shrink-0">
				<ArrowToLeft />
			</span>
			<div
				@click="toggleSidebar"
				class="-all ml-2 flex shrink-0 grow items-center justify-between text-base duration-300 ease-in-out opacity-100 font-normal"
			>
				Collapse
			</div>
		</div>
	</div>
</template>

<script setup>
import Framework from '@/components/Icons/Framework.vue'
import ChevronDown from './Icons/ChevronDown.vue'
import ArrowToLeft from './Icons/ArrowToLeft.vue'
import { ref } from 'vue'
import { reactive } from 'vue'
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { createResource } from 'frappe-ui'
let sidebar_info = reactive({ items: [] })
let data = createResource({
	url: '/api/method/frappe.portal.api.get_sidebar_items',
	auto: true,
	onSuccess(data) {
		add_sidebar_items(data)
	},
})

function add_sidebar_items(data) {
	sidebar_info.items = data
}
</script>
