/*
@description: Parses a Steam price display string (e.g. "$1.25", "1,25€",
"A$ 0.05") into {value, prefix, suffix} - value is a plain JS number in
major currency units, prefix/suffix are whatever non-digit text surrounded
the number, so the computed total can be shown back in the SAME currency
notation Steam itself used instead of hardcoding "$" or assuming one
currency's decimal separator.

The numeric run may group thousands with a space, no-break space or narrow
no-break space ("1 234,56 pуб.", the same separators this page already uses
for its order counts, see BUY_ORDER_TEXT_PATTERN); those are dropped. The
decimal separator is whichever of "."/"," appears LAST, unless exactly three
digits follow it: Steam prices carry two decimals or none, so "1,234" (a
whole-unit currency such as ¥) is a thousands separator, not 1.234.
@returns: null if text has no recognizable digit run at all.
*/
export function parsePriceParts(text) {
  const cleaned = String(text || "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
  const match = /\d(?:[\d.,]| (?=\d))*/.exec(cleaned);
  if (!match) return null;

  const numericText = match[0].replace(/ /g, "");
  const prefix = cleaned.slice(0, match.index).trim();
  const suffix = cleaned.slice(match.index + match[0].length).trim();

  const lastDot = numericText.lastIndexOf(".");
  const lastComma = numericText.lastIndexOf(",");
  const lastSeparatorPos = Math.max(lastDot, lastComma);
  const isThousandsSeparator = lastSeparatorPos !== -1 && /^\d{3}$/.test(numericText.slice(lastSeparatorPos + 1));
  const decimalPos = isThousandsSeparator ? -1 : lastSeparatorPos;

  let value;
  if (decimalPos === -1) {
    value = Number(numericText.replace(/[.,]/g, ""));
  } else {
    const whole = numericText.slice(0, decimalPos).replace(/[.,]/g, "");
    const fraction = numericText.slice(decimalPos + 1).replace(/[.,]/g, "");
    value = Number(`${whole || "0"}.${fraction || "0"}`);
  }

  return Number.isFinite(value) ? { value, prefix, suffix } : null;
}
