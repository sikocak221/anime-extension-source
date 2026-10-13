---
layout: home

hero:
  image:
    src: /logo.png
    alt: Matane Anime
  name: Anime Extension Source
  text: A signed extension repository for Matane Anime
  tagline: Add one link to the app, trust its key, and install the sources you want.
  actions:
    - theme: brand
      text: Add the repository
      link: /repository
    - theme: alt
      text: Extensions
      link: /extensions

features:
  - title: Signed
    details: Every index is signed with this repository's Ed25519 key, and every archive must match the SHA-256 in that signed index before the app installs it.
  - title: Yours to choose
    details: Nothing is added to the app by default. You add the repository, and you decide whether to trust its key.
  - title: Sandboxed
    details: Extensions run in the app's sandbox and reach the network only through it.
  - title: Open source
    details: Written in TypeScript with the published SDK and tested offline. Read the code before you trust it.
---

::: info Disclaimer
This repository contains source code only. It does not host, store, index or distribute any video, subtitle, image or other content, it is independent of Matane Anime, and it has no affiliation with, or endorsement of, any third-party site. See the [FAQ and disclaimer](/faq) and the [copyright and takedown process](/takedown).
:::
