import { defineConfig } from 'vitepress';

const repo = 'https://github.com/sikocak221/anime-extension-source';

// The site is served from https://<owner>.github.io/anime-extension-source/, next to index.json and the archives
// (scripts/build-site.mjs copies the build into public/). `docs/repository.md` and `docs/extensions.md` are written
// by that script from the repository it just built.
const base = process.env['DOCS_BASE'] ?? '/anime-extension-source/';

export default defineConfig({
  title: 'Anime Extension Source',
  description: 'A signed extension repository for Matane Anime.',
  lang: 'en-US',
  base,
  head: [['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }]],
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Add the repository', link: '/repository' },
      { text: 'Extensions', link: '/extensions' },
      { text: 'FAQ', link: '/faq' },
      { text: 'Write an extension', link: '/new-extension' },
    ],
    sidebar: [
      {
        text: 'Use it',
        items: [
          { text: 'Add the repository', link: '/repository' },
          { text: 'Extensions', link: '/extensions' },
          { text: 'FAQ and disclaimer', link: '/faq' },
        ],
      },
      {
        text: 'Contribute',
        items: [{ text: 'Write an extension', link: '/new-extension' }],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: {
      message:
        'This repository does not host, store or distribute any content, and is independent of Matane Anime. Released under the MIT license.',
    },
  },
});
