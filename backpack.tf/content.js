/*
@description: Routes backpack.tf pages to the right feature script based on
the hostname/pathname, and reports which ones are active back to the popup.
*/
async function routeBackpackTf() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  const url = new URL(window.location.href);

  // Don't load scripts for the forums subdomain.
  if (url.hostname.includes("forums")) {
    registry.settle();
    return;
  }

  // Killstreak nav buttons: old UI only ("next" is next.backpack.tf's new
  // UI, which has no equivalent nav), and only on stats/classifieds pages.
  if (
    !url.hostname.includes("next") &&
    (url.pathname.includes("stats") || url.pathname.includes("classifieds"))
  ) {
    const { createKSButtons } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addKSButtons/content.js")
    );
    createKSButtons(url);
    registry.label("Killstreak Buttons");
  }

  // Trade offer link fix: site-wide on both UIs (each's own MutationObserver
  // only ever acts on that UI's own trade-offer anchor shape - a harmless
  // no-op on any page with no Sell/Buy Order listings).
  if (url.hostname.includes("next")) {
    const { fixTradeOfferLinks } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/fixTradeOfferLinks/content.js")
    );
    fixTradeOfferLinks();
    registry.label("Trade Offer Link Fix");

    // Item-preview hover tooltip's stntrading.eu button: site-wide, inserted
    // right BEFORE the Marketplace.tf button's own row - its own href needs the
    // same full resolveStatsAndClassifieds resolution Marketplace.tf's does, but
    // only its INSERTION depends on Marketplace.tf's own button existing (see
    // its own header note).
    const { addStnButton } = await import(chrome.runtime.getURL("backpack.tf/nextUI/addStnButton/content.js"));
    addStnButton();
    registry.label("STNTrading.eu Button");

    // Item-preview hover tooltip's marketplace.tf button: site-wide (not
    // page-restricted) since it self-scopes off the tooltip's own Classifieds
    // button, which can appear anywhere next.backpack.tf shows an item icon.
    const { addMarketplaceButton } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/addMarketplaceButton/content.js")
    );
    addMarketplaceButton();
    registry.label("Marketplace.tf Button");

    // Item-preview hover tooltip's mannco.store button: site-wide, inserted
    // right into the Marketplace.tf button's own row - unlike every other
    // button here, needs no network call/schema resolution at all (see its
    // own header note), so it's independent of Steam Web API key
    // configuration; only its INSERTION depends on Marketplace.tf's own
    // button existing, not its ability to build a link.
    const { addMannStoreButton } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/addMannStoreButton/content.js")
    );
    addMannStoreButton();
    registry.label("Mannco.store Button");

    // Item-preview hover tooltip's gladiator.tf button: site-wide, same
    // self-scoping as the Marketplace.tf button just above (its own tooltip
    // Classifieds anchor) - deliberately independent of that feature's own
    // success/failure (see its own header note on why), so this still works
    // for item types marketplace.tf's own stricter resolution can't handle.
    const { addGladiatorButton } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/addGladiatorButton/content.js")
    );
    addGladiatorButton();
    registry.label("Gladiator.tf Button");

    // Item-preview hover tooltip's pricedb.io button: site-wide, same
    // self-scoping as the buttons just above. Resolved via pricedb.io's own
    // /api/search (see utils/pricedb.js's own header note), not a manually
    // built SKU - inserted right into the Gladiator.tf button's own row (see
    // its own header note on why depending on that button specifically is
    // safe, unlike depending on the Marketplace.tf button's own resolution).
    const { addPricedbButton } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/addPricedbButton/content.js")
    );
    addPricedbButton();
    registry.label("PriceDB.io Button");

    // Item-preview hover tooltip's posts.tf button: site-wide, same
    // self-scoping as the buttons above. posts.tf's own search schema was
    // reverse-engineered live (see utils/tf2StatsLinks/index.js's own
    // buildPostsTfLink for the full write-up) and needs a real Valve
    // defindex, unlike every other button here - resolveStatsAndClassifieds
    // already resolves that via getItemDefindex. Generic items only for now
    // (plain/painted/Unusual/Killstreak/Spelled) - Kits/Fabricators/War
    // Paint tools/Decorated Weapons/target-item tools all resolve to no
    // button, same "not built yet" scope gap addMannStoreButton documents
    // for a similar set of item types.
    const { addPostsTfButton } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/addPostsTfButton/content.js")
    );
    addPostsTfButton();
    registry.label("posts.tf Button");

    // Same marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf
    // quick links as the item-preview tooltip above, but on the /stats
    // page's own "Item Information" card header instead - self-scopes off
    // finding that card's own title text, so a no-op everywhere else (see
    // its own header note on scope: plain items and Unusuals only for now).
    const { statsPageQuickLinks } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/statsPageQuickLinks/content.js")
    );
    statsPageQuickLinks();
    registry.label("Stats Page Quick Links");

    // Same
    // marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf/stntrading.eu
    // quick links as the /stats page above, but on the "Suggest an item"
    // form (/suggestions/create) instead, underneath its own item editor -
    // self-scopes off an explicit pathname check plus finding that editor
    // (see its own header note: no Killstreak-tier switcher here).
    const { suggestionsQuickLinks } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/suggestionsQuickLinks/content.js")
    );
    suggestionsQuickLinks();
    registry.label("Suggestions Quick Links");

    // Same quick links as the two above, but on a single suggestion's own
    // detail page (/suggestions/{id}, not /suggestions/create) instead -
    // self-scopes off an explicit pathname check plus finding the item
    // preview anchor's own href (see its own header note: no
    // Killstreak-tier switcher here either, same reasoning).
    const { suggestionDetailQuickLinks } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/suggestionDetailQuickLinks/content.js")
    );
    suggestionDetailQuickLinks();
    registry.label("Suggestion Detail Quick Links");

    // Click-to-copy item name: site-wide (not page-restricted), same
    // reasoning as the Marketplace.tf button just above - self-scopes off
    // whichever of its own two target selectors is present.
    const { copyItemName } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/copyItemName/content.js")
    );
    copyItemName();
    registry.label("Copy Item Name");

    // Spell highlight: site-wide (not page-restricted) - self-scopes off
    // an item tile's own .item__icons markup, so this is a no-op wherever
    // no item tiles are rendered.
    const { spellHighlight } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/spellHighlight/content.js")
    );
    spellHighlight();
    registry.label("Spell Highlight");

    // Effect/War Paint page class filter: restricted to /effects/<name> and
    // /war-paints/<name> pages (see its own isSupportedPage), plus
    // self-scopes off finding item tiles and the page's own "Search by
    // name" input. Needs a Steam Web API key (see its own header note on why,
    // unlike the classic-UI version) and shows a "needs a key" pill without
    // one.
    const { effectClassFilter } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/effectClassFilter/content.js")
    );
    effectClassFilter();
    registry.label("Effect Class Filter");

    // "Unusual type" (Hat/Taunt/Weapon) dropdown for the bare /effects list
    // page: site-wide - self-scopes off finding effect-listing items plus
    // an exact pathname check (the opposite of effectClassFilter's own
    // exclusion of this same page). Shows a "needs a key" pill with no Steam
    // Web API key configured.
    const { effectCategoryFilter } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/effectCategoryFilter/content.js")
    );
    effectCategoryFilter();
    registry.label("Effect Category Filter");

    // Items catalog table (/items) Class/Priced-Quality filters:
    // self-scopes off an exact pathname check (its own isSupportedPage) plus
    // finding the table's own real "Search by name" column filter to anchor
    // on. The Quality filter needs no Steam Web API key (reads straight off
    // the table's own DOM); the Class filter does (schema lookup) and shows a
    // "needs a key" pill without one, same as effectClassFilter above.
    const { itemsTableFilters } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/itemsTableFilters/content.js")
    );
    itemsTableFilters();
    registry.label("Items Table Filters");

    // Spell filter toggle button: site-wide, not gated on a classifieds
    // pathname here. The pathname check lives inside spellFilterToggle's own
    // scan (see its ensureButton note), so it self-corrects on every
    // MutationObserver tick during in-app (SPA) navigation. See #26. See #27.
    const { spellFilterToggle } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/spellFilterToggle/content.js")
    );
    spellFilterToggle();
    registry.label("Spell Filter Toggle");

    // Strange (Elevated Quality) filter toggle: same show-by-default,
    // hide-on-click mechanism as the Spell filter toggle just above, but
    // via a DOM class scan (item__elevated_strange) rather than driving a
    // native filter VALUE - confirmed live there's no "None"/"No Elevated
    // Quality" value the way Spells has "No Spells" (see its own header
    // note), so the native funnel mechanism can't express "hide Strange"
    // here. Built site-wide with its own pathname self-check from the
    // start, same as Killstreak Tier Filter below.
    const { strangeFilterToggle } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/strangeFilterToggle/content.js")
    );
    strangeFilterToggle();
    registry.label("Strange Filter Toggle");

    // War Paint filter toggle: same funnel/trait-filter mechanism as the
    // Spell filter toggle above (confirmed live: "War Paints" has its own
    // "No War Paint" value, same shape "No Spells" has), built site-wide
    // with its own pathname self-check from the start.
    const { warPaintFilterToggle } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/warPaintFilterToggle/content.js")
    );
    warPaintFilterToggle();
    registry.label("War Paint Filter Toggle");

    // Killstreak-tier filter buttons (None/Standard/Specialized/
    // Professional): same funnel/trait-filter mechanism as the Spell
    // filter toggle above, site-wide with its own pathname self-check (see
    // its own header note).
    const { killstreakTierFilter } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/killstreakTierFilter/content.js")
    );
    killstreakTierFilter();
    registry.label("Killstreak Tier Filter");

    // Premium Search ("Almanac" item-history search) last-seen highlighter:
    // site-wide, same self-scoping as the features above (its own "Last
    // Seen"-column table check) - a no-op everywhere else, including for a
    // non-Premium user who can't reach that page's real results at all.
    const { premiumSearchLastSeenHighlight } = await import(
      chrome.runtime.getURL("backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js")
    );
    premiumSearchLastSeenHighlight();
    registry.label("Premium Search Last Seen Highlight");
  } else {
    const { fixTradeOfferLinks } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/fixTradeOfferLinks/content.js")
    );
    fixTradeOfferLinks();
    registry.label("Trade Offer Link Fix");

    // Item hover popover's stntrading.eu button: site-wide, same self-scoping
    // as the buttons below - inserted right before marketplace.tf in their
    // shared "secondary" row (see oldUI/linkButtonsRow.js's own
    // buttonOrder).
    const { addStnButton } = await import(chrome.runtime.getURL("backpack.tf/oldUI/addStnButton/content.js"));
    addStnButton();
    registry.label("STNTrading.eu Button");

    // Item hover popover's marketplace.tf button: site-wide (not
    // page-restricted) since it self-scopes off the popover's own
    // "#popover-additional-links" row, which can appear anywhere classic
    // backpack.tf shows an item icon.
    const { addMarketplaceButton } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addMarketplaceButton/content.js")
    );
    addMarketplaceButton();
    registry.label("Marketplace.tf Button");

    // Item hover popover's mannco.store button: site-wide, same self-scoping
    // as the Marketplace.tf button just above - needs no network call/schema
    // resolution at all (see its own header note).
    const { addMannStoreButton } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addMannStoreButton/content.js")
    );
    addMannStoreButton();
    registry.label("Mannco.store Button");

    // Item hover popover's gladiator.tf button: site-wide, same self-scoping
    // as the buttons above - deliberately independent of Marketplace.tf's own
    // success/failure (see its own header note on why).
    const { addGladiatorButton } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addGladiatorButton/content.js")
    );
    addGladiatorButton();
    registry.label("Gladiator.tf Button");

    // Item hover popover's pricedb.io button: site-wide, same self-scoping as
    // the buttons above. Resolved via pricedb.io's own /api/search (see
    // utils/pricedb.js's own header note), not a manually built SKU.
    const { addPricedbButton } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addPricedbButton/content.js")
    );
    addPricedbButton();
    registry.label("PriceDB.io Button");

    // Item hover popover's posts.tf button: site-wide, same self-scoping as
    // the buttons above. posts.tf's own search schema was reverse-engineered
    // live (see utils/tf2StatsLinks/index.js's own buildPostsTfLink) and
    // needs a real Valve defindex, unlike every button above -
    // resolveStatsAndClassifieds already resolves that via getItemDefindex.
    // Generic items only for now (plain/painted/Unusual/Killstreak/Spelled) -
    // Kits/Fabricators/War Paint tools/Decorated Weapons/target-item tools
    // all resolve to no button, same scope gap the next.backpack.tf version
    // has too.
    const { addPostsTfButton } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/addPostsTfButton/content.js")
    );
    addPostsTfButton();
    registry.label("posts.tf Button");

    // Same marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf
    // quick links as the item hover popover above, but on the /stats
    // page's own item info panel instead - self-scopes off finding that
    // panel's own ".stats-header-panel", so a no-op everywhere else (see
    // its own header note on scope: plain items and Unusuals only for now).
    const { statsPageQuickLinks } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/statsPageQuickLinks/content.js")
    );
    statsPageQuickLinks();
    registry.label("Stats Page Quick Links");

    // Same marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf/
    // stntrading.eu quick links as the /stats page above, but on the
    // "Create a price suggestion" page (/vote/...) instead, underneath its
    // own item panel - self-scopes off an explicit pathname check plus
    // finding that panel (see its own header note: no killstreak-tier
    // switcher here, this page has none).
    const { suggestionsQuickLinks } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/suggestionsQuickLinks/content.js")
    );
    suggestionsQuickLinks();
    registry.label("Suggestions Quick Links");

    // Click-to-copy item name: site-wide (not page-restricted), same
    // reasoning as the Marketplace.tf button just above - self-scopes off
    // whichever of its own target selectors is present (listing titles,
    // /stats page titles, hover popover titles).
    const { copyItemName } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/copyItemName/content.js")
    );
    copyItemName();
    registry.label("Copy Item Name");

    // Spell highlight: site-wide (not page-restricted) - self-scopes off
    // whatever carries data-spell_1, which only ever shows up on real item
    // elements (classifieds listings today, but not tied to that page).
    const { spellHighlight } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/spellHighlight/content.js")
    );
    spellHighlight();
    registry.label("Spell Highlight");

    // Profile "Send Trade Offer" link: site-wide - self-scopes off a
    // profile page's own .user-link/"Profile Information" markup, so this
    // is a no-op everywhere else.
    const { profileTradeLink } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/profileTradeLink/content.js")
    );
    profileTradeLink();
    registry.label("Profile Trade Link");

    // Effect page class filter: site-wide - self-scopes off a specific
    // effect page's own #unusual-pricelist-input-group + at least one
    // data-class-bearing item, and bails out if the native /unusuals
    // dropdown (#classmenu) is already present, so this is a no-op
    // everywhere else.
    const { effectClassFilter } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/effectClassFilter/content.js")
    );
    effectClassFilter();
    registry.label("Effect Class Filter");

    // Hat/Taunt toggle buttons for /unusuals: site-wide - self-scopes via an
    // explicit pathname check (see its own header note on why a DOM-only
    // signal isn't reliable here), so a no-op everywhere else.
    const { unusualCategoryFilter } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/unusualCategoryFilter/content.js")
    );
    unusualCategoryFilter();
    registry.label("Unusual Category Filter");

    // Custom "Group by ..." dropdown options for the inventory viewer's own
    // sort menu: site-wide - self-scopes off #inventory-sort-menu's own
    // presence, unique to that page, so a no-op everywhere else.
    const { inventoryGroupBy } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/inventoryGroupBy/content.js")
    );
    inventoryGroupBy();
    registry.label("Inventory Group By");

    // Ctrl+click-to-queue sell listings on the same page: site-wide -
    // self-scopes off an explicit "/profiles/" pathname check plus finding
    // #backpack (same reasoning inventoryGroupBy above already establishes
    // for this exact page).
    const { listingQueue } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/listingQueue/content.js")
    );
    listingQueue();
    registry.label("Listing Queue");

    // Tab-to-autocomplete for the Premium "Build a Search" modal's own
    // Texture Name field: site-wide - self-scopes off that field's own
    // presence (Premium-only, so a no-op for non-Premium users).
    const { premiumSearchSkinAutocomplete } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/premiumSearchSkinAutocomplete/content.js")
    );
    premiumSearchSkinAutocomplete();
    registry.label("Premium Search Skin Autocomplete");

    // Premium Search last-seen highlighter: site-wide, same self-scoping as
    // the two features above (its own ".premium-search-results" presence
    // check) - a no-op everywhere else, including for a non-Premium user.
    const { premiumSearchLastSeenHighlight } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/premiumSearchLastSeenHighlight/content.js")
    );
    premiumSearchLastSeenHighlight();
    registry.label("Premium Search Last Seen Highlight");

    // Hat/Taunt/Weapon toggle buttons for the bare /effects list page: an
    // exact pathname check inside the feature (single-item /unusual/{item}
    // pages share its markup), plus effect-listing items (data-effect_name
    // without data-class - the opposite of effectClassFilter's own signal,
    // see its own header note). Shows a "needs a key" button with no Steam
    // Web API key configured.
    const { effectCategoryFilter } = await import(
      chrome.runtime.getURL("backpack.tf/oldUI/effectCategoryFilter/content.js")
    );
    effectCategoryFilter();
    registry.label("Effect Category Filter");

    // Spell filter toggle button: only on classifieds pages, in the shared
    // controls row underneath the Killstreak-tier nav (#ks-tier-nav) the
    // block above already inserted - see
    // backpack.tf/oldUI/classifiedsControlsRow.js's own header note on that
    // shared row (moved out of the nav's own line, so the Killstreak-tier
    // nav gets a whole row to itself).
    if (url.pathname.includes("classifieds")) {
      const { spellFilterToggle } = await import(
        chrome.runtime.getURL("backpack.tf/oldUI/spellFilterToggle/content.js")
      );
      spellFilterToggle();
      registry.label("Spell Filter Toggle (old UI)");

      // Strange (Elevated Quality) filter toggle: same show-by-default,
      // hide-on-click mechanism as the Spell filter toggle just above, for
      // listings carrying an Elevated Quality of "Strange" specifically -
      // lands in the same shared controls row, after the spell toggle
      // button, purely because this call happens second (see
      // classifiedsControlsRow.js's own header note on why no explicit
      // "insert after X" logic is needed here).
      const { strangeFilterToggle } = await import(
        chrome.runtime.getURL("backpack.tf/oldUI/strangeFilterToggle/content.js")
      );
      strangeFilterToggle();
      registry.label("Strange Filter Toggle (old UI)");

      // Free-text listing search box: classic /classifieds has no way to
      // narrow a generic crafting-material search (Strangifier/Chemistry
      // Set/Kit/Fabricator) down to a specific target item the way
      // next.backpack.tf's own targetItem param can - lands in the same
      // shared controls row, after the spell/Strange toggle buttons above,
      // same "call order decides position" reasoning.
      const { classifiedsSearchFilter } = await import(
        chrome.runtime.getURL("backpack.tf/oldUI/classifiedsSearchFilter/content.js")
      );
      classifiedsSearchFilter();
      registry.label("Classifieds Search Filter");
    }
  }

  registry.settle();
}
routeBackpackTf();

/*
@description: Test-only hook for tests/backpackTfContent.test.js. A
globalThis assignment rather than `export`, because this file is loaded as a
classic content script, where `export` is a SyntaxError. Lets the tests re-
run the router against fresh fakes without re-importing (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__backpackTfTestHooks = { run: routeBackpackTf };
