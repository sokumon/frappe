// Vitest setupFile: stateless globals the desk code reads off `globalThis`. The
// per-test `frappe` / `$` / `locals` harness is installed by `installFrappeStub()`
// (frappeStub.ts) inside each test; here we only provide the tiny helpers modules
// may reference incidentally, and clear the harness after every test.
import { afterEach } from 'vitest'
import { resetFrappeStub } from './frappeStub'

;(globalThis as any).__ = (s: any, replace?: any[]) => {
	let out = s == null ? '' : String(s)
	if (Array.isArray(replace)) replace.forEach((r, i) => (out = out.replace(`{${i}}`, String(r))))
	return out
}
;(globalThis as any).cint = (v: any) => {
	const n = parseInt(v, 10)
	return isNaN(n) ? 0 : n
}
;(globalThis as any).cstr = (v: any) => (v == null ? '' : String(v))
;(globalThis as any).flt = (v: any) => {
	const n = parseFloat(v)
	return isNaN(n) ? 0 : n
}
;(globalThis as any).is_null = (v: any) => v === null || v === undefined || v === ''

afterEach(() => resetFrappeStub())
