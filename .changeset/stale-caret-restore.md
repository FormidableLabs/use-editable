---
'use-editable': patch
---

pr: #37

Don't restore a stale caret position onto content it wasn't computed against. An unrelated re-render landing between a keystroke's `keydown` and `keyup` no longer yanks the caret to the wrong offset.
