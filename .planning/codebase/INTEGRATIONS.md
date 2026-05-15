# Integrations

## Internal Salesforce Integrations
- **LWC to Apex**: The `cpeAiAssistant` component uses `@AuraEnabled` methods to perform device configurations and FAQ queries.
- **Apex to Agentforce**: `CpeAiAssistantController` uses `ConnectApi.AgentService.query` to communicate with the Agentforce LLM.
- **Agentforce to Apex (Invocable)**: The Agent autonomously calls `CpeCheckVanInventoryAction` and `CpeFindNearbyTechAction` based on user intent.

## Data Model Integrations
- **Field Service (SFS)**: The system integrates directly with standard SFS objects:
    - `ServiceResource`: Tracks technician location and assigned van.
    - `ProductItem`: Stores real-time inventory quantity.
    - `Location`: Defines the physical van storage area.

## Browser Integrations
- **Web Speech API**: Integrated into the LWC to provide hands-free voice-to-text input for field technicians.
