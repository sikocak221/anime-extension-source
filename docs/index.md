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
    details: Written in TypeScript with the published SDK, tested against saved pages of the sites, and checked against the real ones every day.
---

::: info Disclaimer
This repository is independent of Matane Anime. It does not host, store or distribute any content, and its developers have no affiliation with the sites its extensions read. See the [FAQ and disclaimer](/faq).
:::
