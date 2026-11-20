# Privacy Policy

Last updated: 2026-11-03

TF2 Trading Enhancer is a browser extension for Chrome and Firefox. This page explains what data it handles, where it goes, and what it doesn't do.

## The short version

This extension sends no data about you to the developer, and the developer stores nothing about you. The only requests to the developer's own server are plain image downloads (the larger Unusual effect pictures). Your Steam Web API key stays on your device and is used only to talk directly to Steam.

## Data stored only on your device

The extension stores the following locally, using the browser's own extension storage. This data is never transmitted to the developer and never leaves your device except as described below:

- Your Steam Web API key, if you provide it
- Cached prices, the TF2 item schema (refreshed weekly) and rate-limit bookkeeping, to avoid repeat lookups
- Your settings (e.g. the trade offer sound and its volume)
- The alert sound file you choose, if you add your own
- The backpack.tf listing links you clicked in the last 10 minutes, so the trade-offer page only pre-fills items for a link you really opened there
- Your own Steam trade offer link, if you enter it for backpack.tf's Listing Queue

## Data sent directly to third-party services

To show prices, links and checks, the extension calls these services directly from your browser. The developer never sees, stores, or proxies this traffic:

- **Steam Web API** (api.steampowered.com), only with your own Steam Web API key: your incoming trade offers (for the alerts), the TF2 item schema, and the TF2 inventory of a Steam profile you're viewing.
- **Steam Community** (steamcommunity.com), using your existing Steam login: Market prices and listing pages (including the multibuy page that prices Buy Parts), English item descriptions when Steam is shown in another language, and the sell requests you start yourself with Quick Sell, Instant Sell or Bulk Sell.
- **backpack.tf**: listings you publish with the Listing Queue go to backpack.tf using your existing backpack.tf login.
- **rep.tf**: the SteamID64 of the trade partner or Steam profile being checked for bans.
- **pricedb.io**: the names of items you look at, to find their prices.
- **marketplace.tf**: on marketplace.tf's own pages only, one lookup of the current key price.

On scrap.tf, stntrading.eu, mannco.store and posts.tf the extension only reads and adds to the pages you open; it sends nothing extra to them. Each of these services is governed by its own privacy policy.

Unusual effect images: the small ones ship with the extension. The larger ones (shown behind an item's large picture), and the small ones of effects newer than your version of the extension, are loaded from the developer's own image host on Cloudflare. That is an ordinary image request, like any picture on a website: it carries no keys, account or browsing data, only what any image load reveals (your IP address and which image). The developer keeps no logs of these requests.

## What this extension does not do

- No analytics or tracking of your browsing activity
- No advertising, and no data sold or shared with advertisers
- No accounts and no data collection: besides the services listed above and the image host, there is no server this extension talks to

## Children's privacy

This extension is not directed at children. It requires a Steam account, and Steam itself requires users to be at least 13 years old.

## Changes to this policy

If this policy changes, the "Last updated" date above will be updated accordingly.

## Contact

For privacy questions, contact the developer:

- Steam: [steamcommunity.com/id/allen0246](https://steamcommunity.com/id/allen0246/)
- Discord: allen0246
