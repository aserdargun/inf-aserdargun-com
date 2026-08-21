# Fidelity ledger

Compared accepted concepts `inf-owner-desktop.png`, `inf-owner-mobile.png`, and `inf-public-view.png` against the implemented route shells and Task 9–13 browser evidence.

| Area | Concept expectation | Implementation result / fix |
| --- | --- | --- |
| Copy | Calm, task-oriented labels; no marketing language | Today, Inbox, Library, Review, Surprise, and View use the approved concise copy. |
| Layout | Narrow desktop sidebar; mobile bottom navigation | CSS switches at 768px and keeps Settings reachable on mobile. |
| Typography | Precise neutral UI type hierarchy | Local system type scale, restrained headings, and readable image captions; no remote fonts. |
| Palette | Neutral light/dark surfaces with image-led colour | Theme tokens and persisted light/dark preference; no gradients or decorative colour blocks. |
| Icons | Thin, consistent utility icons | Lucide line icons with shared stroke treatment; PWA icons are local and distinct maskable safe-zone artwork. |
| Images | Image-first rails/grids and contained diagrams | 64×48 review previews and media frames use `object-fit: contain`; detail retains originals. |
| Spacing | Airy 4/8 rhythm, not card-grid marketing chrome | Shared page/row/media spacing and restrained borders. |
| Desktop | Today actions and library scanning remain primary | Desktop screenshots cover Today, Library, detail, and public gallery. |
| Mobile | No horizontal overflow; touch controls are usable | 390–427px checks cover navigation, capture, Library/detail, and public View. Controls are at least 44px. |
| Interaction | Owner actions separated from public observation | Public routes only use `/api/public/*`; View has no owner navigation or mutation controls. |

Known visual limitation: the theme-toggle server markup initially uses the default semantic state until hydration restores a saved preference. The pre-paint theme attribute prevents a visible flash; semantic button text follows on hydration.
