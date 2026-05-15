# Codebase Structure

## Project Root
- `.planning/`: GSD planning and codebase documentation.
- `force-app/main/default/`: Primary source code directory.

## Frontend (LWC)
- `force-app/main/default/lwc/cpeAiAssistant/`:
    - `cpeAiAssistant.html`: UI structure (Header, CPE Menu, Assistant, Cart).
    - `cpeAiAssistant.js`: Main state machine, intent routing, and voice logic.
    - `cpeAiAssistant.css`: Premium UI styling (Glassmorphism, compact layouts).

## Backend (Apex)
- `force-app/main/default/classes/`:
    - `CpeAiAssistantController.cls`: Main controller for configuration and FAQ routing.
    - `CpeCheckVanInventoryAction.cls`: Agentforce Invocable action for van stock.
    - `CpeFindNearbyTechAction.cls`: Agentforce Invocable action for peer lookups.

## AI Configuration
- `force-app/main/default/genAiPromptTemplates/`:
    - `CPE_FAQ_Knowledge.genAiPromptTemplate-meta.xml`: FAQ troubleshooting prompt.
    - `CPE_Equipment_Manager.genAiPromptTemplate-meta.xml`: Configuration rules.
