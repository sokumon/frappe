<script setup lang="ts">
// `/:doctype/:name` is ambiguous: it is a document form (/sales-order/SO-001)
// unless the first segment is a Frappe Page, in which case the trailing
// segments are the page's own route args (e.g. /permission-manager/doctype).
// Mirrors legacy convert_to_standard_route: a Form only when route[0] is a
// known doctype, otherwise the page view.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Form from '@/pages/Form.vue'
import Page from '@/pages/Page.vue'
import NotFound from '@/pages/NotFound.vue'
import { getDoctypeRoute, isAllowedPage } from '@/router/compat'

const route = useRoute()
const first = computed(() => route.params.doctype as string)
const name = computed(() => route.params.name as string)
// doctype takes precedence (legacy checks this.routes[route[0]] first)
const isDoctype = computed(() => !!getDoctypeRoute(first.value))
const isPage = computed(() => !isDoctype.value && isAllowedPage(first.value))
</script>

<template>
	<Page v-if="isPage" :name="first" />
	<Form v-else-if="isDoctype" :key="first" :doctype="first" :name="name" />
	<NotFound v-else />
</template>
