// provide/inject glue so a view rendered inside <PageShell> can drive the page
// chrome (page-migration.md §4). PageShell calls `providePage`; the slotted view
// calls `usePage` to get the same bridge object legacy code reaches via
// `opts.parent.page`.

import { inject, provide, type InjectionKey } from 'vue'
import type { Page } from './types'

export const PageKey: InjectionKey<Page> = Symbol('page')

export function providePage(page: Page) {
	provide(PageKey, page)
}

export function usePage(): Page {
	const page = inject(PageKey)
	if (!page) {
		throw new Error('usePage() must be called inside a <PageShell>')
	}
	return page
}
