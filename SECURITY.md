# Security policy

The extensions in this repository run in the app's sandbox, but they still read pages and streams from third-party sites, and the repository is signed so that users can tell it was not tampered with. These are security issues:

- an extension that leaks anything it should not (cookies, tokens, local data), or that makes the app reach something other than the site it is for
- a way to publish an extension, or an index, that is not signed by this repository's key
- the signing key (`MA_REPO_KEY`) being exposed

## Reporting

Please **do not open a public issue**. Report privately through GitHub: **Security → Report a vulnerability** on [sikocak221/anime-extension-source](https://github.com/sikocak221/anime-extension-source/security/advisories/new). Include the extension, its version and what you saw.

You should get an answer within a week. If the signing key is ever exposed, the key is replaced and users are asked to remove the repository and add it again, trusting the new key; this is announced in the README and on the site.

## Supported versions

Only the repository as published on GitHub Pages: the latest version of each extension.
