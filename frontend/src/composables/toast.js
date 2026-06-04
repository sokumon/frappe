import { toast } from 'frappe-ui'

// Bridge for legacy toast / show_alert calls -> frappe-ui's imperative toast()
// API (v1). Requires <FrappeUIProvider> (which mounts <ToastProvider />) in the
// app root — wired in App.vue.
export default function showToast(params = {}) {
	if (typeof params === 'string') return toast({ message: params })
	const { title, message, text, type, duration, timeout } = params
	toast({ title, message: message ?? text, type, duration: duration ?? timeout })
}
