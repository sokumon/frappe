import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import frappeui from 'frappe-ui/vite'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		frappeui(),
		vue(),
		{
			name: 'transform-index.html',
			transformIndexHtml(html, context) {
				if (!context.server) {
					return html.replace(
						/<\/body>/,
						`
            <script>
                {% for key in boot %}
                window["{{ key }}"] = {{ boot[key] | tojson }};
                {% endfor %}
            </script>
            </body>
            `
					)
				}
				return html
			},
		},
	],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
	build: {
		outDir: '../frappe/public/portal',
		emptyOutDir: true,
		commonjsOptions: {
			include: [/preset.js/, /node_modules/],
		},
		// minify: false,
		sourcemap: true,
	},
	optimizeDeps: {
		include: ['feather-icons', 'showdown', 'engine.io-client', 'tailwind.config.js'],
	},
})
