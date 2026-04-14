import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('@/pages/Desktop.vue'),
  },
  {
    path: '/:doctype',
    name: 'Home',
    component: () => import('@/pages/List.vue'),
  },
  {
    path: '/:doctype/:id',
    name: 'Form',
    component: () => import('@/pages/Form.vue'),
  },
  {
    path: '/query-report/:reportName',
    name: 'Query Report',
    component: () => import('@/pages/Report.vue'),
  },
]

let router = createRouter({
  history: createWebHistory('/newdesk'),
  routes,
})
window.frappe = {}

frappe.get_route_str = function() {
  return router.currentRoute.value.href ;
}
frappe.router = {}
frappe.router.doctype_layout = undefined
frappe.router.events = {}
frappe.router.on = function(event_name, callback) {
    if(!frappe.router.events[event_name]){
        frappe.router.events[event_name] = []
    } 
    frappe.router.events[event_name].push(callback)
}
router.afterEach((to, from, failure) => {
  if (!failure) return
  let callbacks = frappe.router.events['change']
  callbacks.forEach(cb => {
    cb()
  })
})
frappe.router.slug= function(name) {
  return name.toLowerCase().replace(/ /g, "-");
}
frappe.route_titles = {}
frappe.router.get_sub_path = function() {
  return router.currentRoute.value.fullPath.replace("/", "")
}
frappe.route_hooks = {}
frappe.set_route = function(view_name, entity_name){
  let view = frappe.router.unslug(view_name);
  router.push({ name: view , params: { reportName: entity_name } })
}
frappe.router.unslug = function(slugs) {

	slugs = slugs.replace(/_/g, '-');
	slugs = slugs.replace(/--/g, '-');

	var list = [];
	slugs.split('-').forEach(function (slug) {
		list.push(slug.substr(0, 1).toUpperCase() + slug.substr(1));
	})
	return list.join(' ');
}
export default router
