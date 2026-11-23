# KB Capital frontend

Use one agent unless the user requests delegation. Develop on a branch. Production changes require release instructions for that change.

## Application structure

Build the public site with `uv run python -m workspace.build`. Use `--preview` for local development. The four existing URLs serve pre-rendered HTML on GitHub Pages. The persistent workspace frame is defined once in `workspace/templates/PageLayout.html`. It owns the sidebar, breadcrumb, search dialog, main landmark and page title. Sidebar state persists across document navigation. Preserve native links, deep links, browser history and page-specific DOM IDs used by data scripts.

Register new pages in `workspace/registry.py` with a unique route, label, icon, category, template, access designation and any required assets. Extend PageLayout in a Jinja page fragment under `workspace/templates/pages/`. Use the content, tools and footer blocks. The registry drives static page generation, active state, navigation groups and search. Empty categories stay hidden. Extend the page search in brand.js when adding other public searchable entities.

Use the macros in `workspace/templates/components.html` for page and section headings, metrics, grids, tables, charts, legends, range selectors, tabs, buttons, status indicators and loading, empty or error messages. Pages own data and behavior. Keep calculations, fetch cadence, chart semantics, position grouping and risk disclosures intact. Keep the approved Gaussian animation in its existing component. Review the development-only showcase at `/dev/components/`.

## Design rules

Use continuous white surfaces, numbered section headings, aligned columns, rectangular controls, flat metrics and thin rules. Use Inter for interface copy, IBM Plex Mono with tabular figures for financial data and Helvetica for the wordmark. Use cobalt for navigation, selections and interactive emphasis. Pair financial colors with values or text. Preserve focus indicators, native disclosure behavior, reduced motion and mobile navigation. The shared tokens live in `workspace/templates/tokens.css`. Shell layout lives in `workspace/templates/workspace.css`. The mobile breakpoint is supplied once by the static build and the sidebar reads its computed mode. Legacy page CSS still controls specialized table and chart geometry.

## Trust boundary

All routes, snapshots and shipped assets are public. Only register public pages. Keep credentials, private research, signing keys and privileged trading actions outside the static site and repository. Browser integrations use public read-only market and chain data.

Before handoff regenerate the static site and run `uv run python -m unittest discover -s tests`. Inspect all four routes on desktop and mobile, including search, collapsible navigation and expandable activity. The component showcase is rendered only for the local preview.
