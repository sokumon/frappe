<template>
	<div class="h-screen w-screen flex">
		<PortalSidebar />
		<!-- other page content -->
	</div>
</template>

<script setup>
import { Dialog } from 'frappe-ui'
import PortalSidebar from '../components/PortalSidebar.vue'
</script>
