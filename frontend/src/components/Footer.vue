<script setup lang="ts">
// The page footer (page-migration.md §3). A full-width bar pinned to the bottom
// of the page content: it renders after the flex-1 `main` region, so it stays
// below the scroll area instead of scrolling away. Backs the legacy
// `page.footer` element ref (layout-footer) that legacy code appends DOM into —
// e.g. the list view moves its pagination here in the Vue shell.
//
// It carries no chrome of its own and collapses to zero height when empty, so
// whatever is placed inside (slot content or imperatively appended DOM) defines
// its own look.
</script>

<template>
	<footer class="layout-footer shrink-0">
		<slot />
	</footer>
</template>
