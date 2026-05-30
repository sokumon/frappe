<script setup lang="ts">
// Renders the right component for a doctype list view based on the `:view`
// url segment (/sales-order/view/<view>). "list" uses the real List.vue;
// the other view modes (report, calendar, kanban, …) are stubs for now.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import List from '@/pages/List.vue'
import Report from '@/pages/views/Report.vue'
import Dashboard from '@/pages/views/Dashboard.vue'
import Calendar from '@/pages/views/Calendar.vue'
import Gantt from '@/pages/views/Gantt.vue'
import Inbox from '@/pages/views/Inbox.vue'
import Image from '@/pages/views/Image.vue'
import Tree from '@/pages/views/Tree.vue'
import Kanban from '@/pages/views/Kanban.vue'
import MapView from '@/pages/views/Map.vue'

const views: Record<string, any> = {
	list: List,
	report: Report,
	dashboard: Dashboard,
	calendar: Calendar,
	gantt: Gantt,
	inbox: Inbox,
	image: Image,
	tree: Tree,
	kanban: Kanban,
	map: MapView,
}

const route = useRoute()
const view = computed(() => String(route.params.view || 'list').toLowerCase())
// fall back to the list view for unknown view modes
const component = computed(() => views[view.value] || List)
const doctype = computed(() => route.params.doctype as string)
</script>

<template>
	<component :is="component" :doctype="doctype" :view="view" />
</template>
