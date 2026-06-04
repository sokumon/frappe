<script setup lang="ts">
// FrappeUIProvider mounts <Dialogs /> + <ToastProvider />, which the v1
// imperative dialog/toast APIs render into.
import { FrappeUIProvider } from 'frappe-ui'
</script>

<template>
	<FrappeUIProvider>
		<div class="flex h-screen w-screen">
			<router-view />
		</div>
	</FrappeUIProvider>
</template>
