# Contributing

Thanks for helping improve TF2 Trading Enhancer. Every feature in this
repository is free for everyone.

## What this repository is for

- **Bug reports and feature ideas**: open an issue. For quick questions, or
  if you don't have a GitHub account, ask on the
  [Discord server](https://discord.gg/Kbxv8TRNfD).
- **Pull requests** for the features in this repository.

## Feature ideas

Open an issue before writing code for a new feature, so we can agree on it
first and you don't spend time on something that won't be merged.

Features are declined when they would harm the TF2 market or other traders
(for example sniping or mass undercutting automation), break a site's rules
or terms (for example scraping a site that doesn't allow it), or put
unreasonable load on the sites the extension works with.

## Pull requests

- **Bug fixes**: include a test that fails without the fix.
- **Tests**: run `npm test` before opening the PR. CI runs it again on every
  pull request. No `npm install` is needed.
- **No new dependencies**: `package.json` has none and stays that way. Minified
  or generated code without its source isn't accepted either.
- **Style**: match the surrounding code's style and comments. Use LF line
  endings.
- **Scope**: keep each PR to one change; small PRs get reviewed faster.

Every pull request is read in full and tested in the browser before it is
merged, so expect questions. Changes to permissions, network requests or trade
offer handling get a closer look, since the extension runs with access to your
Steam session.

## License of contributions

This repository is licensed under the [MIT License](LICENSE). By opening a pull
request, you agree that your contribution is licensed under the MIT License
and may be included in the official store builds of the extension. Your
contribution stays free and part of this repository, and you keep the
copyright to it.

## Contact

- Steam: [steamcommunity.com/id/allen0246](https://steamcommunity.com/id/allen0246/)
- Discord: allen0246
- Discord server: [discord.gg/Kbxv8TRNfD](https://discord.gg/Kbxv8TRNfD)
