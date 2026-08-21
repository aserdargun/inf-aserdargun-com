# Fidelity ledger

Evidence: accepted [owner desktop](inf-owner-desktop.png), [owner mobile](inf-owner-mobile.png), and [public View](inf-public-view.png); implementation [owner desktop](evidence/owner-desktop.png), [owner mobile](evidence/owner-mobile.png), [public desktop](evidence/public-desktop.png), and [public mobile](evidence/public-mobile.png). The public production captures are 1280×720 and 390×844. The retained owner captures are 1536×1024 and 853×1844 and therefore are reference-only, not evidence of exact release viewport parity.

| Area | Observed delta | Fix and residual |
| --- | --- | --- |
| Copy | Concept uses terse task labels; implementation matches Today/Inbox/Library/Review/View, with no hero copy. | Kept approved wording; no residual. |
| Layout | Desktop sidebar remains visible at 1280px; mobile replaces it below 768px. | Fixed atomic 768px switch; no horizontal overflow at 390px. |
| Typography | Implementation uses system UI rather than the concept's rendered mock font. | Deliberate no-remote-font tradeoff; hierarchy and line lengths retained. |
| Palette | Neutral light surfaces and image-led colour match; dark mode is a functional extension. | Tokenized palette; residual first semantic toggle label updates on hydration. |
| Icons | Lucide lines are slightly sharper than concept mock icons. | Shared 1.75 stroke treatment and local maskable icon; accepted. |
| Images | Diagram previews must not crop; measured review thumbnail is 64×48. | `object-fit: contain` in rail/detail previews; accepted. |
| Spacing | Concept is airy rather than card-grid dense. | 4/8 rhythm and restrained borders; accepted. |
| Desktop | Public evidence preserves the narrow navigation/image-first gallery at 1280×720. Owner reference has a different viewport and three review rows rather than the concept's six. | Public accepted; recapture owner from a production artifact with representative loaded media before external release. |
| Mobile | Public evidence keeps navigation and gallery inside the 390px viewport. Owner reference is 853px wide and cannot prove mobile parity. | Public accepted; recapture owner at 390×844 before external release. |
| Interaction | Public screenshot contains no owner mutation/navigation control. | Only `/api/public/*` is requested in View; owner actions remain private. |

Known visual limitation: the theme-toggle server markup initially uses the default semantic state until hydration restores a saved preference. The pre-paint theme attribute prevents a visible flash; semantic button text follows on hydration.

The owner reference also contains local placeholder media rather than all nine concept images. This is an intentional evidence gap, not a claim of visual parity; it remains a release-gate recapture item while Drive content is not yet provisioned.
