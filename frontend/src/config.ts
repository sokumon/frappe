// Base path the desk SPA is mounted under.
//
// The whole router (vue-router history base + the backward-compat `frappe.*`
// shims) is built around this single constant, so the app can be remounted
// under a different prefix later by changing only this value.
export const APP_PREFIX = '/newdesk'
