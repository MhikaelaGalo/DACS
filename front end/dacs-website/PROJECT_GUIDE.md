# DACS Website — Implementation Guide (for all contributors)

Customer-facing website + farmer/client portal for Dominant Asia Poultry Genetics (DACS).
Stack: Next.js 16 (App Router, `src/` dir), React 19, TypeScript, Tailwind CSS v4, React Hook Form + Zod, lucide-react (only when an exact icon is not in Figma). No backend — mock data + localStorage only.

## Golden rules

1. **Figma is the visual source of truth.** Reproduce layout, dimensions, spacing, typography, colors, radii, shadows exactly at desktop (frames are 1920px wide). Do NOT redesign, modernize, or recolor.
2. Fetch each frame with the Figma MCP tool `get_design_context` (load it via ToolSearch `select:mcp__a38af6b3-9f71-47c3-8a35-bc971f9b7049__get_design_context` if not loaded; pass `skillNames: "figma-design-to-code"`). The returned code is a REFERENCE with absolute positioning — convert it to flow layout (flex/grid) while keeping exact px values for sizes, gaps, paddings, font sizes at `lg:` and up.
3. **Responsive**: base classes = mobile (stacked columns, px-[24px] gutters, smaller type), `lg:`/`xl:` = exact Figma desktop values. No horizontal page overflow. Tables scroll inside `overflow-x-auto` wrappers.
4. **Assets**: never hand-draw SVGs and never leave placeholders.
   - Reuse supplied project assets in `public/images/` when the design shows them: `logo.png`, `logo-transparent.png`, `register-signin-logo.png` (big auth-page logo), `register-signin.jpg` (auth hero banner), `register-signin-2.jpg` (auth eggs background), `home-1..4`, `about-us.jpg`, `about-us-2.jpg`, `dr-erwin-joseph-cruz.jpg`, `seminars-1..4.jpg`, `certificate.jpg`, `user-profile.jpg`, `footer.png`. Videos in `public/videos/`: `dacs-intro.mp4`, `module-1.mp4`, `module-2.mp4`, `module-3.mp4`, `video-project-9.mp4`.
   - For icons/images that exist only in Figma, download the asset URLs returned by `get_design_context` into `public/figma/` with a descriptive kebab-case name. Bash pattern (detects extension):
     `ct=$(curl -sL -o name.tmp -w '%{content_type}' "URL"); # then mv name.tmp name.svg|png|jpg based on $ct`
   - Already downloaded to `public/figma/`: icon-cart.svg, icon-bell.svg, icon-asterisk.svg (red required-field asterisk), icon-location.svg, icon-phone.svg, icon-mail.svg, icon-bookmark.svg, icon-sparkle.svg, stat-premium-breeds.png, stat-happy-farmers.png, home-hero.png, home-egg-tray.png, home-chickens.png, footer-bg.png, auth-hero.png, auth-eggs-bg.png, auth-logo-large.png.
5. **Shared shell**: the root layout already renders `<Navbar />` (handles signed-in/out states itself) above `{children}`. Pages that show the footer in Figma must end with `<Footer />` from `@/components/layout/Footer`. Do NOT re-implement the navbar inside pages.
6. **State**: `useAuth()` from `@/components/providers/AuthProvider` (user, signIn, register, signOut, updateUser); `useCart()` from `@/components/providers/CartProvider`. Services in `@/services/*` wrap localStorage; keep `// TODO: Connect ...` comments for future backend integration.
7. **Forms**: React Hook Form + `zodResolver`. Auth schemas exist in `@/lib/validation/auth.ts`; add new schemas under `@/lib/validation/`.
8. Mock data lives in `@/data/mock-*.ts` — fill it with the exact content shown in the Figma frames (product names, prices, seminar titles, etc.). Never inline duplicate mock data in page components.
9. Routes are centralized in `@/constants/routes.ts`; months in `@/constants/months.ts`; statuses in `@/constants/statuses.ts`.
10. Typography: Inter is the default body font (`--font-inter`); Josefin Sans available via `font-josefin` class. Colors: `#c00` red accent, `#181818` dark, `#f4f4f4` light, `#7d7d7d` / `#6b6b6b` grays. Use Tailwind arbitrary values (e.g. `text-[#c00]`, `rounded-[20px]`) exactly as in Figma.
11. Buttons per Figma: dark `bg-[#181818]` or red `bg-[#c00]`, `rounded-[20px]`, `shadow-[0px_0px_20px_0px_rgba(0,0,0,0.15)]`, bold `text-[#f4f4f4] text-[24px]`, h-[85px]. Inputs: `border border-[#181818] rounded-[15px] h-[71px]` with 24px labels above and the red asterisk icon (`/figma/icon-asterisk.svg`) for required fields.
12. The dev server is already running on port 3000 — do NOT start another, do NOT run `npm run dev` or `npm run build`. Verify types with `npx tsc --noEmit` from `dacs-website/`.
13. Reference pages already implemented — read them to match conventions: `src/app/page.tsx` (Home), `src/components/layout/Navbar.tsx`, `src/components/layout/Footer.tsx`.
