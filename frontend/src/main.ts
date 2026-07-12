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
import { installDialogBridge } from "@/dialog/createDialog"
import { installMultiSelectDialogBridge } from "@/dialog/multiSelectDialog"
import { installBreadcrumbs } from "@/composables/getBreadcrumbs"
import { installForm } from "@/form"
import { installProvide } from "@/boot/provide"
import { installTranslate } from "@/boot/translate"
import { installModel } from "@/model"
import { installUser } from "@/boot/user"
import { installUtils } from "@/utils"
import { installRequest } from "@/boot/request"
import { installFormat } from "@/boot/format"
import { installDom } from "@/boot/dom"
import { installDb } from "@/boot/db"
import { installAssets } from "@/boot/assets"
import { installLike } from "@/boot/like"
import { installDefaults } from "@/boot/defaults"
import { installPageview } from "@/boot/pageview"
import { installLibs } from "@/boot/libs"
import { installKeys } from "@/boot/keys"
import { installRealtime } from "@/boot/realtime"

// The Vue-native form engine (frappe.ui.form.on / Controller / Form /
// QuickEntryForm). It replaces the removed `form_vue_shell` bundle and MUST be
// installed after libs/controls (frappe.provide etc.) but before erpnext, whose
// client scripts call frappe.ui.form.on and whose classes extend
// frappe.ui.form.Controller / QuickEntryForm at module-eval. We install it in the
// appendScripts loop, just before the first erpnext/india_compliance script.
// The frappe.model / frappe.meta / frappe.perm / frappe.workflow namespaces
// (verbatim ports of frappe/model/*.js from the removed desk.bundle). Needs only
// frappe.provide at eval (the merges use native Object.assign), and must land
// before erpnext + frappeApp.load_bootinfo (frappe.model.sync). The form
// engine's controllers reference frappe.model at runtime, so model goes in first.
// The frappe util grab-bag (cint/cstr/flt/format_currency, frappe.utils.*,
// frappe.datetime.*, frappe.urllib, frappe.contacts, avatars, ...) — verbatim
// ports of utils/*.js from the removed desk.bundle. Uses jQuery ($.extend) at
// eval, so after libs; defines primitives model/user/erpnext use at runtime, so
// it goes in FIRST at this seam, before model + user.
let utilsInstalled = false
function installUtilsOnce() {
    if (utilsInstalled) return
    installUtils()
    // Attach $.format for any legacy/erpnext caller (translate.ts uses the
    // imported format() directly). Needs jQuery, present at this seam.
    installFormat()
    utilsInstalled = true
}

let modelInstalled = false
function installModelOnce() {
    if (modelInstalled) return
    installModel()
    modelInstalled = true
}

// frappe.dom.* + frappe.run_serially / is_online / scrub / get_modal / freeze...
// (verbatim port of dom.js). request.ts calls frappe.dom.freeze + frappe.is_online
// at runtime, so dom must install BEFORE request. Uses $(window).on at eval.
let domInstalled = false
function installDomOnce() {
    if (domInstalled) return
    installDom()
    domInstalled = true
}

// frappe.require + frappe.assets (AssetManager) — verbatim port of assets.js.
// frappeApp.load_bootinfo (bootstrap) calls frappe.assets.clear/init_local_storage,
// and frappe.require lazy-loads bundles at runtime. execute() uses frappe.dom, so
// install after dom.
let assetsInstalled = false
function installAssetsOnce() {
    if (assetsInstalled) return
    installAssets()
    assetsInstalled = true
}

// frappe.ui.is_liked / get_liked_by (pure helpers from like.js). Consumed by
// FormSidebar.vue + legacy list views; read frappe.session at call time.
let likeInstalled = false
function installLikeOnce() {
    if (likeInstalled) return
    installLike()
    likeInstalled = true
}

