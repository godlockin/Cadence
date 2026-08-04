import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'PulseDeck',
  description: 'Self-hosted scheduled task orchestration — TypeScript, dual-runtime (Cloudflare Workers + Node.js).',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#3b82f6' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/api-reference' },
      { text: 'Changelog', link: '/changelog' },
      {
        text: 'v1.0',
        items: [
          { text: 'GitHub', link: 'https://github.com/your-org/pulsedeck' },
          { text: 'Release Notes', link: '/changelog' },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          {
            text: 'Deployment',
            items: [
              { text: 'Local (Node.js)', link: '/deployment/local' },
              { text: 'Docker', link: '/deployment/docker' },
              { text: 'Cloudflare Workers', link: '/deployment/cloudflare' },
            ],
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Node Catalog (30)', link: '/reference/nodes' },
          { text: 'HTTP API', link: '/api-reference' },
          { text: 'Credentials & Secrets', link: '/reference/credentials' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Node Pipeline', link: '/node-pipeline' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: 'https://github.com/your-org/pulsedeck/blob/main/CONTRIBUTING.md' },
        ],
      },
    ],
    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2026 PulseDeck contributors',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/your-org/pulsedeck' }],
  },
})
