import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import './index.css'
import { msgprint, hide_msgprint, update_msgprint, confirm } from "@/composables/dialog.js"
import toast from "@/composables/toast.js"
import { Button, setConfig, frappeRequest, resourcesPlugin } from 'frappe-ui'
import { spritePlugin } from "frappe-ui/icons"
import { FrappeApp } from "@/frappeApp"
import { installPageBridge } from "@/page/createPage"
import { installBreadcrumbs } from "@/composables/getBreadcrumbs"
async function appendScripts(scripts) {
    if (!scripts?.length) return

    const filteredScripts = scripts.filter(script => 
        script.includes("libs") || 
        script.includes("list") || 
        script.includes("vue_shell") || 
        script.includes("controls") ||
        script.includes("erpnext") || 
        script.includes("report")
    )
    let counter = 0;
    for (const script of filteredScripts) {
        await new Promise<void>((resolve, reject) => {
            console.log(script)
            const scriptEl = document.createElement('script')
            scriptEl.src = script
            scriptEl.onload = () => {
                console.log("loaded", script)
                frappe.vue_shell = true
                frappe.user_roles = frappe.boot.user.roles
                frappe.sys_defaults = frappe.boot.sysdefaults
                // frappe.breadcrumbs is published by installBreadcrumbs() in
                // bootstrap() (Vue port of views/breadcrumbs.js).
                counter++;
                if(counter == filteredScripts.length && !isBootstraped){
                    bootstrap()
                }
                resolve()
            }
            scriptEl.onerror = () => reject(new Error(`Failed to load script: ${script}`))
            document.body.appendChild(scriptEl)


        })
    }
}

function appendStyles(styles){
    if(!styles.length) return
    const loadPromises = styles
        .map(style => new Promise<void>((resolve, reject) => {
            const linkEl = document.createElement('link')

            linkEl.type = "text/css";
            linkEl.rel = "stylesheet";
            linkEl.href = style;
            document.head.appendChild(linkEl)
        }))

}

// Mirrors the include_icons() jinja helper used by the legacy desk: fetches each
// app_include_icons SVG sprite and injects it into #all-symbols. Desk bundles
// (e.g. the icon form control) read available glyphs from
// #all-symbols > svg > symbol[id], so the sprites must live in that container.
async function appendIcons(icons: string[]) {
    if (!icons?.length) return

    let container = document.getElementById('all-symbols')
    if (!container) {
        container = document.createElement('div')
        container.id = 'all-symbols'
        container.style.display = 'none'
        document.body.appendChild(container)
    }
    const target = container

    const version = frappe?.build_version
    await Promise.all(
        icons.map(async (path: string) => {
            try {
                const url = version ? `${path}?v=${version}` : path
                const res = await fetch(url, { credentials: 'same-origin' })
                const svg = await res.text()
                target.insertAdjacentHTML('beforeend', svg)
            } catch (e) {
                console.error(`Failed to load icons: ${path}`, e)
            }
        })
    )
}
// Loads frappe boot context and the desk bundles (libs, controls, erpnext, ...).
// Resolves only once every filtered script's onload has fired, so callers can
// rely on frappe.ui.form.*, frappe.model.*, frappe.router etc. being present.
async function initFrappe() {
    const res = await fetch('/api/v2/method/frappe.www.frappe.get_context_for_dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    let  values  = await res.json()
    values = values.data
    if (!window.frappe) window.frappe = {};
    window.frappe = { ...window.frappe, ...values }
    frappe.breadcrumbs = {
        preferred: []
    },

    await appendIcons(values.app_include_icons)
    await appendScripts(values.app_include_js)
    let cssFiles = [frappe.boot.assets_json['newdesk.bundle.css']]
    appendStyles(cssFiles)
    if (window.system_timezone) setConfig('systemTimezone', window.system_timezone)
    frappe.toast = toast
    // Override the legacy bootstrapped frappe.msgprint (from messages.js) with
    // the frappe-ui <Dialog> bridge. Must run after appendScripts so the desk
    // bundle's definitions are already in place to overwrite.
    frappe.msgprint = msgprint
    frappe.hide_msgprint = hide_msgprint
    frappe.update_msgprint = update_msgprint
    window.msgprint = msgprint
    // frappe.throw already routes through the bridge (it calls frappe.msgprint).
    frappe.confirm = confirm
}
let isBootstraped = false;
function bootstrap() {
    const app = createApp(App)
    setConfig('resourceFetcher', frappeRequest)
    app.use(resourcesPlugin)
    app.use(spritePlugin)
    app.component('Button', Button)

    // Wait for the desk bundles (incl. erpnext) to load BEFORE mounting, so no
    // component's onMounted runs until the global frappe.* APIs are available.

    // Recreate frappe.Application.load_bootinfo (globals, model sync, page
    // cache, moment, setup_complete) before any component or route guard runs.
    new FrappeApp()

    // Re-point frappe.ui.make_app_page / frappe.ui.Page at the Vue page bridge
    // so legacy views (form.js, factory.js, treeview.js, ...) render their
    // chrome through PageShell. Runs after the desk bundles defined frappe.ui.
    installPageBridge()

    // Build the router's slug->doctype map + workspaces (legacy
    // frappe.router.setup, called from load_bootinfo). Must run before mount so
    // frappe.router.routes is populated before any component reads it.
    frappe.router.setup()

    // Publish the reactive frappe.breadcrumbs (Vue port of views/breadcrumbs.js)
    // and wire it to the router. Replaces the load-time stub / legacy DOM impl so
    // <Navbar> renders breadcrumbs from the route. Runs after router.setup so the
    // slug map + workspaces it reads are ready.
    installBreadcrumbs()

    app.use(router)
    window.frappe._router = router
    app.mount('#app')
    isBootstraped = true;
}

initFrappe().catch(console.error)