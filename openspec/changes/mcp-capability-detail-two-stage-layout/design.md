# Design

## Context

See `proposal.md` for motivation and `specs/mcp-capability-detail-ui/spec.md` for user-visible requirements. The current embedded MCP page is a fixed three-column grid: catalog, capability details, and schema/approval/history. Capability summaries are rendered in `index.js` into fixed element IDs, so the redesign must preserve these data sources and event behavior.

## Goals / Non-Goals

**Goals:**
- Keep the capability catalog visible beside the selected definition when the panel is wide enough.
- Keep the current step label and capability title fixed while the detail body scrolls independently.
- Put parameters, JSON Schema, approvals, and recent calls into distinct, comfortably sized detail views.
- Reflow the catalog and detail for narrow panels without clipping.

**Non-Goals:**
- Change MCP capability contracts, parameter validation, execution, approval, or history data.
- Redesign other Plugin Manager tabs or independent plugin panels.

## Decisions

- Replace the three-column grid with catalog plus detail; move schema, approval, and call history under detail tabs. This gives the selected capability more width and removes the permanently visible third rail. Keeping three columns and reducing all three widths was rejected because the parameter descriptions already fail at the current dock size.
- Split the detail into a fixed identity header and a flexed, internally scrollable body. The header contains the step marker and capability name. Scrolling the whole pane was rejected because it loses context while reading long schemas.
- Keep the existing schema, approval, and recent-call element IDs within their respective tab panels so the current render functions can continue targeting them. Add small local tab state handling without changing data flow.
- At narrow widths, stack the catalog before the detail and constrain each region's own scrolling; do not create page-level horizontal scrolling.

## Risks / Trade-offs

- Moving existing dynamic elements can break render selectors → preserve IDs and verify the MCP panel's render and tab interactions.
- Tabs hide secondary information until selected → use clear labels and retain all existing content in the corresponding view.

## Migration Plan

1. Update the embedded MCP markup and responsive styles.
2. Add tab switching that only changes visibility and active state.
3. Build and run the panel's focused tests, then run the Lite repository verification required by the project.
