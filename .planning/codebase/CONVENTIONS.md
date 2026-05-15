# Coding Conventions

## LWC Naming & Structure
- **Component Naming**: `cpeAiAssistant` (camelCase for the folder, `cpe-ai-assistant` for the HTML tag).
- **Public Properties**: Prefixed with `@api` for external configurability.
- **Private State**: Marked with `@track` only where complex object/array reactivity is required.

## Apex Standards
- **Invocable Actions**: One class per `@InvocableMethod` to ensure compatibility with Agentforce Studio.
- **Controller Logic**: Grouped by feature (Configuration, FAQ, Inventory) within `CpeAiAssistantController.cls`.
- **Exception Handling**: All controller methods return structured error messages in JSON for the LWC.

## CSS / Design System
- **Glassmorphism Tokens**: Use of `backdrop-filter: blur()`, `rgba(255, 255, 255, 0.1)`, and `border: 1px solid rgba(255, 255, 255, 0.2)`.
- **Vertical Hierarchy**: "Value over Label" stats (e.g., Number on top, "Available" on bottom).
- **Responsiveness**: Mobile-first layout designed for the Salesforce Mobile app.
