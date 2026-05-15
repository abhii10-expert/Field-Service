# System Architecture

## Hybrid Intelligence Design
The system uses a "Hybrid" architectural pattern where responsibilities are split between local LWC logic and Agentforce AI reasoning:

### 1. Local State Machine (LWC)
- **Draft Order Management**: The LWC maintains the current "in-memory" state of device changes (Quantity increases/decreases).
- **UI Responsiveness**: Instant UI updates for button clicks and tab switching.
- **Voice Interception**: Local processing of voice transcripts before sending to the AI.

### 2. Cognitive Reasoning (Agentforce)
- **Intent Routing**: The Agent determines if a user wants to "Troubleshoot" (FAQ), "Change Equipment" (Configuration), or "Check Stock" (Inventory).
- **Invocable Execution**: When the Agent needs real-world data (e.g., "Do I have modems?"), it executes standalone Apex Action classes.

## Data Flow Pattern
1.  **User Input**: Text or Voice is captured in `cpeAiAssistant.js`.
2.  **Controller Routing**: Input is sent to `CpeAiAssistantController.cls`.
3.  **Agent Gateway**: The controller invokes `ConnectApi.AgentService`.
4.  **Action Execution**: The Agent calls `CpeCheckVanInventoryAction` if needed.
5.  **Response Cycle**: Data is returned through the chain to the LWC for rendering.
