<script setup lang="ts">
// The `/:slug` route is ambiguous: the slug may be a public workspace, a
// Frappe Page or a doctype. The guard (resolveSlug) has already loaded any
// required meta, redirected doctypes with a non-list default view and 404'd
// unknown slugs; here we only choose which component to render for what
// remains.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import List from '@/pages/List.vue'
import Workspace from '@/pages/Workspace.vue'
import Page from '@/pages/Page.vue'
import Form from '@/pages/Form.vue'
import { isAllowedPage } from '@/router/compat'

const route = useRoute()

const slug = computed(() => route.params.slug as string)
const isWorkspace = computed(() => !!frappe.workspaces?.[slug.value])
const isPage = computed(() => isAllowedPage(slug.value))
// real doctype behind the slug (meta already loaded by resolveSlug)
const doctype = computed(() => frappe.router.routes?.[slug.value]?.doctype)
const isSingle = computed(() => !!doctype.value && frappe.model?.is_single?.(doctype.value))
</script>

<template>
	<Workspace v-if="isWorkspace" />
	<Page v-else-if="isPage" :name="slug" />
	<!-- single doctype: the document name is the doctype itself -->
	<Form v-else-if="isSingle" :doctype="slug" :name="doctype" />
	<!-- plain list: pass the resolved doctype so List needn't re-derive it -->
	<List v-else :doctype="doctype || slug" />
</template>