// frappe.views.pageview.with_page (data-loading half of pageview.js). Page.vue
// calls it to resolve a Page doc, then renders itself; the legacy rendering half
// (show / frappe.views.Page / show_message_page) is Vue-replaced and not ported.
let pageviewInstalled = false
function installPageviewOnce() {
    if (pageviewInstalled) return
    installPageview()
    pageviewInstalled = true
}

// frappe.call / frappe.xcall / frappe.request.* — modernized transport
// (createResource over native fetch) replacing request.js from the removed
// desk.bundle. Registers $(document).ajaxSend at eval (needs jQuery), and
// request.call uses frappe.model/utils/dom at runtime — all present at this seam.
let requestInstalled = false
function installRequestOnce() {
    if (requestInstalled) return
    installRequest()
    requestInstalled = true
}

// frappe.db.* — thin frappe.call/xcall wrappers (verbatim port of db.js). Uses
// frappe.call + frappe.model.sync at runtime, so it installs after request+model.
let dbInstalled = false
function installDbOnce() {
    if (dbInstalled) return
    installDb()
    dbInstalled = true
}

// frappe.user_info / frappe.user.* / session_alive heartbeat (verbatim port of
// utils/user.js from the removed desk.bundle). Uses jQuery at eval + frappe.ui
// (from provide), and get_desktop_items reads frappe.model at runtime, so it
// installs at the same seam as model, just after it. frappeApp.load_bootinfo
// reads frappe.user_info().fullname, so it must be in before bootstrap().
let userInstalled = false
function installUserOnce() {
    if (userInstalled) return
    installUser()
    userInstalled = true
}

let formEngineInstalled = false
function installFormEngineOnce() {
    if (formEngineInstalled) return
    installUtilsOnce()
    installDomOnce()
    installAssetsOnce()
    installRequestOnce()
    installModelOnce()
    installUserOnce()
    installDbOnce()
    installLikeOnce()
    installPageviewOnce()
    installForm()
    formEngineInstalled = true
}

