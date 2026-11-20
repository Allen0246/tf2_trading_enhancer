/*
@description: Reads an HTTP Retry-After header. Shared by background.js's
fetch relay and utils/scmPricing.js's own priceoverview fetch, the two places
that see a 429 response's headers directly. No top-level await and no
import(), so background.js can import it (see that file's header).
*/

/*
@description: Converts a Retry-After header to milliseconds. The header is
legal in two shapes per spec: integer delta-seconds ("42") or an HTTP-date
("Wed, 21 Oct 2026 07:28:00 GMT"). Returns null (not NaN) for anything else,
or for no header at all, so a caller's own `?? <default>` fallback applies.
@param {?string} headerValue
@returns {?number}
*/
export function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}
