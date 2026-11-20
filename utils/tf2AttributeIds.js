/*
@description: Site filter ids for TF2 item attributes (Sheen, Killstreaker,
Halloween Spell, Paint), shared by every link builder so one attribute can
never map to different ids on different sites' links. Used by
utils/tf2StatsLinks/ and scrap.tf/itemLinks/.
*/

// next.backpack.tf's classifieds Sheen/Killstreaker filter ids, confirmed via
// its filter dropdown (sequential in dropdown order): Team Shine=1 ...
// Hot Rod=7, Fire Horns=2002 ... Hypno-Beam=2008.
export const SHEEN_IDS = {
  "Team Shine": 1,
  "Deadly Daffodil": 2,
  Manndarin: 3,
  "Mean Green": 4,
  "Agonizing Emerald": 5,
  "Villainous Violet": 6,
  "Hot Rod": 7,
};
export const KILLSTREAKER_IDS = {
  "Fire Horns": 2002,
  "Cerebral Discharge": 2003,
  Tornado: 2004,
  Flames: 2005,
  Singularity: 2006,
  Incinerator: 2007,
  "Hypno-Beam": 2008,
};

// next.backpack.tf's classifieds Halloween Spell filter ids, confirmed via its
// search request payload. Composite "{type}-{spellId}" strings used directly
// as the "spell" param value; the footsteps ids are arbitrary, not
// sequential. Classic backpack.tf takes the literal spell name instead.
export const SPELL_IDS = {
  Exorcism: "weapon-SPELL: Halloween death ghosts",
  "Halloween Fire": "weapon-SPELL: Halloween green flames",
  "Pumpkin Bombs": "weapon-SPELL: Halloween pumpkin explosions",
  "Voices from Below": "standard-SPELL: Halloween voice modulation",
  "Team Spirit Footprints": "footsteps-1",
  "Headless Horseshoes": "footsteps-2",
  "Corpse Gray Footprints": "footsteps-3100495",
  "Violent Violet Footprints": "footsteps-5322826",
  "Bruised Purple Footprints": "footsteps-8208497",
  "Gangreen Footprints": "footsteps-8421376",
  "Rotten Orange Footprints": "footsteps-13595446",
  "Die Job": "paint-0",
  "Chromatic Corruption": "paint-1",
  "Putrescent Pigmentation": "paint-2",
  "Spectral Spectrum": "paint-3",
  "Sinister Staining": "paint-4",
};

// marketplace.tf's "sspell" browse-filter slugs, a separate scheme confirmed
// for all spells: "effect_" + snake_case for weapon/voice spells,
// "footprint_" + color for footprints, "paint_" + snake_case for paint spells
// (e.g. skillstreak=2&sspell=effect_exorcism).
export const MARKETPLACE_SPELL_SLUGS = {
  Exorcism: "effect_exorcism",
  "Halloween Fire": "effect_halloween_fire",
  "Pumpkin Bombs": "effect_pumpkin_bombs",
  "Voices from Below": "effect_voices_from_below",
  "Team Spirit Footprints": "footprint_team_spirit",
  "Headless Horseshoes": "footprint_headless_horseshoes",
  "Corpse Gray Footprints": "footprint_corpse_gray",
  "Violent Violet Footprints": "footprint_violent_violet",
  "Bruised Purple Footprints": "footprint_bruised_purple",
  "Gangreen Footprints": "footprint_gangreen",
  "Rotten Orange Footprints": "footprint_rotten_orange",
  "Die Job": "paint_die_job",
  "Chromatic Corruption": "paint_chromatic_corruption",
  "Putrescent Pigmentation": "paint_putrescent_pigmentation",
  "Spectral Spectrum": "paint_spectral_spectrum",
  "Sinister Staining": "paint_sinister_staining",
};

// Paints. `id` is next.backpack.tf's paint filter id (confirmed via its
// search request payload). Classic backpack.tf's "paint" param and
// marketplace.tf's spaint[] take the color's decimal RGB value instead (e.g.
// #b8383b -> 12073019 for "Team Spirit"), which callers compute from `color`.
export const PAINT_IDS = {
  "A Color Similar to Slate": { id: 5052, color: "#2f4f4f" },
  "A Deep Commitment to Purple": { id: 5031, color: "#7d4071" },
  "A Distinctive Lack of Hue": { id: 5040, color: "#141414" },
  "A Mann's Mint": { id: 5076, color: "#bcddb3" },
  "After Eight": { id: 5077, color: "#2d2d24" },
  "Aged Moustache Grey": { id: 5038, color: "#7e7e7e" },
  "An Air of Debonair": { id: 5063, color: "#654740" },
  "An Extraordinary Abundance of Tinge": { id: 5039, color: "#e6e6e6" },
  "Australium Gold": { id: 5037, color: "#e7b53b" },
  "Balaclavas Are Forever": { id: 5062, color: "#3b1f23" },
  "Color No. 216-190-216": { id: 5030, color: "#d8bed8" },
  "Cream Spirit": { id: 5065, color: "#c36c2d" },
  "Dark Salmon Injustice": { id: 5056, color: "#e9967a" },
  "Drably Olive": { id: 5053, color: "#808000" },
  "Indubitably Green": { id: 5027, color: "#729e42" },
  "Mann Co. Orange": { id: 5032, color: "#cf7336" },
  Muskelmannbraun: { id: 5033, color: "#a57545" },
  "Noble Hatter's Violet": { id: 5029, color: "#51384a" },
  "Operator's Overalls": { id: 5060, color: "#483838" },
  "Peculiarly Drab Tincture": { id: 5034, color: "#c5af91" },
  "Pink as Hell": { id: 5051, color: "#ff69b4" },
  "Radigan Conagher Brown": { id: 5035, color: "#694d3a" },
  "Team Spirit": { id: 5046, color: "#b8383b" },
  "The Bitter Taste of Defeat and Lime": { id: 5054, color: "#32cd32" },
  "The Color of a Gentlemann's Business Pants": { id: 5055, color: "#f0e68c" },
  "The Value of Teamwork": { id: 5064, color: "#803020" },
  "Waterlogged Lab Coat": { id: 5061, color: "#a89a8c" },
  "Ye Olde Rustic Colour": { id: 5036, color: "#7c6c57" },
  "Zepheniah's Greed": { id: 5028, color: "#424f3b" },
};

/*
@description: Case-insensitive PAINT_IDS lookup by paint name, or null.
*/
export function findPaintEntry(paintName) {
  if (!paintName) return null;
  const matchedName = Object.keys(PAINT_IDS).find((name) => name.toLowerCase() === paintName.toLowerCase());
  return matchedName ? PAINT_IDS[matchedName] : null;
}
