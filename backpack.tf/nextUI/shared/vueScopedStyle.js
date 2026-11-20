/*
@description: Copies every Vue scoped-style marker attribute (`data-v-XXXXXXXX`,
confirmed live on next.backpack.tf's own item-preview tooltip buttons - see
addMarketplaceButton/content.js's own itemName-tooltip outerHTML note) from a
reference element onto a newly-built one. Vue's `scoped` CSS compiles each
rule to `.foo[data-v-XXXXXXXX]`, not just `.foo` - without this attribute a
cloned-class element only picks up whatever unscoped/global styling its
classes happen to carry, which is why cloning just the class list alone left
addMarketplaceButton's own button the wrong size the first time. The hash
itself isn't hardcoded (it changes across next.backpack.tf deploys), so this
copies whatever's actually present rather than guessing the name.

One shared implementation for every nextUI feature that clones a reference
element (the tooltip link buttons, effectCategoryFilter, effectClassFilter,
the filter key hint) - a pure DOM utility with no feature-specific behavior.
*/
export function copyScopedStyleAttrs(from, to) {
  from.getAttributeNames().forEach((name) => {
    if (name.startsWith("data-v-")) to.setAttribute(name, from.getAttribute(name));
  });
}
