import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import './index.css'
import dialog from "@/composables/dialog.js"
import { Button, setConfig, frappeRequest, resourcesPlugin } from 'frappe-ui'
import { spritePlugin } from "frappe-ui/icons"
async function appendScripts(scripts) {
    if (!scripts?.length) return

    const filteredScripts = scripts.filter(script => 
        script.includes("libs") || 
        script.includes("list") || 
        script.includes("vue_shell") || 
        script.includes("controls")
    )

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
let app = createApp(App)
setConfig('resourceFetcher', frappeRequest)
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
    appendStyles(values.app_include_css)
    if (window.system_timezone) setConfig('systemTimezone', window.system_timezone)
    window.frappe._router = router
    app.mount('#app')
}

initFrappe().catch(console.error)
app.use(router)
app.use(resourcesPlugin)
app.use(spritePlugin)
app.component('Button', Button)