async function appendScripts(scripts) {
    if (!scripts?.length) return

    const filteredScripts = scripts.filter(script =>
        // libs.bundle.js is no longer loaded as a <script>; jQuery/bootstrap/
        // moment/Sortable now come from frontend yarn deps via installLibs().
        script.includes("controls") ||
        script.includes("erpnext") ||
        script.includes("india_compliance")
    )
    filteredScripts.push(frappe.boot.assets_json['desk_templates.bundle.js'])
    // Boot the ported framework globals before any bundle loads. libs.bundle no
    // longer provides jQuery (installLibs() did, in initFrappe), so these can run
    // unconditionally up front rather than keying off the first non-libs script.
    installUtilsOnce()
    installDomOnce()
    installAssetsOnce()
    installRequestOnce()
    installModelOnce()
    installUserOnce()
    installDbOnce()
    installLikeOnce()
    installPageviewOnce()

    let counter = 0;
    for (const script of filteredScripts) {
        // Install the form engine before the first app bundle that depends on it.
        if (script.includes("erpnext") || script.includes("india_compliance")) {
            installFormEngineOnce()
            frappe.form =  {
                link_formatters: {}
            }
            frappe.widget = {
                widget_factory: {
                    number_card: class NumberCard {
                        constructor(opts:any) {

                        }
                    }
                }

            }
        }

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
    // Publish jQuery/$ (+ bootstrap plugins), moment, Sortable, SetVueGlobals on
    // window BEFORE anything else — the ported boot installs (utils/dom/request/
    // user) and the controls/erpnext bundles all use $ at eval. Replaces the
    // removed libs.bundle.js; these libs are now frontend yarn deps.
    installLibs()
    // Define frappe._ / window.__ (translation) first — it's referenced
    // pervasively (SetVueGlobals, ported model/* files) and only reads
    // frappe._messages at runtime, so it's safe before provide.
    installTranslate()
    // Seed window.frappe + frappe.provide + the base namespaces BEFORE any desk
    // bundle is appended. control.js (controls.bundle) and every erpnext client
    // script call frappe.provide(...) at module-eval, so it must exist first.
    // Replaces provide.js from the removed desk.bundle ("framework bundle").
    installProvide()
    window.frappe = { ...window.frappe, ...values }
    // frappe.defaults (user/global default + user-permission accessors). Pure
    // namespace assignment; reads frappe.model/boot only at call time, so it
    // sits with the other dependency-free boot namespaces. Ported from
    // defaults.js of the removed desk.bundle.
    installDefaults()
    // frappe.ui.keys / frappe.ui.keyCode (port of ui/keyboard.js, which lived
    // in the removed desk/list bundles). Must exist before the controls and
    // erpnext bundles load — comment.js/text_editor.js call keys.get_key and
    // POS pages call add_shortcut/on at runtime. add_shortcut registrations
    // dispatch via frappe-ui useShortcut through <ShortcutHost> in App.vue;
    // on() handlers use the ported window-keydown dispatcher (needs jQuery,
    // present via installLibs above).
    installKeys()
    // @framework/ui's FormLayout number/currency fields read framework formatting
    // defaults from `window.sysdefaults` (getFormatDefaults). The legacy desk keeps
    // them on frappe.boot.sysdefaults; publish them on window for the Vue fields.
    window.sysdefaults = frappe.boot?.sysdefaults
    frappe.breadcrumbs = {
        preferred: []
    },

    await appendIcons(values.app_include_icons)
    await appendScripts(values.app_include_js)
    let cssFiles = [
        frappe.boot.assets_json['newdesk.bundle.css'],
        // Base datatable / tree-grid CSS lives only in report.bundle.css (the
        // newdesk bundle carries just Frappe's overrides). The old desk loads
        // both via app_include_css; mirror that here so report/list datatables
        // get their structural styles.
        frappe.boot.assets_json['report.bundle.css'],
    ]
    appendStyles(cssFiles)
    if (window.system_timezone) setConfig('systemTimezone', window.system_timezone)
    frappe.toast = toast
    frappe.show_alert = toast
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
    // Safety net: on a plain-frappe site with no erpnext/india_compliance bundle,
    // the in-loop install never fired. Idempotent (guarded), so a no-op if the
    // erpnext path already installed it.
    installFormEngineOnce()

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

    // Realtime socket for @framework/ui components that use it (e.g.
    // ActivityTimeline's useActivityTimeline: doc_subscribe / docinfo_update /
    // doc_update). `getSocketInstance()` reads inject('socket'/'$socket'); the
    // RealTimeClient (frappe.realtime) exposes emit/on/off and proxies to its
    // socket, so provide it directly (init it with the boot socketio port first).
    // installRealtime is the TS port of socketio_client.js — the desk/list
    // bundles that used to define frappe.realtime don't load in the shell.
    installRealtime()
    try {
        frappe.realtime?.init?.(frappe.boot?.socketio_port)
    } catch (e) {
        console.warn('realtime init failed', e)
    }
    app.provide('socket', frappe.realtime)

    // Re-point frappe.ui.make_app_page / frappe.ui.Page at the Vue page bridge
    // so legacy views (form.js, factory.js, treeview.js, ...) render their
    // chrome through PageShell. Runs after the desk bundles defined frappe.ui.
    installPageBridge()

    // Re-point frappe.ui.Dialog at the Vue dialog bridge (DialogHost renders the
    // reactive stack). Covers frappe.prompt / frappe.warn / every direct
    // `new frappe.ui.Dialog(...)` — they construct the class at call time.
    installDialogBridge()

    // Re-point frappe.ui.form.MultiSelectDialog ("Get Items From") at the Vue
    // @framework/ui RecordPicker — its legacy jQuery event wiring can't attach
    // to Vue-rendered fields, so it gets a native component.
    installMultiSelectDialogBridge()

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