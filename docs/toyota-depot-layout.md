# Toyota depot — reference-based warehouse scene

Updated 14 September 2026 from the supplied photographs and handwritten plan, including the subsequent left/right correction.

- Building: 255 m wide × 120 m deep, plus a 30 m canopy at the front.
- Facing the warehouse from its truck bays, left to right: D22 reserve, D22 primary, R&R, mezzanine/lower floor.
- PMSP spans the rear of both D22 primary and reserve. The forward D22 rack runs stop short of that rear band.
- The right-hand mezzanine occupies 102 × 95 m over the large-parts lower floor. Small parts are on three-tier shelves upstairs; ground racks are three-tier and run front-to-back. R&R and D22 pallet racks are four-tier.
- A cross-building green gangway separates storage from staging/sorting/packing. Blue cage dollies, green/cream kururus, forklifts, packing tables, blue shutters, yellow barriers, cream structural steel, fans and trucks follow the photo palette.
- The mezzanine has a goods-lift shaft, stairs, guardrails and six animated pickers. Pickers walk along shelf aisles and pause to scan. The RF-picker label shows an illustrative bin and quantity; it is not a live warehouse-management assignment.

`frontend/src/components/warehouse/depotPlan.ts` holds dimensions, provisional rack counts, zone labels and station marker positions. Change row/bay counts here after the aisle survey. Renderer geometry is in `WarehouseDepot.tsx`; its instanced static-builder coordinates retain the original reference grid and are reflected across X once in `add()`. Labels and station locations use final world coordinates. Do not mirror their text.

The Toyota scene is separate from the other plants. Overview, Layout plan, Gangway, Inside R&R, Mezzanine and Truck bays are camera presets; floor and roof controls expose storage interiors. Both the dashboard's 2D button and Layout plan use the same warehouse geometry in overhead view. Expand view has an Escape shortcut. Pause motion freezes vehicles, lift, fans and pickers.

Station markers use incoming telemetry. All personnel and vehicle motion remains representative. Rack counts, internal bay assignments and worker tasks are provisional; physical dimensions above are from the user's brief. The geometry remains inspectable without telemetry. The existing backend serial warehouse model and unrelated analytics were not redesigned in this visual-layout task.
