# KB Capital website style guide

This guide describes the current public website. The shared stylesheet is [brand.css](brand.css). Load it after page-specific styles so navigation, typography and color tokens carry through to new pages.

## Color

| Role | Token | Value |
| --- | --- | --- |
| Links, active navigation, primary action and Gaussian mark | `--accent` | `#244FC4` |
| Primary text | `--text` | `#101114` |
| Secondary text and chart labels | `--muted` | `#64748B` |
| Tinted sections and selected rows | `--surface` | `#EDF1FA` |
| Page and panel background | `--bg` | `#FFFFFF` |
| Dividers and panel outlines | `--border` | `#E3E7ED` |
| Financial gain | `--green` | `#11643E` |
| Financial loss | `--red` | `#A02731` |

Use white space and thin rules to group content. Reserve financial colors for meaningful states. Include a sign or text label so readers can interpret the value without color.

## Typography and layout

Use Inter 400 for body text, Inter 600 for headings and IBM Plex Mono with tabular figures for financial data. The lowercase wordmark uses Helvetica Neue or Helvetica at weight 600. Keep the hero tagline prominent and center it beneath the Gaussian mark. Use left-aligned headings and prose for longer sections.

Use the shared 1280px outer container and responsive gutters from 1.25rem to 4rem. The base spacing unit is 1rem. Use 4px corners on primary controls and panels, and a 160ms transition for interactive color changes. Existing reporting pages retain specialized layouts and some legacy component styles.

## Navigation and motion

Use the same sticky header and route order on each page. Mark the current link with a cobalt underline and `aria-current="page"`. At 680px and below, use the Menu button. Keep the skip link and visible keyboard focus.

Use the reusable component in [gaussian.js](gaussian.js) for the hero and compact header mark. Only the curves move. The hero measures the wordmark to set their horizontal span. The header carries its phase across navigation. Both respect reduced motion and pause when hidden or outside the viewport. The footer and favicon use the static [Gaussian symbol](gaussian.svg).

## Reporting and disclosures

Label targets, hypothetical compounding and actual performance explicitly. Keep risk disclosures adjacent to illustrative returns. In Activity, show a play as a summary row and reveal individual fills on expansion. Preserve the market, outcome, fill count and position status at narrow widths. Use native disclosure controls for plays and FAQ answers.

## Reviewing changes

Check all four routes at desktop and phone widths. Test the menu, keyboard focus, reduced motion, and expanded activity rows. Verify readability with long market titles and partial trade histories. Keep page-specific styles in their existing stylesheets and update shared tokens here when the identity changes.
