/**
 * Shared environment shim + utilities for the trade-offer composer enhancer.
 * Builds `DEPS` (ATTRIBUTE_CACHE_VERSION, WINDOW, $, Utils, shared helpers, storage helpers) used by every
 * file in pages/. Must load before any file in pages/ and before bootstrap.js.
 */
(function () {
'use strict';

const DEPS = (function() {
    // Version prefix of addAttributesToHoverItems' localStorage attribute
    // cache key - bump it to invalidate every cached entry (its
    // cleanupStaleVersions removes the old keys).
    const ATTRIBUTE_CACHE_VERSION = '2.2.7';
    // our window object for accessing globals
    const WINDOW = window;
    // dependencies to provide to each page script
    const $ = WINDOW.jQuery;
    
    /**
     * Currencies.
     * @typedef {Object} Currencies
     * @property {number} [keys] - Number of keys.
     * @property {number} [metal] - Amount of metal.
     */
    
    /**
     * Utility functions
     * @namespace Utils
     */
    const Utils = {
        /**
         * Get URL parameters
         * @returns {Object<string, string>} Object containing url parameters e.g. {'item': 'Fruit Shoot'}
         */
        getURLParams() {
            const params = {};
            const pattern = /[?&]+([^=&]+)=([^&]*)/gi;

            window.location.search.replace(pattern, (str, key, value) => {
                // "+" is the conventional space encoding in a query string
                // (application/x-www-form-urlencoded - the same encoding
                // URLSearchParams.set produces), decoded here before
                // decodeURIComponent, which only understands %XX sequences
                // and otherwise leaves a literal "+" alone. Without this, any
                // param value containing a space (e.g. for_item_name, see
                // backpack.tf/nextUI/fixTradeOfferLinks/content.js) would
                // arrive here with literal "+" characters instead of spaces.
                const spaced = value.replace(/\+/g, ' ');

                // A malformed escape (e.g. "&x=%") makes decodeURIComponent
                // throw. Callers run this first in their page setup, so one
                // bad param anyone can append to a shared trade link would
                // otherwise abort the whole page script, rep.tf ban warning
                // included. Keep the raw text instead.
                try {
                    params[key] = decodeURIComponent(spaced);
                } catch (e) {
                    params[key] = spaced;
                }
            });

            return params;
        },
        /**
         * Gets a list of IDs from a comma-separated string.
         * @param {string} str - Comma-separated string.
         * @returns {(string[]|null)} Array of id's if string is valid, null if not.
         */
        getIDsFromString(str) {
            if (/(\d+)(,\s*\d+)*/.test(str)) {
                // Trimmed: callers match each id exactly (an item's own id,
                // or a [data-id="..."] selector), so "123, 456" must yield
                // "456", not " 456". Empty entries (a stray trailing comma)
                // could never match an item, so they are dropped.
                return str.split(',').map((id) => id.trim()).filter((id) => id !== '');
            }
            
            return null;
        },
        /**
         * Executes hot key command
         * @param {Event} e - Event.
         * @param {Object} hotKeys - Hot keys mapped to functions.
         */
        execHotKey(e, hotKeys) {
            const isTextField = (
                /textarea|select/i.test(e.target.nodeName) || 
                ['number', 'text'].indexOf(e.target.type) !== -1
            );
            const code = e.keyCode || e.which;
            const method = hotKeys[code];
            
            if (!isTextField && method) {
                method();
            }
        },
        /**
         * Flattens an array.
         * @param {(*[] | *)[]} arr - Array to flatten.
         * @returns {*[]} Flattened array.
         */
        flatten(arrays) {
            return [].concat(...arrays);
        },
        /**
         * Partitions array based on conditions.
         * @template T
         * @param {T[]} arr - Array.
         * @param {function(T): boolean} method - Function to satisfy.
         * @returns {[T[], T[]]} Partitioned array.
         */
        partition(arr, fn) {
           let result = [[], []];
           
           for (let i = 0; i < arr.length; i++) {
               result[fn(arr[i]) ? 0 : 1].push(arr[i]);
           }
           
           return result;
        },
        /**
         * Groups an array by value from key.
         * @template T
         * @param {T[]} arr - Array.
         * @param {(string | function(T): (number | string))} key - Key to take value from.
         * @returns {Object<string, T[]>} Object of groups.
         */
        groupBy(arr, key) {
            return arr.reduce((a, b) => {
                (a[b[key]] = a[b[key]] || []).push(b);
                
                return a;
            }, {});
        },
        /**
         * Copies a value to clipboard.
         * @param {string} str - String to copy.
         */
        copyToClipboard(str) {
            const el = document.createElement('textarea');
            
            el.value = str;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        },
        /**
         * Converts a currency string to a currency object.
         * @param {string} string - String to parse.
         * @returns {(Currencies|null)} Object of currencies if string is valid.
         */
        stringToCurrencies(string) {
            // mptf cross listing has no listing_price
            if (!string) {
                return null;
            }
            
            const prices = string.split(',');
            const currencies = {};
            
            for (let i = 0; i < prices.length; i++) {
                // match currencies - the first value is the amount
                // the second value is the currency name
                const match = prices[i].trim().match(/^([\d\.]*) (\w*)$/i);
                // An unrecognized segment (e.g. a cash price) is "can't
                // parse", same as a NaN amount below, not a TypeError.
                if (!match) {
                    return null;
                }
                const value = parseFloat(match[1]);
                const currency = match[2].toLowerCase();
                
                if (isNaN(value)) {
                    return null;
                }
                
                switch (currency) {
                    case 'keys':
                    case 'key':
                        currencies.keys = value;
                        break;
                    case 'metal':
                    case 'ref':
                        currencies.metal = value;
                        break;
                }
            }
            
            if (Object.keys(currencies).length === 0) {
                return null;
            }
            
            return currencies;
        }
    };
    // English item descriptions, keyed by "{classid}_{instanceid}" - a pair
    // always describes the same item, so an entry never goes stale. Failed
    // lookups aren't kept, so the next attempt retries.
    const englishDescriptionCache = new Map();
    // English inventory descriptions, keyed by "{steamid}_{appid}_{contextid}".
    const englishInventoryCache = new Map();
    // Item-hover requests in flight, and those waiting for a slot - a market
    // page can ask for a dozen at once.
    const HOVER_REQUEST_LIMIT = 4;
    let hoverRequestsInFlight = 0;
    const hoverRequestQueue = [];

    function runHoverRequest(start) {
        return new Promise((resolve) => {
            const run = () => {
                hoverRequestsInFlight++;
                start().then(resolve, () => resolve(null)).finally(() => {
                    hoverRequestsInFlight--;
                    if (hoverRequestQueue.length) hoverRequestQueue.shift()();
                });
            };
            if (hoverRequestsInFlight < HOVER_REQUEST_LIMIT) run();
            else hoverRequestQueue.push(run);
        });
    }

    // these are shared between page scripts
    const shared = {
        // Confirmed live (Steam in Hungarian): item descriptions are
        // translated, attribute values included ("Roboaktív", not
        // "Roboactive"), and carry no numeric attribute ids, so every
        // English-text reader here (getItemAttributes, the market tiles' effect
        // and detail lines) finds nothing on a non-English page. These fetch
        // the same descriptions in English instead. Same approach, and the
        // same response parsing, as ../shared/englishItemDescription.js (the
        // isolated-world copy - these classic page scripts can't import it).
        english: {
            /**
             * Whether Steam is showing this page in English (<html lang>,
             * "hu" on a Hungarian page; missing counts as English).
             * @returns {boolean}
             */
            isEnglishPage() {
                const lang = ((document.documentElement && document.documentElement.lang) || '').toLowerCase();
                return !lang || lang === 'en' || lang.startsWith('en-');
            },
            /**
             * The description object out of an item-hover response - its
             * HTML is an empty template filled in by an inline
             * `BuildHover( 'economy_item_…', {…} );` call.
             * @param {string} html
             * @returns {Object|null}
             */
            parseHoverDescription(html) {
                const callIndex = html.indexOf('BuildHover(');
                const start = callIndex === -1 ? -1 : html.indexOf('{', callIndex);
                if (start === -1) return null;

                let depth = 0;
                let inString = false;
                for (let i = start; i < html.length; i++) {
                    const ch = html[i];
                    if (inString) {
                        if (ch === '\\') i++;
                        else if (ch === '"') inString = false;
                    } else if (ch === '"') {
                        inString = true;
                    } else if (ch === '{') {
                        depth++;
                    } else if (ch === '}' && --depth === 0) {
                        try {
                            return JSON.parse(html.slice(start, i + 1));
                        } catch (e) {
                            return null;
                        }
                    }
                }
                return null;
            },
            /**
             * One item's English description, from the item-hover endpoint
             * Steam's own hover pop-ups use (~3 KB, confirmed live) - for a
             * handful of items, e.g. a market page's listing tiles.
             * @returns {Promise<Object|null>}
             */
            getDescription(appid, classid, instanceid) {
                const key = `${classid}_${instanceid}`;
                if (!englishDescriptionCache.has(key)) {
                    const url = `https://steamcommunity.com/economy/itemclasshover/${appid}/${classid}/${instanceid}?content_only=1&l=english`;
                    const request = runHoverRequest(() => fetch(url).then((res) => (res.ok ? res.text() : null)))
                        .then((html) => (html ? shared.english.parseHoverDescription(html) : null))
                        .then((description) => {
                            if (!description) englishDescriptionCache.delete(key);
                            return description;
                        });
                    englishDescriptionCache.set(key, request);
                }
                return englishDescriptionCache.get(key);
            },
            /**
             * Every asset's English description in one inventory context -
             * for marking every tile on an inventory page, where a request
             * per item would mean hundreds. Steam's own inventory endpoint,
             * 2000 items a request (confirmed live: ~750 ms, ~2 MB).
             * @returns {Promise<Map<string, Object>|null>} assetid ->
             * description, or null if Steam didn't answer.
             */
            getInventoryDescriptions(steamid, appid, contextid) {
                const key = `${steamid}_${appid}_${contextid}`;
                if (!englishInventoryCache.has(key)) {
                    const MAX_PAGES = 25;
                    const load = async () => {
                        const byAsset = new Map();
                        let startAssetId = null;
                        for (let page = 0; page < MAX_PAGES; page++) {
                            const url = `https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}?l=english&count=2000${startAssetId ? `&start_assetid=${startAssetId}` : ''}`;
                            const res = await fetch(url);
                            if (!res.ok) return null;
                            const data = await res.json();
                            const descriptions = new Map((data.descriptions || []).map((d) => [`${d.classid}_${d.instanceid}`, d]));
                            for (const asset of data.assets || []) {
                                const description = descriptions.get(`${asset.classid}_${asset.instanceid}`);
                                if (description) byAsset.set(String(asset.assetid), description);
                            }
                            if (!data.more_items || !data.last_assetid) break;
                            startAssetId = data.last_assetid;
                        }
                        return byAsset;
                    };
                    const request = load()
                        .catch(() => null)
                        .then((byAsset) => {
                            if (!byAsset) englishInventoryCache.delete(key);
                            return byAsset;
                        });
                    englishInventoryCache.set(key, request);
                }
                return englishInventoryCache.get(key);
            }
        },
        // offers shared between offers pages
        offers: {
            // Scrap-metal value of each metal item, keyed by its own
            // market_hash_name - shared refined/reclaimed/scrap constant
            // (9/3/1 scrap) used by both pages/inventory.js's own
            // updatePureTotals and pages/tradeoffer.js's own getPureTotals.
            METAL_SCRAP_VALUES: {
                'Refined Metal': 9,
                'Reclaimed Metal': 3,
                'Scrap Metal': 1
            },
            // helpers for identifying items
            identifiers: {
                /**
                 * Gets the URL of a marker icon bundled with the extension
                 * (images/icons/, drawn for it; its base URL comes from
                 * extensionUrlBridge.js).
                 * @param {string} file - Icon file name, e.g. "spell.svg".
                 * @returns {string} URL string
                 */
                getIconURL(file) {
                    const extensionUrl = document.documentElement?.dataset?.tf2teExtensionUrl || '';
                    return `${extensionUrl}images/icons/${file}`;
                },
                /**
                 * The Killstreak tier of an item with "Killstreaks Active":
                 * 3 Professional, 2 Specialized, 1 plain Killstreak. Read off
                 * market_hash_name, which Steam keeps in English on every page
                 * language and a Name Tag doesn't change; the Killstreaker
                 * (Professional only) and Sheen (Specialized and up) lines are
                 * the fallback.
                 * @param {Object} item - Steam item (asset + description).
                 * @returns {number} 1, 2 or 3.
                 */
                getKillstreakTier(item) {
                    const name = item.market_hash_name || '';
                    if (/\bProfessional Killstreak /.test(name)) return 3;
                    if (/\bSpecialized Killstreak /.test(name)) return 2;
                    const lines = Array.isArray(item.descriptions) ? item.descriptions.map((d) => d.value || '') : [];
                    if (lines.some((line) => line.startsWith('Killstreaker: '))) return 3;
                    if (lines.some((line) => line.startsWith('Sheen: '))) return 2;
                    return 1;
                },
                /**
                 * The marker icon for a Killstreak tier: one grey chevron per
                 * tier, then orange, then yellow, lowest tier first.
                 * @param {number} tier - 1, 2 or 3 (anything else counts as 1).
                 * @returns {string} URL string
                 */
                getKillstreakIconURL(tier) {
                    const { getIconURL } = shared.offers.identifiers;
                    if (tier === 3) return getIconURL('killstreak-3.svg');
                    if (tier === 2) return getIconURL('killstreak-2.svg');
                    return getIconURL('killstreak-1.svg');
                },
                // detects certain attributes from an item
                // this is used heavily and should be as optimized as possible
                getItemAttributes(item) {
                    const hasDescriptions = typeof item.descriptions === 'object';
                    const attributes = {
                        color: (item.name_color || '').toUpperCase()
                    };
                    const isUnique = attributes.color === '7D6D00';
                    const { getEffectValue } = shared.offers.unusual;
                    // is a strange quality item
                    // these are not marked as strange
                    const isStrangeQuality = (attributes.color || '').toUpperCase() === 'CF6A32';
                    const hasStrangeItemType = Boolean(
                        // the name must begin with strange
                        /^Strange /.test(item.market_hash_name) &&
                        // the item has a type
                        item.type &&
                        // the type matches a pattern similar to (Strange Hat - Points Scored: 0)
                        /^Strange ([0-9\w\s\\(\)'\-]+) \- ([0-9\w\s\(\)'-]+): (\d+)\n?$/.test(item.type)
                    );
                    const hasStatClock = (description) => {
                        return Boolean(
                            // has an orange color
                            (
                                description.color &&
                                description.color.toUpperCase() === 'CF6A32'
                            ) &&
                            // and matches this text
                            'Strange Stat Clock Attached' === description.value.trim()
                        );
                    };
                    const matchesLowcraft = (
                        item.name &&
                        item.name.match(/.* #(\d+)$/)
                    );
                     
                    // checks for a craft number that displays in game (<100) with regex and extracts it
                    if (matchesLowcraft) {
                        attributes.lowcraft = parseInt(matchesLowcraft[1]);
                    }
                    
                    // whether the item is strange or not (strange unusuals, strange genuine, etc.)
                    // NOT strange quality items
                    if (!isStrangeQuality && hasStrangeItemType) {
                        attributes.strange = true;
                    }
                    
                    // no descriptions, so don't go any further
                    if (!hasDescriptions) {
                        return attributes;
                    }
                    
                    for (let i = 0; i < item.descriptions.length; i++) {
                        const description = item.descriptions[i];
                        const matchesEffect = (
                            attributes.effect === undefined &&
                            // this will exclude cases with "Unusual Effect" descriptions
                            !isUnique &&
                            description.color === 'ffd700' &&
                            description.value.match(/^\u2605 Unusual Effect: (.+)$/)
                        );
                        const isSpelled = Boolean(
                            attributes.spelled === undefined &&
                            description.color === '7ea9d1' &&
                            description.value.indexOf('(spell only active during event)') !== -1
                        );
                        const isStrangePartAttached = Boolean(
                            attributes.parts === undefined &&
                            description.color === '756b5e' &&
                            description.value.match(/^\(?(.+?):\s*\d+\)?$/)
                        );
                        const isKillstreakAttached = Boolean(
                            attributes.killstreak === undefined &&
                            description.color === '7ea9d1' &&
                            description.value === 'Killstreaks Active'
                        );
                        const isUncraftable = Boolean(
                            !description.color &&
                            /^\( Not.* Usable in Crafting/.test(description.value)
                        );
                        
                        if (matchesEffect) {
                            const effectName = matchesEffect[1];
                            const value = getEffectValue(effectName);
                            
                            if (value) {
                                attributes.effect = value;
                            }
                        }
                        
                        if (isSpelled) {
                            attributes.spelled = true;
                        }
                            
                        if (isStrangePartAttached) {
                            attributes.parts = true;
                        }
                            
                        if (isKillstreakAttached) {
                            attributes.killstreak = shared.offers.identifiers.getKillstreakTier(item);
                        }
                        
                        if (isUncraftable) {
                            attributes.uncraft = true;
                        }
                        
                        // whether the item is strange or not (strange unusuals, strange genuine, etc.)
                        // NOT strange quality items
                        // this item is an item with a stat clock attached
                        if (!isStrangeQuality && hasStatClock(description)) {
                            attributes.strange = true;
                        }
                    }
                    
                    return attributes;
                },
                // adds attributes to item element
                addAttributes(item, itemEl) {
                    const {
                        getItemAttributes,
                        addAttributesToElement
                    } = shared.offers.identifiers;
                    const attributes = getItemAttributes(item);
                    
                    addAttributesToElement(itemEl, attributes);
                },
                // adds attributes to item element
                addAttributesToElement(itemEl, attributes) {
                    // already checked
                    if (itemEl.hasAttribute('data-checked')) {
                        return;
                    }
                    
                    const {
                        getEffectURL
                    } = shared.offers.unusual;
                    const { getIconURL } = shared.offers.identifiers;
                    const iconsEl = document.createElement('div');
                    const classes = [];
                    
                    if (attributes.effect) {
                        const url = getEffectURL(attributes.effect);
                        
                        itemEl.setAttribute('data-effect', attributes.effect);
                        itemEl.style.backgroundImage = `url('${url}')`;
                        classes.push('unusual');
                    }
                    
                    if (attributes.strange) {
                        classes.push('strange');
                    }
                    
                    if (attributes.uncraft) {
                        classes.push('uncraft');
                    }
                    
                    if (attributes.lowcraft) {
                        // construct icon for lowcraft
                        const craftNumberEl = document.createElement('div');
    
                        craftNumberEl.textContent = `#${attributes.lowcraft}`;
                        craftNumberEl.classList.add('lowcraft');
                        craftNumberEl.style.color = `#${attributes.color}`;
                        
                        itemEl.appendChild(craftNumberEl);
                    }
                    
                    if (attributes.spelled) {
                        // construct icon for spells
                        const spellEl = document.createElement('img');
                        
                        spellEl.setAttribute('src', getIconURL('spell.svg'));
                        spellEl.classList.add('spell');
                        
                        iconsEl.appendChild(spellEl);
                    }
    
                    if (attributes.parts) {
                        // construct icon for strange parts
                        const partsEl = document.createElement('img');
                        
                        partsEl.setAttribute('src', getIconURL('strange-parts.svg'));
                        partsEl.classList.add('parts');
                        
                        iconsEl.appendChild(partsEl);
                    }
    
                    if (attributes.killstreak) {
                        // construct icon for killstreak, one chevron per tier;
                        // data-tier lets the trade summary redraw the same one
                        const ksEl = document.createElement('img');
                        const tier = Number(attributes.killstreak) || 1;

                        ksEl.setAttribute('src', shared.offers.identifiers.getKillstreakIconURL(tier));
                        ksEl.setAttribute('data-tier', String(tier));
                        ksEl.classList.add('ks');
                        
                        iconsEl.appendChild(ksEl);
                    }
                    
                    // check if we added any icons to the element holding icons
                    if (iconsEl.children.length > 0) {
                        iconsEl.classList.add('icons');
                        
                        // then insert the element containing icons
                        itemEl.appendChild(iconsEl);
                    }
                    
                    if (classes.length > 0) {
                        itemEl.classList.add(...classes);
                    }
                    
                    itemEl.setAttribute('data-checked', 1);
                }
            },
            // unusual helper functions
            unusual: {
                // Defined in its own file (unusualEffects.js, loaded before
                // this one - see manifest.json's own content_scripts order)
                // to keep this file a manageable size.
                effectsMap: window.__tf2teUnusualEffectsMap__,
                // Effect images are backpack.tf's renders. The 94 px ones of
                // these ids ship with the extension (bundledParticleIds.js,
                // loaded before this file); newer effects come from our own
                // host. Same URL as utils/particleImages.js's
                // PARTICLE_HOST_URL (a test keeps them equal).
                bundledParticleIds: new Set(window.__tf2teBundledParticleIds__ || []),
                particleHostUrl: 'https://tf2te-assets.allen0246.workers.dev/particles',
                /**
                 * Gets the effect value from an effect name. Own entries
                 * only: the name is description text, and a plain read
                 * would also find inherited properties ("constructor").
                 * @param {string} effectName - Effect name.
                 * @returns {string|undefined} Effect value, if available.
                 */
                getEffectValue(effectName) {
                    const { effectsMap } = shared.offers.unusual;
                    return Object.prototype.hasOwnProperty.call(effectsMap, effectName) ? effectsMap[effectName] : undefined;
                },
                /**
                 * Gets the 94 px tile image URL for an effect: the copy bundled
                 * with the extension when there is one (its base URL comes from
                 * extensionUrlBridge.js), otherwise our own host's.
                 * @param {number|string} value - Value of effect.
                 * @returns {string} URL string
                 */
                getEffectURL(value) {
                    const { bundledParticleIds, particleHostUrl } = shared.offers.unusual;
                    const extensionUrl = document.documentElement?.dataset?.tf2teExtensionUrl;
                    if (extensionUrl && bundledParticleIds.has(Number(value))) {
                        return `${extensionUrl}images/particles/94/${value}.png`;
                    }
                    return `${particleHostUrl}/94/${value}.png`;
                }
            }
        }
    };
    
    /**
     * Adds attribute display properties to a list of hoverable items (e.g. in trade offers or steam profiles).
     * @param {NodeList|HTMLElement[]} itemsList - List of items to add attributes to.
     */
    function addAttributesToHoverItems(itemsList) {
        if (itemsList.length === 0) {
            return;
        }
        
        const {
            getItemAttributes,
            addAttributesToElement
        } = shared.offers.identifiers;
        // cache for classinfo data
        const attributeCache = (function() {
            // the key to set/get values from
            const CACHE_INDEX = ATTRIBUTE_CACHE_VERSION + '.getTradeOffers.cache';
            // this will hold our cached values
            let values = {};
            
            function save() {
                let value = JSON.stringify(values);
                
                if (value.length >= 50000) {
                    // clear cache when it becomes too big
                    values = {};
                    value = '{}'; 
                }
                
                setStored(CACHE_INDEX, value);
            }
            
            // value is a hash of attributes
            // at the MOST, this will appear as:
            // {
            //     spelled: true,
            //     uncraft: true,
            //     strange: true,
            //     effect: 9
            // }
            function store(key, attributes) {
                values[key] = attributes;
            }
            
            function get() {
                values = JSON.parse(getStored(CACHE_INDEX) || '{}');
            }

            // remove cache entries left behind by older extension versions -
            // CACHE_INDEX is version-prefixed so a version bump would otherwise
            // leak an orphaned localStorage key forever
            function cleanupStaleVersions() {
                try {
                    const currentKey = 'tf2te.' + CACHE_INDEX;
                    const suffix = '.getTradeOffers.cache';

                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const storedKey = localStorage.key(i);

                        if (
                            storedKey &&
                            storedKey !== currentKey &&
                            storedKey.startsWith('tf2te.') &&
                            storedKey.endsWith(suffix)
                        ) {
                            localStorage.removeItem(storedKey);
                        }
                    }
                } catch (e) {}
            }

            cleanupStaleVersions();

            function key(itemEl) {
                const classinfo = itemEl.getAttribute('data-economy-item');
                const [ , , classid, instanceid] = classinfo.split('/');
                
                return [classid, instanceid].join(':');
            }
            
            function getValue(key) {
                return values[key];
            }
            
            return {
                save,
                get,
                store,
                key,
                getValue
            };
        }());
        let itemsChecked = 0;
        let cacheSaveTimer;
        
        attributeCache.get();
        
        Array.from(itemsList)
            // process unusual items first
            .sort((a, b) => {
                const getValue = (itemEl) => {
                    const unusualBorderColor = 'rgb(134, 80, 172)';
                    
                    if (itemEl.style.borderColor === unusualBorderColor) {
                        return 1;
                    }
                    
                    return -1;
                };
                
                return getValue(b) - getValue(a);
            })
            .forEach((itemEl) => {
                // get hover for item to get item information
                // this requires an ajax request
                // classinfo format - "classinfo/440/192234515/3041550843"
                const classinfo = itemEl.getAttribute('data-economy-item');

                if (!classinfo) {
                    return;
                }

                const [ , appid, classid, instanceid] = classinfo.split('/');

                // only check tf2 items
                if (appid !== '440') {
                    return;
                }
                
                const cacheKey = attributeCache.key(itemEl);
                const cachedValue = attributeCache.getValue(cacheKey);
                
                if (cachedValue) {
                    // use cached attributes
                    addAttributesToElement(itemEl, cachedValue);
                } else {
                    const itemStr = [appid, classid, instanceid].join('/');
                    const uri = `economy/itemclasshover/${itemStr}?content_only=1&l=english`;
                    const req = new WINDOW.CDelayedAJAXData(uri, 0);
                    // this will space requests
                    const delay = 5000 * Math.floor(itemsChecked / 50);
                    
                    itemsChecked++;
                    
                    setTimeout(() => {
                        // we use this to get class info (names, descriptions) for each item
                        // it would be much more efficient to use GetAssetClassInfo/v0001 but it requires an API key
                        // this may be considered later
                        req.RunWhenAJAXReady(() => {
                            // 3rd element is a script tag containing item data
                            const html = req.m_$Data[2].innerHTML;
                            // extract the json for item with pattern...
                            const match = html.match(/BuildHover\(\s*?\'economy_item_[A-z0-9]+\',\s*?(.*)\s\);/);
                            
                            try {
                                const item = JSON.parse(match[1]);
                                const attributes = getItemAttributes(item);
                                
                                // then add the attributes to the element
                                addAttributesToElement(itemEl, attributes);
                                
                                // store the attributes in cache
                                attributeCache.store(cacheKey, attributes);
                                
                                // then save it n ms after the last completed request
                                clearTimeout(cacheSaveTimer);
                                cacheSaveTimer = setTimeout(attributeCache.save, 1000);
                            } catch (e) {
                                
                            }
                        });
                    }, delay);
                }
            });
    }
    
    // set a stored value (in the page's own localStorage, "tf2te."-namespaced)
    function setStored(name, value) {
        try {
            localStorage.setItem('tf2te.' + name, value);
        } catch (e) {}
    }

    // get a stored value (see setStored)
    function getStored(name) {
        try {
            return localStorage.getItem('tf2te.' + name);
        } catch (e) {
            return null;
        }
    }
    
    return {
        ATTRIBUTE_CACHE_VERSION,
        WINDOW,
        $,
        Utils,
        shared,
        addAttributesToHoverItems,
        setStored,
        getStored
    };
    
}());

// These files run as MV3 "world": "MAIN" content scripts (see manifest.json),
// meaning they share the real page's global scope - not an isolated
// extension context. The double-underscore "__tf2te__" name is a deliberate
// (if informal) way to avoid colliding with a variable the host page (Steam/
// backpack.tf) or another extension might already be using on window.
window.__tf2te__ = {
    DEPS,
    scripts: [],
    sharedStyles: {
        // .unusual/.uncraft/.strange/.icons/.lowcraft item-overlay rules
        // shared by marketListing.js, inventory.js, profileShowcase.js,
        // tradeoffer.js and tradeOffersList.js, so they can't drift apart
        // (separate copies once hid the strange-quality border on one page
        // through a single diverging z-index). Each page's own `styles`
        // template concatenates this in - these are plain global-scope
        // scripts (no bundler, no ES modules), so a shared string on
        // window.__tf2te__ is the way to share it.
        itemOverlay: `
            .unusual {
                background-position: center !important;
                background-size: 100% 100%;
                background-repeat: no-repeat;
            }

            .uncraft {
                border-style: dashed !important;
            }

            .strange:before {
                content: " ";
                position: absolute;
                z-index: 1;
                top: 2px;
                left: 2px;
                right: 2px;
                bottom: 2px;
                border: 2px solid rgba(207, 106, 50, 0.5);
            }

            .icons img.spell {
                width: 14px;
                height: 20px;
            }

            .icons img.parts {
                width: 14px;
                height: 20px;
            }

            .icons img.ks {
                width: 14px;
                height: 15px;
                padding-top: 5px;
            }

            /* Professional's third chevron makes the icon wider, not the
               chevrons thinner: squeezed into 14px they blurred together. */
            .icons img.ks[data-tier="3"] {
                width: 18px;
            }

            .lowcraft {
                user-select: none;
                right: 4%;
                bottom: 4%;
                text-align: end;
                width: 50%;
                font-size: 16px;
                z-index: 1;
                line-height: 1;
                position: absolute;
                pointer-events: none;
            }

            .icons > * {
                margin-right: 4%;
            }

            .icons {
                position: absolute;
                pointer-events: none;
                bottom: 4%;
                left: 4%;
                width: 92%;
                height: 20px;
            }
        `,
    },
};

// Notifies background.js (via the ISOLATED-world bridge content script at
// steamcommunity.com/tradeOfferActions/content.js) the moment a trade offer
// is accepted/declined/canceled, so the toolbar's trade-offer-count badge
// refreshes immediately instead of waiting for its next scheduled poll (up to
// 2 minutes away). ActOnTradeOffer is Steam's own global for this - the same
// one tradeOffer/pages/tradeOffersList.js's own "Decline All Active..."
// button already calls - wrapping it here once, in shared.js (loaded before
// any page-specific script, on every matched page), catches every path to
// it, including Steam's own native Accept/Decline buttons, not just this
// bundle's own buttons.
//
// Installed as a window accessor rather than a one-time "wrap it if it
// already exists" check - a plain synchronous check at this document_end
// script's load time silently never wraps anything if Steam ever defines
// ActOnTradeOffer later (e.g. from a deferred/async script), permanently
// losing the badge refresh for that whole page load with no error. The
// getter/setter below wraps whatever function is assigned to
// window.ActOnTradeOffer whenever that happens - now, or later - instead of
// assuming a specific load-order timing.
(function installActOnTradeOfferWrap() {
    let current = window.ActOnTradeOffer;

    function wrap(fn) {
        return function (...args) {
            document.dispatchEvent(new CustomEvent('tf2te-tradeoffer-acted-on'));
            return fn.apply(this, args);
        };
    }

    if (typeof current === 'function') current = wrap(current);

    try {
        Object.defineProperty(window, 'ActOnTradeOffer', {
            configurable: true,
            get() {
                return current;
            },
            set(fn) {
                current = typeof fn === 'function' ? wrap(fn) : fn;
            }
        });
    } catch (e) {
        // Confirmed live: window.ActOnTradeOffer can already exist as a
        // non-configurable property (e.g. a stale copy of this exact wrap
        // left behind by an earlier injection of this same script into an
        // already-open tab, or Steam's own page defining it that way) -
        // Object.defineProperty throws in that case, and since this whole
        // file is one top-level IIFE, an uncaught throw here would abort
        // every synchronous statement after it for the rest of the script's
        // own execution. Nothing else in this file runs after this block
        // today, but that's exactly the kind of silent, hard-to-diagnose
        // breakage this guards against for whatever gets added after it in
        // the future. Losing the instant badge-refresh nicety is a fine
        // trade for that.
        console.warn('[TF2 Trading Enhancer] could not wrap ActOnTradeOffer:', e.message);
    }
}());

}());
