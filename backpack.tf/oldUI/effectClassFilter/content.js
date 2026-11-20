/*
@description: Adds a "class filter" dropdown to a classic backpack.tf
specific-effect page (e.g. /effect/Burning Flames), matching the exact same
dropdown backpack.tf ALREADY builds natively on /unusuals (confirmed live -
#classmenu1/#classmenu, the same 11 options, the same data-class values) -
the specific-effect page just never got that same dropdown itself, even
though its own items carry the same data-class attribute /unusuals' items
do. Self-scoping off both: bails out immediately if #classmenu already
exists (native /unusuals dropdown present - nothing to add there) or if no
item on the page actually carries data-class at all (e.g. the bare /effect/
browse-all-effects page, whose tiles represent effects themselves, not
class-specific items - confirmed live those have no data-class).

Deliberately does NOT touch or clone the existing #filterlist text input (to
combine both filters in one reimplemented handler) - reimplementing an
unconfirmed existing search behavior risks breaking search that already
works. Instead this filter is a
purely additive CSS layer (item.filtered-out-by-class, display:none
!important) that only ever hides items failing the class check and never
touches items that pass, leaving the native text filter's own effect on
those items completely alone - the two filters combine correctly (AND) as a
side effect of CSS specificity, without this needing to know or replicate
what the native filter's own code does at all.

There is deliberately no "Miscs" option: it would need a hand-maintained
list of specific defindexes, with no way to verify it stays accurate as new
items are added.
*/

const CLASS_OPTIONS = ["All", "Multi", "Scout", "Soldier", "Pyro", "Demoman", "Heavy", "Engineer", "Medic", "Sniper", "Spy"];
const CLASS_LABELS = { All: "Any class", Multi: "Multi class" };
const FILTERED_OUT_CLASS = "tf2te-class-filtered-out";

function injectStyles() {
  if (document.getElementById("tf2te-effect-class-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-effect-class-filter-styles";
  style.textContent = `.${FILTERED_OUT_CLASS} { display: none !important; }`;
  document.head.appendChild(style);
}

function applyFilter(selectedClass, items) {
  items.forEach((item) => {
    const itemClass = item.getAttribute("data-class");
    const matches = selectedClass === "All" || itemClass === selectedClass;
    item.classList.toggle(FILTERED_OUT_CLASS, !matches);
  });
}

function buildDropdown(items) {
  const wrap = document.createElement("div");
  wrap.className = "input-group-btn";

  const icon = document.createElement("i");
  icon.className = "stm stm-tf2";

  // A direct reference, not document.getElementById("...") re-lookup from
  // inside each option's click handler - avoids depending on a page-unique
  // id for something that only this dropdown's own closure ever needs to
  // update, and (a smaller point) makes it trivial to unit test without
  // simulating innerHTML parsing.
  const label = document.createElement("span");
  label.textContent = "Any class";

  const toggle = document.createElement("a");
  toggle.className = "btn btn-default dropdown-toggle";
  toggle.setAttribute("data-toggle", "dropdown");
  toggle.href = "#";
  toggle.appendChild(icon);
  toggle.appendChild(document.createTextNode(" "));
  toggle.appendChild(label);

  const menu = document.createElement("ul");
  menu.id = "classmenu"; // matches the native /unusuals dropdown's own id, for identical styling
  menu.className = "dropdown-menu";
  menu.setAttribute("role", "menu");

  CLASS_OPTIONS.forEach((cls) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "javascript:void(0)";
    a.tabIndex = -1;
    a.dataset.class = cls;
    a.textContent = CLASS_LABELS[cls] || cls;
    a.addEventListener("click", () => {
      label.textContent = a.textContent;
      applyFilter(cls, items);
    });
    li.appendChild(a);
    menu.appendChild(li);
  });

  wrap.appendChild(toggle);
  wrap.appendChild(menu);
  return wrap;
}

export function effectClassFilter() {
  if (document.getElementById("classmenu")) return; // native /unusuals dropdown already present

  const inputGroup = document.getElementById("unusual-pricelist-input-group");
  if (!inputGroup) return;

  const items = Array.from(document.querySelectorAll("li.item[data-class]"));
  if (items.length === 0) return; // nothing on this page carries a class to filter by

  injectStyles();
  inputGroup.prepend(buildDropdown(items));
}
