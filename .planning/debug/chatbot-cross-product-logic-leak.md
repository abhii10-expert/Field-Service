---
status: resolved
slug: chatbot-cross-product-logic-leak
trigger: "Cross-product logic leakage in CPE AI Assistant chatbot — unrelated products get modified, wrong validation messages appear"
created: 2026-05-15T08:21:00Z
updated: 2026-05-15T08:23:00Z
---

# Debug Session: chatbot-cross-product-logic-leak

## Symptoms
- **Add Receivers flow**: User says "2" → bot shows "Cannot go below minimum quantity for Wi-Fi Access Point" AND removes/modifies Wi-Fi Access Point quantity
- **Change Modem flow**: User says "wifi" → bot shows "Cannot go below minimum quantity for Wi-Fi Access Point" AND modifies Wi-Fi Access Point quantities
- Unrelated products are being modified in every action
- Success messages include unrelated product changes
- Validation messages from one product bleed into another product's flow

## Current Focus
- hypothesis: The Apex `parseAndValidateAgentResponse` method iterates ALL products in `newState` (including unchanged ones), and the agent prompt includes ALL current values. The AI agent is echoing back ALL products in newState (not just the changed one), causing the controller to diff every product against its current value. Since the agent sometimes hallucinates a slightly different value for untouched products (or the min-quantity clamp fires on the wrong product), cross-product mutation occurs.
- next_action: gather initial evidence

## Evidence
(populated during investigation)

## Eliminated Hypotheses
(populated during investigation)

## Resolution

### Root Cause (4 compounding bugs)

**Bug 1 — Apex `parseAndValidateAgentResponse` (line ~347-352):**
The method filled ALL products from `rules` into `normalizedState` even when the AI agent didn't mention them. Then the stateChanges loop compared EVERY product against `rules.current` using `!=` (Apex object identity, not value equality). Products the agent echoed back at unchanged values (e.g., `Wi-Fi: 2` when Wi-Fi wasn't requested) could appear as stateChanges due to Map key aliasing.

**Bug 2 — Apex validation message leakage:**
The `finalResponse.put('message', 'Cannot go below minimum...')` call was unconditional — whichever product's validation fired last would overwrite the correct message. For modem-change flows, the AI agent sometimes returned all three products in `newState`, and a Wi-Fi validation (min=1 clamping Wi-Fi from 2→1 if agent returned 0 accidentally) would overwrite the modem success message.

**Bug 3 — Apex `newVal != curVal` object-identity comparison:**
Apex Maps store primitives in Object wrappers. `Integer(2) != Integer(2)` can be `true` when stored via different code paths. This caused spurious stateChanges for unchanged products.

**Bug 4 — JS `processAiResponse` used `if (parsed.stateChanges)` (truthy check):**
This triggered on an empty array `[]`, causing `diffDetected` to remain false (forEach over empty = noop) but the logic flow was already entered, leading to unpredictable combinedItems behavior.

### Fix

- **Apex**: Added `agentMentionedKeys` Set. Only products explicitly in the agent's `newState` JSON are eligible for stateChanges. Products filled in for state continuity are excluded.
- **Apex**: Validation messages are now product-isolated via `validationProduct` guard. First product to hit validation claims the message slot; subsequent unrelated products cannot overwrite it.
- **Apex**: `newVal != curVal` replaced with `String.valueOf(newVal) != String.valueOf(curVal)` to avoid object-identity false positives.
- **JS**: `hasStateChanges` guard uses `Array.isArray(...) && length > 0` to correctly gate the update card path.

### Files Changed
- `force-app/main/default/classes/CpeAiAssistantController.cls` — `parseAndValidateAgentResponse` method
- `force-app/main/default/lwc/cpeAiAssistant/cpeAiAssistant.js` — `processAiResponse` method
