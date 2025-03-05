import { createRouter, createWebHistory } from 'vue-router'

const routes = [
	{
		path: '/',
		name: 'Home',
		component: () => import('@/pages/Home.vue'),
	},
]

let router = createRouter({
	history: createWebHistory('/portal'),
	routes,
	linkActiveClass: 'bg-surface-selected shadow-sm',
	linkExactActiveClass: 'bg-surface-selected shadow-sm',
})

export default router
