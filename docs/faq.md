# FAQ and disclaimer

## What is "Trust this key"?

Every index of this repository is signed. The app compares the key the repository announces with the one you chose to trust, so a changed or replaced index is refused. Compare the fingerprint the app shows with the one on the [repository page](/repository) before you trust it.

## An extension stopped working

What an extension reads can change, stall or block requests at any time, so an extension may stop working for a while. Look at the [issues](https://github.com/sikocak221/anime-extension-source/issues); if it is not there yet, open one with the extension name and what you saw.

## Why does the app show "Unverified repository"?

The index is signed, but you did not choose to trust the key, or you added the repository by another address. Use the address on the [repository page](/repository).

## Can I ask for a new extension?

Yes: open an issue. A pull request is faster; see [CONTRIBUTING](https://github.com/sikocak221/anime-extension-source/blob/main/CONTRIBUTING.md).

## What if the key changes?

Users who trusted the old key will refuse an index signed with a new one, by design. A change of key is announced here and in the README, and you remove the repository and add it again, trusting the new key. Your installed extensions keep working, without updates, until you install them again.

## Disclaimer

This repository contains source code only. It does not host, store, index or distribute any anime, video, subtitle, image or other content, and its developers have no affiliation with, and do not endorse, any third-party site. The code is provided as is, for interoperability, and does what you ask the app to do. You are responsible for what you access and for following the laws of your country. Please respect the creators.

## Copyright and takedown requests

If you own rights in something that this repository makes available, see [Copyright and takedown](/takedown).
