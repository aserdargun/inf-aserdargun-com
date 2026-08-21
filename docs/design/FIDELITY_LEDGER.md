# Fidelity ledger

Evidence: accepted [owner desktop](inf-owner-desktop.png), [owner mobile](inf-owner-mobile.png), and [public View](inf-public-view.png); implementation [owner desktop](evidence/owner-desktop.png), [owner mobile](evidence/owner-mobile.png), [public desktop](evidence/public-desktop.png), and [public mobile](evidence/public-mobile.png). Measurements were taken at 1280×720 desktop and 390×844 mobile.

| Area | Observed delta | Fix and residual |
| --- | --- | --- |
| Copy | Concept uses terse task labels; implementation matches Today/Inbox/Library/Review/View, with no hero copy. | Kept approved wording; no residual. |
| Layout | Desktop sidebar remains visible at 1280px; mobile replaces it below 768px. | Fixed atomic 768px switch; no horizontal overflow at 390px. |
| Typography | Implementation uses system UI rather than the concept's rendered mock font. | Deliberate no-remote-font tradeoff; hierarchy and line lengths retained. |
| Palette | Neutral light surfaces and image-led colour match; dark mode is a functional extension. | Tokenized palette; residual first semantic toggle label updates on hydration. |
| Icons | Lucide lines are slightly sharper than concept mock icons. | Shared 1.75 stroke treatment and local maskable icon; accepted. |
| Images | Diagram previews must not crop; measured review thumbnail is 64×48. | `object-fit: contain` in rail/detail previews; accepted. |
| Spacing | Concept is airy rather than card-grid dense. | 4/8 rhythm and restrained borders; accepted. |
| Desktop | Owner and public evidence preserve narrow navigation/image-first gallery. | Screenshots above provide auditable reference; accepted. |
| Mobile | 390px evidence keeps navigation and public gallery inside viewport. | 44px controls and bottom navigation; accepted. |
| Interaction | Public screenshot contains no owner mutation/navigation control. | Only `/api/public/*` is requested in View; owner actions remain private. |

Known visual limitation: the theme-toggle server markup initially uses the default semantic state until hydration restores a saved preference. The pre-paint theme attribute prevents a visible flash; semantic button text follows on hydration.
