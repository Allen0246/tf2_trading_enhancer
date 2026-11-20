/*
@description: Clicks each item with a small stagger between clicks, via a
genuine bubbling MouseEvent (not by reimplementing the site's own selection/
bid-picking logic) - e.g. scrap.tf's own click handler likely updates some running
total (a "Value: ..." sum, a bid amount, etc.) per click, and firing a burst
of synthetic clicks faster than any real click ever could risks racing
whatever DOM/state update that handler does. 120ms is arbitrary (not
confirmed against scrap.tf's own update timing), just fast enough to feel
instant across a handful of items while staying clearly slower than any
batching issue would need.

shouldStop is checked before every click, so a long run can be cancelled
(see createStopController).

Shared by scrap.tf/auctionBidHelper (Auto-Select, Clear All),
scrap.tf/sellDuplicates (Select Duplicates) and stntrading.eu/sellSelectButtons.
@returns the number of items actually clicked.
*/
export async function clickItemsWithDelay(items, shouldStop = () => false) {
  let clickedCount = 0;
  for (const el of items) {
    if (shouldStop()) break;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    clickedCount++;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return clickedCount;
}

/*
@description: One stoppable click run at a time across a feature's buttons
(scrap.tf/auctionBidHelper, scrap.tf/sellDuplicates and
stntrading.eu/sellSelectButtons): while a run is going, the button that
started it reads "Stop" and stays clickable, and every other button in
`buttons` is disabled. Clicking "Stop" ends the run before its next click -
what was already selected stays selected.

Each button's click handler calls stopIfRunning() first: true means this
click was the Stop click and is handled.
*/
export function createStopController(buttons) {
  let active = null;

  return {
    stopIfRunning() {
      if (!active) return false;
      active.stopRequested = true;
      return true;
    },

    // @returns {Promise<{clicked: number, stopped: boolean}>}
    async run(button, items) {
      const run = { stopRequested: false };
      active = run;
      const originalLabel = button.textContent;
      button.textContent = "Stop";
      for (const other of buttons) if (other !== button) other.disabled = true;
      try {
        const clicked = await clickItemsWithDelay(items, () => run.stopRequested);
        return { clicked, stopped: run.stopRequested };
      } finally {
        button.textContent = originalLabel;
        for (const other of buttons) if (other !== button) other.disabled = false;
        active = null;
      }
    },
  };
}
