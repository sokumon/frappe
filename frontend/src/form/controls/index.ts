// The Vue-backed control hierarchy for `frm.fields_dict` / `dialog.fields_dict`.
// One class hierarchy + factory, driven by two hosts (frm ↔ dialog).
export type { ControlHost } from './host'
export { frmHost, dialogHost } from './host'
export {
	FrappeControl,
	FrappeControlInput,
	FrappeControlData,
	FrappeContainerControl,
} from './frappeControl'
export type { ControlOpts } from './frappeControl'
export { FrappeControlLink, FrappeControlDynamicLink, FrappeControlSelect } from './linkSelect'
export { FrappeControlCheck } from './check'
export { FrappeControlCode, FrappeControlTextEditor } from './codeEditor'
export { FrappeControlAttach } from './attach'
export { FrappeControlHTML } from './htmlField'
export { FrappeGrid, FrappeControlTable, FrappeControlTableMultiSelect } from './frappeGrid'
export { makeControl } from './makeControl'
export type { MakeControlOpts } from './makeControl'
