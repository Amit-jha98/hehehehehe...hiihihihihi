# WindWatch UI/UX review

Research and redesign: October 24, 2026.

## Product and task

WindWatch supports a UK day-ahead buyer reviewing a national wind forecast as it was available at a historical purchase cutoff, then examining its realized error. The interface must distinguish purchase date, delivery date, forecast publication, and hindsight. It is not an order-entry application, a live trading terminal, or a portfolio procurement calculator.

This review combines observable energy-market interface patterns with published enterprise design and accessibility guidance. It does not claim that there is a single certified visual style for energy dashboards, or that automated tests constitute full accessibility certification.

## Web analysis and decisions

| Reference | Observed pattern / guidance | WindWatch implementation |
| --- | --- | --- |
| [Elexon: using the Insights Solution website](https://www.elexon.co.uk/bsc/data/kinnect-insights-solution/using-the-insights-solution-website/) | Market reports expose filtered data, downloadable formats, and API documentation. | Filters appear immediately above results; day CSV uses the selected decision; daily accuracy CSV uses the selected range and cutoff. Source documentation remains available. |
| [Nord Pool day-ahead data portal](https://data.nordpoolgroup.com/) | The public interface foregrounds time interval, market parameters, delivery periods and a data table. | Date and UTC controls form one toolbar. Values use explicit units, settlement periods and tabular numerals. Operational context takes priority over branding. |
| [NESO historic day-ahead wind forecasts](https://www.neso.energy/data-portal/day-ahead-wind-forecast/historic_day_ahead_wind_forecasts) | The dataset explorer offers table/chart views and distinguishes forecast datetime, settlement period and forecast timestamp. | The forecast has Chart/Table controls, 48 selectable settlement periods, and a publication/lead-time inspector. NESO was a UX reference only; application data still comes exclusively from Elexon. |
| [Carbon: data table guidelines](https://www.carbondesignsystem.com/components/data-table/usage/) | Group global actions in toolbars; use consistent row density, numeric alignment, row hover and explicit sorting controls. | Tables use 40px rows, right-aligned values, sticky headers, focusable overflow regions, sortable column headers with aria-sort, and named row actions. |
| [USWDS: tables](https://designsystem.digital.gov/components/table/) | Use semantic tables for structured data, concise cells, and clear row/column associations. | Tables have captions, scope attributes and text labels. Non-tabular source facts use definition lists. |
| [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Normal text contrast, visible focus, meaningful headings, reflow, keyboard operation and minimum target size are testable requirements. | Neutral high-contrast text, 12–14px supporting text, visible focus, a skip link, native controls, and 24px-or-larger button targets. Narrow-view and axe checks run in the browser suite. |

These patterns informed the design; they are not claims of affiliation with the referenced organizations.

## Problems in the earlier UI

- A large persistent sidebar and slogan-like page headings consumed space before the buyer reached the forecast.
- Repeated cards and uppercase micro-labels gave numerical data and secondary explanations similar visual weight.
- Decision date, cutoff and delivery context were separated across multiple rows.
- The forecast and its publication metadata were disconnected; a user had to open a long table to inspect a period.
- Four equally sized accuracy charts created scanning work before the user chose an analytical question.
- Long explanatory blocks repeated decision rules and uncertainty caveats in the main workflow.
- Changes of date and cutoff were not bookmarkable. Accuracy rows did not lead back to the relevant forecast.

## Revised information architecture

**Forecast:** purchase-date and cutoff toolbar → compact numerical summary → chart/table and interval inspector → calibration basis → optional calculation details.

**Accuracy:** delivery-range and cutoff toolbar → coverage → four main error measures → one selectable diagnostic breakdown → sortable daily results with forecast drill-down → optional error percentiles.

**Data & methodology:** historical-data notice → source coverage and provenance → source dataset definitions → calculation rules.

The top navigation is small and text-based. Headings name the task. Status text says “Historical Elexon data,” rather than using a live-looking green indicator for an archived extract.

## Visual and interaction rules

- Use a neutral page background, white working surfaces, thin separators and a small border radius. Avoid decorative gradients, ornamental icons and detached KPI cards.
- Use the system UI font. Body text is 14px; supporting labels are generally 12–13px; headings are 16–24px. Use tabular numerals for measurements.
- Blue identifies forecast values. The historical lower estimate uses a distinct amber dashed line. Actuals use charcoal and remain opt-in. Series are named in text, so color is not the only identifier.
- A shared unit selector switches the chart between GW and MW. Tables, inspector and numerical summaries explicitly retain MW/MWh labels. The inspector and tooltip include original publication times.
- Chart values can be inspected without hover: select a settlement period with the native selector or use the table's named interval buttons. Prev/next controls support adjacent-period review.
- Missing values remain gaps. A missing-only table filter exposes unavailable periods without inventing replacements. Empty filters explain why there are no rows.
- Accuracy exports reflect the active filter range. Selecting a daily result opens its forecast and preserves the cutoff; returning to Accuracy preserves the range.
- The URL records view, delivery date, cutoff and accuracy range. Reloading or sharing the URL restores that context.
- Methodology appears in context but is expanded on demand. CSV exports continue to label hindsight actuals explicitly.

## Verification and limits

The browser suite checks both 1440px desktop and 390px mobile layouts, with an additional 320 CSS pixel reflow check across all views. It exercises chart/table switching, units, settlement selection, sorting, missing-only filtering, history boundaries, downloads, accuracy drill-down, permalink restoration, retries, stale-request races and keyboard navigation.

Axe checks WCAG 2 A/AA, WCAG 2.1 AA and WCAG 2.2 AA rules across Forecast, Accuracy and Data views. Chart wrappers have appropriate named groups and metric values use valid definition-list structure. Automated checks cannot replace manual screen-reader testing or research with actual energy buyers; those remain follow-up validation, not completed claims.

The React/Python boundary, bundled Elexon snapshot, forecast selection rule and underlying calculations are unchanged by this UI redesign. No video recording or submission form was produced.
