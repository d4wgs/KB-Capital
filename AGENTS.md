# KB Capital frontend

Use one agent unless the user requests delegation. Develop on a branch. Production changes require release instructions for that change.

## Application structure

Run the Python application through `uv run python -m workspace.app`. The four existing URLs are server-rendered documents. The persistent workspace frame is defined once in `workspace/templates/PageLayout.html`. It owns the sidebar, breadcrumb, search dialog, main landmark and page title. Sidebar state persists across document navigation. Preserve native links, deep links, browser history and page-specific DOM IDs used by data scripts.

Register new pages in `workspace/registry.py` with a unique route, label, icon, category, template, permission and any required assets. Extend PageLayout in a Jinja page fragment under `workspace/templates/pages/`. Use the content, tools and footer blocks. The registry drives routing, server permission checks, active state, navigation groups and search. Empty categories stay hidden. Extend the authorized search handler when adding searchable entities.

Use the macros in `workspace/templates/components.html` for page and section headings, metrics, grids, tables, charts, legends, range selectors, tabs, buttons, status indicators and loading, empty or error messages. Pages own data and behavior. Keep calculations, fetch cadence, chart semantics, position grouping and risk disclosures intact. Keep the approved Gaussian animation in its existing component. Review the development-only showcase at `/dev/components/`.

## Design rules

Use continuous white surfaces, numbered section headings, aligned columns, rectangular controls, flat metrics and thin rules. Use Inter for interface copy, IBM Plex Mono with tabular figures for financial data and Helvetica for the wordmark. Use cobalt for navigation, selections and interactive emphasis. Pair financial colors with values or text. Preserve focus indicators, native disclosure behavior, reduced motion and mobile navigation. The shared tokens live in `workspace/templates/tokens.css`. Shell layout lives in `workspace/templates/workspace.css`. The mobile breakpoint is supplied once by the stylesheet route and the sidebar reads its computed mode. Legacy page CSS still controls specialized table and chart geometry.

## Trust boundary

Every application route authenticates on the server. Explicitly authorize financial reads, searches and future actions for the relevant permission. A navigation entry is presentation only. Never add a generic filesystem handler or a proxy that accepts arbitrary upstream URLs. Put private snapshots and password hashes outside the checkout. Keep trading keys, exchange credentials and privileged actions on the server. Browser integrations are public read-only market data and public-chain calls. Use separate authorization for future trading operations.

Before handoff run `uv run python -m unittest discover -s tests`, check the modified JavaScript, and inspect all routes at desktop and phone widths. Test direct URLs with no credentials and with insufficient permissions. Keep the component showcase disabled in production.
