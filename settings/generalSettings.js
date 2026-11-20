/*
@description: The behavior settings that save immediately on change (they
are not credentials):
  - "Mute new trade offer sound" (read by background.js's
    playTradeOfferAlertSound; the sound itself is AlertSoundSettings');
  - auto-adding a listing's keys/metal when opening its trade offer (read by
    steamcommunity.com/tradeOfferSettingsBridge/content.js and relayed to the
    MAIN-world tradeoffer.js); defaults on;
  - Sheen/Killstreaker link filtering (defaults on).
*/
import { ALERT_MUTED_KEY } from "../utils/notificationSound.js";
import { SettingsSection } from "./settingsSection.js";

const AUTO_ADD_LISTING_CURRENCY_KEY = "autoAddListingCurrencyEnabled";
// Must match utils/sheenKillstreakerFilterSetting.js, which every link
// builder reads.
const SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY = "sheenKillstreakerFilterEnabled";

export class GeneralSettings extends SettingsSection {
  async init() {
    const stored = await chrome.storage.local.get([
      ALERT_MUTED_KEY, AUTO_ADD_LISTING_CURRENCY_KEY, SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY,
    ]);

    this.bindCheckbox(this.el("mute-tradeoffer-alert"), ALERT_MUTED_KEY, stored);
    this.bindCheckbox(this.el("auto-add-listing-currency"), AUTO_ADD_LISTING_CURRENCY_KEY, stored, { defaultOn: true });
    this.bindCheckbox(this.el("sheen-killstreaker-filter"), SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY, stored, { defaultOn: true });
  }
}
