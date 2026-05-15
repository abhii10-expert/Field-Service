public with sharing class CpeAiAssistantController {

    @AuraEnabled
    public static String sendMessageToAgent(String userMessage, String cpeItemsJson, String currentCartJson, String chatHistory) {
        Map<String, Object> finalResponse = new Map<String, Object>();
        
        try {
            // Parse context from JS
            Map<String, Object> currentCart = (Map<String, Object>) JSON.deserializeUntyped(currentCartJson);
            
            // Build the dynamic rules context for the agent
            Map<String, Map<String, Object>> rules = buildRulePayload(currentCart);
            
            // Build the context string to prepend to the user message
            String fullMessage = 'System Context: You are a field service AI assistant helping a technician. '
                + 'The following JSON represents the customer\'s current equipment and limits:\n' 
                + JSON.serialize(rules) + '\n\n'
                + 'Conversation History (CONTEXT ONLY - DO NOT REPLAY ACTIONS):\n' + (String.isNotBlank(chatHistory) ? chatHistory : 'No prior history.') + '\n\n'
                + 'CRITICAL REQUIREMENT: Every technician request must be processed INDEPENDENTLY. '
                + 'Do NOT re-apply or mention past modifications from the history. '
                + 'ONLY apply the change requested in the "Latest Request" below. '
                + 'If the request is unrelated to previous actions, ignore those actions in your response.\n'
                + 'Technician Latest Request: ' + userMessage;

            // Use the standard Invocable Action type for Prompt Templates
            Invocable.Action action = Invocable.Action.createCustomAction('generatePromptResponse', 'CPE_Equipment_Manager');
            action.setInvocationParameter('Input:UserRequest', fullMessage);
            
            List<Invocable.Action.Result> results = action.invoke();
            
            if (results.isEmpty() || !results[0].isSuccess()) {
                String errorDetail = results.isEmpty() ? 'No results returned' : results[0].getErrors()[0].getMessage();
                finalResponse.put('message', 'I encountered an error communicating with the configuration engine: ' + errorDetail);
                return JSON.serialize(finalResponse);
            }
            
            String rawResponse = (String) results[0].getOutputParameters().get('promptResponse');
            
            // Clean up the response if it contains markdown backticks
            if (rawResponse != null && rawResponse.contains('```')) {
                if (rawResponse.contains('```json')) {
                    rawResponse = rawResponse.substringAfter('```json').substringBefore('```');
                } else {
                    rawResponse = rawResponse.substringAfter('```').substringBeforeLast('```');
                }
            }
            if (rawResponse != null) rawResponse = rawResponse.trim();

            Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(rawResponse);
            
            // Re-validate and sanitize the agent's proposed state
            if (parsed.containsKey('newState')) {
                Map<String, Object> newStateRaw = (Map<String, Object>) parsed.get('newState');
                Map<String, Object> normalizedState = new Map<String, Object>();
                Set<String> agentMentionedKeys = new Set<String>();

                // Normalize keys and track which ones the agent actually returned
                for (String k : newStateRaw.keySet()) {
                    String normK = normalizeProductName(k);
                    agentMentionedKeys.add(normK);
                    
                    Object rawVal = newStateRaw.get(k);
                    if (rawVal instanceof String) {
                        try {
                            normalizedState.put(normK, Integer.valueOf((String)rawVal));
                        } catch (Exception e) {
                            normalizedState.put(normK, rawVal);
                        }
                    } else {
                        normalizedState.put(normK, rawVal);
                    }
                }

                List<Map<String, Object>> stateChanges = new List<Map<String, Object>>();
                Integer changedCpeCount = 0;

                for (String key : rules.keySet()) {
                    // CRITICAL: Skip products not explicitly returned by the agent
                    if (!agentMentionedKeys.contains(key)) continue;

                    if (rules.containsKey(key)) {
                        Object newVal = normalizedState.get(key);
                        Object curVal = rules.get(key).get('current');

                        // Use String comparison to avoid Apex Map object-identity false positives
                        Boolean hasChanged = (String.valueOf(newVal) != String.valueOf(curVal));
                        if (!hasChanged) continue;
                        
                        Map<String, Object> change = new Map<String, Object>{
                            'label' => key.toUpperCase(),
                            'productCode' => key == 'TV + Receiver' ? 'O_RES_TV_PLUS_STB' : (key == 'Modem' ? 'O_RES_HSI_MODEM' : 'O_RES_HSI_WIFI_EXTENDER'),
                            'oldUnits' => curVal,
                            'newUnits' => newVal
                        };
                        
                        if (newVal instanceof Integer && curVal instanceof Integer) {
                            change.put('units', (Integer)newVal - (Integer)curVal);
                            changedCpeCount++;
                        }
                        
                        if (rules.get(key).get('max') instanceof Integer && newVal instanceof Integer) {
                            change.put('availableUnits', (Integer)rules.get(key).get('max') - (Integer)newVal);
                        }
                        
                        Integer curQty = (curVal instanceof Integer) ? (Integer)curVal : 0;
                        Integer newQty = (newVal instanceof Integer) ? (Integer)newVal : 0;
                        Integer diff = newQty - curQty;
                        Integer diffAbs = Math.abs(diff);

                        if (key == 'TV + Receiver') {
                            change.put('chargeImpact', (diff >= 0 ? '+$' : '-$') + (diffAbs * 15) + '.00');
                        } else if (key == 'Modem') {
                            change.put('chargeImpact', '+$15.00');
                        } else if (key == 'Wi-Fi Access Point') {
                            change.put('chargeImpact', (diff >= 0 ? '+$' : '-$') + (diffAbs * 10) + '.00');
                        }
                        
                        stateChanges.add(change);
                    }
                }
                finalResponse.put('stateChanges', stateChanges);

                if (parsed.containsKey('message') && !finalResponse.containsKey('message')) {
                    finalResponse.put('message', (String)parsed.get('message'));
                }
                
                if (changedCpeCount > 0) {
                    finalResponse.put('requireOtherCpePrompt', true);
                }
                
            } else {
                finalResponse.put('message', parsed.containsKey('message') ? (String)parsed.get('message') : rawResponse);
            }
        } catch (Exception e) {
            finalResponse.put('message', 'I encountered an error processing the configuration change: ' + e.getMessage());
            finalResponse.put('error', e.getMessage());
        }
        
        return JSON.serialize(finalResponse);
    }

    private static Map<String, Map<String, Object>> buildRulePayload(Map<String, Object> currentCart) {
        Map<String, Map<String, Object>> rules = new Map<String, Map<String, Object>>();
        
        // Product 1: TV + Receiver
        Map<String, Object> tv = new Map<String, Object>();
        tv.put('current', currentCart.get('TV + Receiver'));
        tv.put('base', currentCart.get('baseTv'));
        tv.put('min', 1);
        tv.put('max', 18);
        rules.put('TV + Receiver', tv);
        
        // Product 2: Modem
        Map<String, Object> modem = new Map<String, Object>();
        modem.put('current', currentCart.get('Modem'));
        modem.put('base', currentCart.get('baseModem'));
        modem.put('min', 1);
        modem.put('max', 1);
        rules.put('Modem', modem);
        
        // Product 3: Wi-Fi Access Point
        Map<String, Object> wifi = new Map<String, Object>();
        wifi.put('current', currentCart.get('Wi-Fi Access Point'));
        wifi.put('base', currentCart.get('baseWifi'));
        wifi.put('min', 1);
        wifi.put('max', 11);
        rules.put('Wi-Fi Access Point', wifi);
        
        return rules;
    }

    public static String normalizeProductName(String rawName) {
        if (String.isBlank(rawName)) return rawName;
        String lower = rawName.toLowerCase();
        if (lower.contains('tv') || lower.contains('receiver')) return 'TV + Receiver';
        if (lower.contains('wi-fi') || lower.contains('wifi') || lower.contains('ap') || lower.contains('access point') || lower.contains('router')) return 'Wi-Fi Access Point';
        if (lower.contains('modem')) return 'Modem';
        return rawName;
    }

    @AuraEnabled
    public static String sendFaqToAgent(String userMessage, String sessionId) {
        try {
            Invocable.Action action = Invocable.Action.createCustomAction('generatePromptResponse', 'CPE_FAQ_Knowledge');
            action.setInvocationParameter('Input:UserQuestion', userMessage);
            List<Invocable.Action.Result> results = action.invoke();
            if (!results.isEmpty() && results[0].isSuccess()) {
                return (String) results[0].getOutputParameters().get('promptResponse');
            }
        } catch (Exception e) {}
        return 'I am sorry, I cannot answer that right now.';
    }

    @AuraEnabled
    public static String checkMyInventory(String productSearchTerm) {
        Map<String, Object> response = new Map<String, Object>();
        try {
            String userId = UserInfo.getUserId();
            List<ServiceResource> sr = [SELECT Id FROM ServiceResource WHERE RelatedRecordId = :userId LIMIT 1];
            if (sr.isEmpty()) {
                response.put('status', 'ERROR');
                response.put('message', 'Service Resource not found.');
                return JSON.serialize(response);
            }
            
            List<Map<String, Object>> items = new List<Map<String, Object>>();
            items.add(new Map<String, Object>{
                'productName' => 'TV + Receiver',
                'quantity' => 5,
                'statusText' => 'In Stock',
                'statusClass' => 'inv-status in-stock',
                'hasStock' => true,
                'uom' => 'Units'
            });
            items.add(new Map<String, Object>{
                'productName' => 'Wi-Fi Access Point',
                'quantity' => 3,
                'statusText' => 'In Stock',
                'statusClass' => 'inv-status in-stock',
                'hasStock' => true,
                'uom' => 'Units'
            });
            items.add(new Map<String, Object>{
                'productName' => 'Modem (Wi-Fi)',
                'quantity' => 2,
                'statusText' => 'In Stock',
                'statusClass' => 'inv-status in-stock',
                'hasStock' => true,
                'uom' => 'Units'
            });
            
            response.put('status', 'SUCCESS');
            response.put('items', items);
        } catch (Exception e) {
            response.put('status', 'ERROR');
            response.put('message', e.getMessage());
        }
        return JSON.serialize(response);
    }

    @AuraEnabled
    public static String findNearbyInventory(String productSearchTerm) {
        Map<String, Object> response = new Map<String, Object>();
        try {
            List<Map<String, Object>> peers = new List<Map<String, Object>>();
            peers.add(new Map<String, Object>{
                'name' => 'Sarah Miller',
                'distance' => '0.8 km away',
                'quantity' => 2,
                'hasStock' => true,
                'initials' => 'SM',
                'phone' => '555-0123'
            });
            peers.add(new Map<String, Object>{
                'name' => 'Dave Wilson',
                'distance' => '1.5 km away',
                'quantity' => 1,
                'hasStock' => true,
                'initials' => 'DW',
                'phone' => '555-0456'
            });
            response.put('status', 'SUCCESS');
            response.put('peers', peers);
        } catch (Exception e) {
            response.put('status', 'ERROR');
            response.put('message', e.getMessage());
        }
        return JSON.serialize(response);
    }
}
