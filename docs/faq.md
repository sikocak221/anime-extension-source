# FAQ and disclaimer

## What is "Trust this key"?

Every index of this repository is signed. The app compares the key the repository announces with the one you chose to trust, so a changed or replaced index is refused. Compare the fingerprint the app shows with the one on the [repository page](/repository) before you trust it.

## An extension stopped working

Sites change, stall and sometimes block requests. Every day the **Smoke test** workflow reads each real site and opens an issue when an extension fails, so it may already be known: look at the [issues](https://github.com/sikocak221/anime-extension-source/issues). If it is not there yet, open one with the extension name and what you saw.

## Why does the app show "Unverified repository"?

The index is signed, but you did not choose to trust the key, or you added the repository by another address. Use the address on the [repository page](/repository).

## Can I ask for a new extension?

Yes: open an issue. A pull request is faster; see [CONTRIBUTING](https://github.com/sikocak221/anime-extension-source/blob/main/CONTRIBUTING.md).

## What if the key changes?

Users who trusted the old key will refuse an index signed with a new one, by design. A change of key is announced here and in the README, and you remove the repository and add it again, trusting the new key. Your installed extensions keep working, without updates, until you install them again.

## Disclaimer

This repository does not host, store or distribute any anime or other content, and its developers have no affiliation with the sites its extensions read. The extensions only read pages and streams that the sites make public. Please respect the creators and the laws of your country.
