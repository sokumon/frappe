import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import './index.css'
import dialog from "@/composables/dialog.js"
import { Button, setConfig, frappeRequest, resourcesPlugin } from 'frappe-ui'
import { spritePlugin } from "frappe-ui/icons"
import { FrappeApp } from "@/frappeApp"
import { installPageBridge } from "@/page/createPage"
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
                frappe.breadcrumbs = {
                    preferred: {},
                    module_map: {},
                    add: function(){
                        console.log("add breadcrumb", arguments)
                    }
                }
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
    await appendScripts(values.app_include_js)
    let cssFiles = [frappe.boot.assets_json['newdesk.bundle.css']]
    appendStyles(cssFiles)
    if (window.system_timezone) setConfig('systemTimezone', window.system_timezone)
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

    app.use(router)
    window.frappe._router = router
    app.mount('#app')
    isBootstraped = true;
}

initFrappe().catch(console.error)