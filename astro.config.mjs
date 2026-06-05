import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.marijuananews.com',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
