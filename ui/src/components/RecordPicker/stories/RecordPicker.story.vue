<!--
  Isolated RecordPicker demo — the multi-select record picker dialog against a
  live doctype, with setter filters, the advanced Filter builder, and the pick
  payload a host (e.g. the desk MultiSelectDialog shim) would receive.
-->
<template>
	<div class="flex flex-col gap-4 p-6">
		<div class="flex items-center gap-2">
			<span class="text-p-sm text-ink-gray-6">Doctype</span>
			<Select v-model="doctype" :options="doctypeOptions" class="w-56" />
			<Button variant="solid" @click="open = true">Open picker</Button>
		</div>

		<RecordPicker
			:key="doctype"
			v-model:open="open"
			:doctype="doctype"
			:setters="setters[doctype]"
			:show-filters="true"
			:secondary-action-label="`Make ${doctype}`"
			@pick="onPick"
			@make-new="onMakeNew"
		/>

		<div class="flex flex-col gap-1 text-xs text-ink-gray-6">
			<div>pick payload = {{ payload }}</div>
			<div>makeNew values = {{ makeNewValues }}</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Button, Select } from "frappe-ui";
import { RecordPicker } from "../index";
import type { RecordPickerPayload } from "../index";
import type { RawMetaField } from "../../FormLayout/types";

const doctype = ref("ToDo");
const doctypeOptions = ["ToDo", "Contact", "User"];

const setters: Record<string, RawMetaField[]> = {
	ToDo: [
		{
			fieldtype: "Select",
			fieldname: "status",
			label: "Status",
			options: "Open\nClosed\nCancelled",
		},
		{ fieldtype: "Link", fieldname: "allocated_to", label: "Allocated To", options: "User" },
	],
	Contact: [{ fieldtype: "Data", fieldname: "first_name", label: "First Name" }],
	User: [{ fieldtype: "Data", fieldname: "first_name", label: "First Name" }],
};

const open = ref(false);
const payload = ref<RecordPickerPayload | null>(null);
const makeNewValues = ref<Record<string, any> | null>(null);

function onPick(p: RecordPickerPayload) {
	payload.value = p;
	open.value = false;
}

function onMakeNew(values: Record<string, any>) {
	makeNewValues.value = values;
	open.value = false;
}
</script>
