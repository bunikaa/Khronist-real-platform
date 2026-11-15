import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { apiOriginFor } from './api/origin.ts'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => ({
    name: 'Хроніст',
    host_permissions: [`${apiOriginFor(mode)}/*`],
    action: {
      default_title: 'Відкрити Хроніст',
    },
    commands: {
      'open-panel': {
        suggested_key: { default: 'Alt+Shift+X' },
        description: 'Відкрити панель Хроніста, повторно — виділити фрагмент',
      },
    },
  }),
})
