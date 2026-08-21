# Fidelity ledger

Accepted concepts: [owner desktop](inf-owner-desktop.png), [owner mobile](inf-owner-mobile.png), [public View](inf-public-view.png). Production-artifact evidence: [owner desktop](evidence/owner-desktop.png), [owner mobile](evidence/owner-mobile.png), [public desktop](evidence/public-desktop.png), [public mobile](evidence/public-mobile.png). Desktop files are exactly 1280×720; mobile files are exactly 390×844. All four were captured from `out/` through the real 4280→7072→7071 chain with one real 1200×800 PNG, decoded 960×640 WebP thumbnail, truthful Inbox 1/Library 0/Due 0 counts, no browser/dev chrome, and no horizontal overflow.

| Area | Concept delta observed in exact production capture | Fix and accepted residual |
| --- | --- | --- |
| Copy | Concept and implementation share terse Today/Inbox/Library/Review/View labels; implementation adds “Return to what matters” and explicit public “View only.” | Kept the approved product copy. Public labeling makes the anonymous boundary clearer; accepted. |
| Layout | Owner concept uses the same desktop rail/mobile bottom-nav split. Production desktop keeps actions and metrics on one baseline; mobile stacks actions and preserves the three equal metrics. | Atomic 768px switch; exact captures show no overflow. One seeded card replaces the concept's denser illustrative data set, matching the truthful local count. |
| Typography | Concept mock uses a rendered design font; production uses the local system UI stack. | Preserved scale, weight, line length, and hierarchy without a remote-font dependency; family difference accepted. |
| Palette | Both use neutral surfaces, blue active/action emphasis, and dark ink. | Tokenized production palette matches the concept hierarchy. Dark mode remains a functional extension outside these light evidence captures. |
| Icons | Production Lucide outlines are slightly sharper than the concept glyphs. | Unified 1.75-stroke treatment and deterministic PWA icons; accepted. |
| Images | Concepts show multiple varied infographics. Earlier evidence showed a solid navy test fixture that looked like a placeholder. | Replaced it with a loaded, legible Systems Thinking Map through the real capture/thumbnail API. Production evidence intentionally contains one deterministic item, not nine illustrative concept images. |
| Spacing | Concept is airy with restrained borders; production has the same large section gaps and compact card metadata. | 4/8 rhythm retained. Exact mobile capture keeps the card, title, date, and fixed nav separated without clipping. |
| Desktop | Concept was 1536×1024; required release evidence is 1280×720. | Owner/public evidence is now exactly 1280×720 from static `out/`, with loaded media, correct counts, footer/rail placement, and no dev badge. |
| Mobile | Concept was 853×1844; required release evidence is 390×844. | Owner/public evidence is now exactly 390×844. Action buttons, metrics, image, title/date, and fixed navigation fit without horizontal overflow. |
| Interaction | A screenshot cannot demonstrate mutation behavior; concept implies navigation and review actions. | Real route/E2E validation covers owner actions and public read-only isolation. Public capture contains no owner mutation/navigation control; accepted. |

Known semantic limitation: the theme-toggle server markup starts from the default label until hydration restores a saved preference. The pre-paint theme attribute prevents a visible color flash; semantic button text follows on hydration.
