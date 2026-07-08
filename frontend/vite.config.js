import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import frameworkUI from '@framework/ui/vite'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
	define: {
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
	},
	plugins: [
		vue(),
		// @framework/ui ships raw source compiled in place by this bundler; dedupe
		// its bare imports of vue/vue-router/frappe-ui/reka-ui/dompurify to the
		// host's single copy (else provide/inject + Vue identity break).
		frameworkUI(),
		frappeui({
			frappeProxy: true,
			lucideIcons: true,
			jinjaBootData: true,
			buildConfig: {
				indexHtmlPath: `../${getAppName()}/www/${getAppName()}.html`,
			},
		}),
	],
	server: {
		allowedHosts: true,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'tailwind.config.js': path.resolve(__dirname, 'tailwind.config.js'),
		},
	},
	optimizeDeps: {
		// frappe-ui v1 ships as source and its TextEditor imports `~icons/lucide/*`
		// virtual modules that only its own Vite plugin (LucideIconsPlugin) can
		// resolve. esbuild's dep pre-bundler doesn't run that plugin, so it must NOT
		// pre-bundle frappe-ui — exclude it and let the dev plugin pipeline serve it.
		exclude: ['frappe-ui'],
		// `highlight.js/lib/core` and `interactjs` are added by the frappeui plugin
		// itself; `showdown` was dropped in frappe-ui v1 (it uses `marked` now).
		include: ['frappe-ui > feather-icons', 'tailwind.config.js', 'engine.io-client'],
	},
})

function getAppName() {
	// frappe-ui projects are structured as follows:
	// - apps
	//   - <app_name>
	//     - frontend
	//       - vite.config.js
	return path.basename(path.resolve(__dirname, '../..'))
}
