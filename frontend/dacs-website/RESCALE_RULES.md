# DACS 0.75 rescale rules (client revision, 2026-07-27)

The client reviewed the site and found the 1:1 reproduction of the 1920px Figma frames oversized
on real desktops. The whole site is being converted to render the Figma frames at **0.75 scale
inside a centered `max-w-[1440px] mx-auto` container**. The Products page, Navbar, and Footer are
already converted — read `src/components/layout/Navbar.tsx`, `src/components/layout/Footer.tsx`,
`src/components/products/ProductCatalog.tsx`, `src/components/products/ProductCard.tsx` as the
reference for how the conversion looks.

Rules (visual-scale-only refactor — do NOT change copy, structure, logic, flows, or behavior):

1. Multiply every desktop dimension that came from the 1920 Figma frame by 0.75 and round to the
   nearest integer: widths, heights, font sizes, gaps, paddings, margins, top/left offsets,
   border-radius, shadow blur, icon sizes. This applies to `lg:`/`xl:` values AND unprefixed fixed
   values that encode desktop Figma px (e.g. fixed panel widths, modal widths, table columns).
2. Do NOT scale: 1px borders/dividers (keep 1px), base/mobile-only values that are already compact
   (e.g. `px-[24px]` page gutters may become `px-[20px]` to match the shell, but don't shrink
   mobile text below readable sizes), z-index, opacity, aspect ratios, breakpoints, `leading-normal`.
   NOTE: since the site-wide audit, `--leading-normal` is remapped in globals.css to CSS `normal`
   (~1.21 for Inter) so `leading-normal` text blocks match the Figma frames' vertical metrics.
3. Common conversions: 1920 → 1440 container; px-[56px] → px-[42px]; px-[79px] → px-[59px];
   px-[112px] → px-[84px]; px-[156px] → px-[117px]; text 48→36, 40→30, 32→24, 24→18, 20→15, 16→12;
   buttons h-[85px] w-[288px] rounded-[20px] text-[24px] → h-[64px] w-[216px] rounded-[15px]
   text-[18px]; inputs h-[71px] rounded-[15px] → h-[53px] rounded-[11px] with 18px labels;
   shadow-[0px_0px_20px_...] → shadow-[0px_0px_15px_...]; avatar 275 → 206; panel width 478 → 359;
   slide-over width 569 → 427; modal width 1175 → 881.
4. Full-bleed backgrounds (hero images, dark bands, footer) stay full width; their CONTENT gets a
   `mx-auto max-w-[1440px]` inner container.
5. Keep the responsive/mobile behavior working exactly as before (stacking, hamburger, no page-level
   horizontal overflow).
6. Verify when done: `npx tsc --noEmit` clean; load your pages on the running dev server
   (http://localhost:3000 — do NOT start/stop servers or run builds) and eyeball at 1440x900.
