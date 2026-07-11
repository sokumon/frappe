<template>
	<div ref="host" class="prose prose-sm max-w-none text-ink-gray-8">
		<!-- Fallback: static dev-authored HTML from meta (no frm-backed $wrapper,
			 e.g. stories). When a frm handle exists we adopt its live node instead. -->
		<!-- eslint-disable-next-line vue/no-v-html -->
		<div v-if="!adopted" v-html="sanitized" />
	</div>
</template>

<script setup lang="ts">
// HTML fields are a DOM escape hatch: Frappe client scripts inject content via
// `frm.fields_dict[fieldname].$wrapper.html(...)` (e.g. erpnext Item's
// render_item_prices). The frm creates that `$wrapper` node eagerly (before the
// refresh script runs), so here we ADOPT the same live node — script writes then
// show up in the Vue form, and later `$wrapper.html()` calls update it in place.
//
// Falls back to a sanitized render of `field.options` when there's no frm (stories,
// static schema). Script-injected HTML is not re-sanitized (parity with desk's raw
// `$wrapper.html()`).
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import DOMPurify from "dompurify";
import type { FieldComponentProps } from "./types";

const props = defineProps<FieldComponentProps>();

const sanitized = computed(() => DOMPurify.sanitize(props.field.options ?? ""));

const host = ref<HTMLElement>();
// `frm` is provided by the desk shell's Form.vue as a ref; null in stories.
const frm = inject<{ value: any } | null>("frm", null);
const adopted = ref(false);
let node: HTMLElement | null = null;

onMounted(() => {
	const handle = frm?.value?.fields_dict?.[props.field.fieldname];
	const el = handle?.$wrapper?.[0] as HTMLElement | undefined;
	if (el && host.value) {
		// Seed with static options only if no script wrote content yet.
		if (!el.innerHTML && props.field.options) el.innerHTML = sanitized.value;
		host.value.appendChild(el);
		node = el;
		adopted.value = true;
	}
});

onBeforeUnmount(() => {
	// Detach (don't destroy): the fields_dict handle keeps the node so a later
	// remount re-adopts it with the script's content intact.
	if (node?.parentNode) node.parentNode.removeChild(node);
});
</script>
