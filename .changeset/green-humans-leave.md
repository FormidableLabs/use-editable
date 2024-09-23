---
'use-editable': patch
---

To address incorrect cursor positioning when typing fast, moved position tracking to a ref and added a setTimeout to allow DOM to update within edit methods.
