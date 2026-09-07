# BrowserPDF Dieter Rams Scorecard

Scope rule: scores use the worst representative instance across the audited home and Merge surfaces. When evidence sat between two anchors, the lower score was selected.

1. Good design is innovative — Score: 2/3
   Evidence: The UI uses conventional catalog/dropzone patterns, but local-only processing and cross-tool file continuation materially improve the familiar pattern ([evidence §1](01-evidence.md#1-innovative)).
   Justification: This refreshes an existing utility pattern through privacy-preserving browser technology, but it does not yet introduce a restrained interaction absent from peers.

2. Good design makes a product useful — Score: 2/3
   Evidence: Filtering and file selection are direct and ready in 72–74 ms, but first-visit mobile consent adds a blocking choice over the primary target ([evidence §2](01-evidence.md#2-useful)).
   Justification: The primary task is short and complete, but adjacent consent UI adds a step and obstructs the working surface.

3. Good design is aesthetic — Score: 1/3
   Evidence: Tokens and card styling are coherent, but the mobile consent panel has a large empty region, dominates the composition, and the two screens expose 18 spacing and 10 type values ([evidence §3](01-evidence.md#3-aesthetic)).
   Justification: The baseline system is consistent, but the first-visit mobile composition is one jarring visual violation.

4. Good design makes a product understandable — Score: 1/3
   Evidence: Primary task labels are literal, but technical jargon, two icon-only controls, blank filter results, and a page-versus-file ordering mismatch remain ([evidence §4](01-evidence.md#4-understandable)).
   Justification: Multiple unclear or mismatched elements mean a first-time user cannot interpret every control and claim without extra context.

5. Good design is unobtrusive — Score: 0/3
   Evidence: The first-visit mobile consent panel occupies 40.5% of the viewport and overlaps roughly 32% of Merge’s primary dropzone ([evidence §5](01-evidence.md#5-unobtrusive)).
   Justification: On the highest-friction representative state, site chrome dominates and physically covers task content.

6. Good design is honest — Score: 0/3
   Evidence: “Open-source”, “no backend/server”, consent timing/scope, “everything happens in this tab”, and page-reordering claims do not map 1:1 to licensing or behavior; Accept also grants advertising-related consent not stated in the prompt ([evidence §6](01-evidence.md#6-honest)).
   Justification: The consent flow requests narrower permission than it grants and several absolute trust claims are false as written, meeting the deceptive-flow anchor.

7. Good design is long-lasting — Score: 2/3
   Evidence: Native fonts, semantic structure, restrained surfaces and one accent are durable; pill/card styling and hard-coded catalog counts are the main dated/brittle markers ([evidence §7](01-evidence.md#7-long-lasting)).
   Justification: The visual language should age well aside from one trend family and copy coupled to the present catalog size.

8. Good design is thorough down to the last detail — Score: 1/3
   Evidence: Core states exist, but no-results, persistent success, progress semantics, header-control focus, skip links, and consent focus/Escape behavior are missing or rough ([evidence §8](01-evidence.md#8-thorough-down-to-details), [accessibility](01-evidence.md#accessibility-evidence)).
   Justification: More than one representative state is incomplete even though the shared scaffolding is strong.

9. Good design is environmentally friendly — Score: 3/3
   Evidence: Initial JS is 9,094 B on home and 34,849 B on Merge, with zero idle animations, system dark mode, and reduced-motion support ([evidence §9](01-evidence.md#9-environmentally-friendly)).
   Justification: The audited surfaces satisfy every explicit top anchor: under 100 KB, no idle animation, dark mode honored, and reduced motion honored.

10. Good design is as little design as possible — Score: 1/3
    Evidence: Home shows 29 equally weighted cards and repeats the privacy proposition in at least five regions; Merge repeats it in four ([evidence §10](01-evidence.md#10-as-little-design-as-possible)).
    Justification: Several repeated trust explanations and equal-weight destinations can be removed or progressively disclosed without breaking the task.

## Total

**13/30**
