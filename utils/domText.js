/*
@description: Strips HTML down to plain text - <br> tags become newlines (so
multi-line tooltip content like "Level 17<br>Effect: ..." stays on separate
lines once converted), everything else is dropped. Used to read scrap.tf's
data-content/tooltip HTML as plain text.
*/
export function stripHtmlTags(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
}
