# Architectural Concerns & Risks

## Schema Dependencies
- **Mobile Inventory**: The inventory logic relies on the `Location` object having both `IsMobile = true` and `IsInventoryLocation = true`. If these are toggled off, the Apex actions will fail to find van stock.
- **ServiceResource Link**: The system assumes the current User is linked to a `ServiceResource` record. This will cause errors for Admins or Users without an SFS license.

## AI Reasoning Drift
- **Topic Overlap**: There is a risk that the "FAQ" topic might respond to "Stock" questions if the instructions are not explicit. 
- **Prompt Sensitivity**: The `CPE_Equipment_Manager` template depends on a specific JSON output format. Any modification to the prompt must preserve the JSON structure to avoid LWC crashes.

## Browser Compatibility
- **Web Speech API**: Voice features are currently limited to browsers that support the Web Speech API (Chrome, Safari). It may not function in certain mobile WebView environments without specific configuration.
