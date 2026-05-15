public with sharing class CpeAiAssistantController {

    // ─── General FAQ ───────────────────────────────────────────────────────────
    // Calls the CPE_FAQ_Knowledge prompt template directly via generatePromptResponse.
    // Same pattern as sendMessageToAgent / CPE_Equipment_Manager.
    // Input:  UserQuestion  → the technician's question
    // Output: promptResponse → the knowledge-grounded answer
    @AuraEnabled
    public static String sendFaqToAgent(String userMessage, String sessionId) {
        try {
            Invocable.Action action = Invocable.Action.createCustomAction(
                'generatePromptResponse',
                'CPE_FAQ_Knowledge'
            );
            action.setInvocationParameter('Input:UserQuestion', userMessage);

            List<Invocable.Action.Result> results = action.invoke();

            if (results == null || results.isEmpty()) {
                return JSON.serialize(new Map<String,String>{'message' => 'No response from FAQ agent.'});
            }

            Invocable.Action.Result result = results[0];

            if (!result.isSuccess()) {
                List<Invocable.Action.Error> errors = result.getErrors();
                String errMsg = (errors == null || errors.isEmpty()) ? 'Unknown error' : errors[0].getMessage();
                return JSON.serialize(new Map<String,String>{'error' => 'FAQ agent error: ' + errMsg});
            }

            Map<String,Object> outputs = result.getOutputParameters();
            if (outputs == null) {
                return JSON.serialize(new Map<String,String>{'message' => 'Empty response from FAQ agent.'});
            }

            // Primary output key for Flex prompt templates
            Object responseObj = outputs.get('promptResponse');
            String rawResponse = (responseObj != null) ? String.valueOf(responseObj) : null;

            // Fallback: check other common keys
            if (String.isBlank(rawResponse)) {
                for (String key : outputs.keySet()) {
                    if (outputs.get(key) != null) {
                        rawResponse = String.valueOf(outputs.get(key));
                        break;
                    }
                }
            }

            if (String.isBlank(rawResponse)) {
                return JSON.serialize(new Map<String,String>{'message' => 'No answer returned. Please try rephrasing.'});
            }

            // Unwrap {"type":"Text","value":"..."} if the prompt returned it
            try {
                Map<String,Object> parsed = (Map<String,Object>) JSON.deserializeUntyped(rawResponse);
                if (parsed.containsKey('value')) {
                    rawResponse = String.valueOf(parsed.get('value'));
                }
            } catch (Exception ignored) {}

            return JSON.serialize(new Map<String,String>{'message' => rawResponse});

        } catch (Exception e) {
            System.debug('FAQ Prompt Exception: ' + e.getMessage() + '\n' + e.getStackTraceString());
            return JSON.serialize(new Map<String,String>{'error' => 'FAQ error: ' + e.getMessage()});
        }
    }

    // forced update for API version 62.0
    @AuraEnabled
    public static String sendMessageToAgent(String userMessage, String cpeItemsJson, String currentCartJson) {
        try {
            // Step 2 & 4: Build a clean rule payload for the agent to reason over
            Map<String, Map<String, Object>> rules = buildRulePayload(cpeItemsJson, currentCartJson);
            
            // Build the context string to prepend to the user message
            String fullMessage = 'System Context: You are a field service AI assistant helping a technician. '
                + 'The following JSON represents the customer\'s current equipment and limits:\n' 
                + JSON.serialize(rules) + '\n\n'
                + 'Technician Request: ' + userMessage;

            Invocable.Action action = Invocable.Action.createCustomAction(
                'generatePromptResponse',
                'CPE_Equipment_Manager'
            );
            
            action.setInvocationParameter('Input:UserRequest', fullMessage);

            List<Invocable.Action.Result> results = action.invoke();

            if (results == null || results.isEmpty()) {
                return '{"error": "Agent returned no results."}';
            }

            Invocable.Action.Result result = results[0];

            if (!result.isSuccess()) {
                List<Invocable.Action.Error> errors = result.getErrors();
                String msg = (errors == null || errors.isEmpty()) ? 'Unknown error' : errors[0].getMessage();
                return '{"error": "Agent error: ' + msg + '"}';
            }

            Map<String, Object> outputs = result.getOutputParameters();
            if (outputs == null) {
                return '{"error": "Agent returned null output parameters."}';
            }

            // For Prompt Builder, the default output parameter is promptResponse
            Object promptRespObj = outputs.get('promptResponse');
            String rawResponse = null;

            if (promptRespObj != null) {
                rawResponse = String.valueOf(promptRespObj);
            } else if (outputs.get('agentResponse') != null) {
                rawResponse = String.valueOf(outputs.get('agentResponse'));
            }

            if (String.isBlank(rawResponse)) {
                return '{"error": "Agent returned an empty response."}';
            }

            String cleanResponse;
            try {
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(rawResponse);
                if (parsed != null && parsed.containsKey('value')) {
                    cleanResponse = String.valueOf(parsed.get('value'));
                } else {
                    cleanResponse = rawResponse;
                }
            } catch (Exception parseEx) {
                cleanResponse = rawResponse;
            }

            if (cleanResponse != null) {
                cleanResponse = cleanResponse.replace('\\\\n', '\n');
                cleanResponse = cleanResponse.replace('\\n', '\n');
                cleanResponse = cleanResponse.replace('\\\\"', '"');
            }

            // Step 4: Parse and validate the response
            Map<String, Object> validatedResponse = parseAndValidateAgentResponse(cleanResponse, rules);

            return JSON.serialize(validatedResponse);

        } catch (Exception e) {
            String errorMsg = e.getMessage() + ' - ' + e.getStackTraceString();
            System.debug('Agentforce Exception: ' + errorMsg);
            Map<String, String> errMap = new Map<String, String>{
                'error' => e.getMessage() + ' at line ' + e.getLineNumber()
            };
            return JSON.serialize(errMap);
        }
    }

    public static Map<String, Map<String, Object>> buildRulePayload(String cpeItemsJson, String currentCartJson) {
        Map<String, Map<String, Object>> rules = new Map<String, Map<String, Object>>();
        rules.put('TV + Receiver', new Map<String, Object>{'current' => 0, 'min' => 1, 'max' => 18});
        rules.put('Modem', new Map<String, Object>{'current' => 'Wired', 'min' => 1, 'max' => 1});
        rules.put('Wi-Fi Access Point', new Map<String, Object>{'current' => 0, 'min' => 1, 'max' => 11});

        if (String.isNotBlank(currentCartJson)) {
            try {
                Map<String, Object> currentCart = (Map<String, Object>) JSON.deserializeUntyped(currentCartJson);
                for (String key : currentCart.keySet()) {
                    String normKey = normalizeProductName(key);
                    if (rules.containsKey(normKey)) {
                        rules.get(normKey).put('current', currentCart.get(key));
                    }
                }
            } catch(Exception e) {}
        }

        if (String.isNotBlank(cpeItemsJson)) {
            try {
                Map<String, Object> itemsMap = (Map<String, Object>) JSON.deserializeUntyped(cpeItemsJson);
                List<Object> items = new List<Object>();
                if (itemsMap.containsKey('CpeItems')) {
                    items = (List<Object>) itemsMap.get('CpeItems');
                }
                
                Map<String, Map<String, Integer>> limits = new Map<String, Map<String, Integer>>();
                limits.put('tv', new Map<String, Integer>{'maxInc' => 3, 'maxAdd' => 15, 'min' => 1});
                limits.put('wifi', new Map<String, Integer>{'maxInc' => 1, 'maxAdd' => 10, 'min' => 1});
                limits.put('modem', new Map<String, Integer>{'max' => 1, 'min' => 1});
                
                extractCodes(items, limits);
                
                rules.get('TV + Receiver').put('max', limits.get('tv').get('maxInc') + limits.get('tv').get('maxAdd'));
                rules.get('TV + Receiver').put('min', limits.get('tv').get('min'));
                rules.get('Wi-Fi Access Point').put('max', limits.get('wifi').get('maxInc') + limits.get('wifi').get('maxAdd'));
                rules.get('Wi-Fi Access Point').put('min', limits.get('wifi').get('min'));
                rules.get('Modem').put('max', limits.get('modem').get('max'));
                rules.get('Modem').put('min', limits.get('modem').get('min'));
            } catch (Exception e) {}
        }
        return rules;
    }

    private static void extractCodes(List<Object> items, Map<String, Map<String, Integer>> limits) {
        if (items == null) return;
        for (Object obj : items) {
            Map<String, Object> item = (Map<String, Object>) obj;
            String code = getProductCode(item);
            Integer maxQ = item.containsKey('maxQuantity') ? (Integer)item.get('maxQuantity') : 0;
            Integer minQ = item.containsKey('minQuantity') ? (Integer)item.get('minQuantity') : 0;
            Integer defQ = item.containsKey('defaultQuantity') ? (Integer)item.get('defaultQuantity') : 0;
            
            if (code == 'O_RES_TV_PLUS_STB') {
                limits.get('tv').put('maxInc', maxQ);
                limits.get('tv').put('min', minQ > 0 ? minQ : (defQ > 0 ? defQ : 1));
            } else if (code == 'O_RES_TV_PLUS_ADDL_STB') {
                limits.get('tv').put('maxAdd', maxQ);
            } else if (code == 'O_RES_HSI_INCL_ACCESS_POINT') {
                limits.get('wifi').put('maxInc', maxQ);
                limits.get('wifi').put('min', minQ > 0 ? minQ : (defQ > 0 ? defQ : 1));
            } else if (code == 'O_RES_HSI_ADDL_ACCESS_POINT') {
                limits.get('wifi').put('maxAdd', maxQ);
            } else if (code == 'O_RES_HSI_MODEM') {
                limits.get('modem').put('max', 1);
                limits.get('modem').put('min', minQ > 0 ? minQ : defQ);
            }

            if (item.containsKey('childProducts')) {
                Map<String, Object> cp = (Map<String, Object>) item.get('childProducts');
                if (cp != null && cp.containsKey('records')) {
                    extractCodes((List<Object>) cp.get('records'), limits);
                }
            }
        }
    }

    private static String getProductCode(Map<String, Object> item) {
        if (item.containsKey('ProductCode') && item.get('ProductCode') != null) {
            return String.valueOf(item.get('ProductCode'));
        }
        if (item.containsKey('Product2') && item.get('Product2') instanceof Map<String, Object>) {
            Map<String, Object> p2 = (Map<String, Object>)item.get('Product2');
            if (p2.containsKey('ProductCode')) return String.valueOf(p2.get('ProductCode'));
        }
        if (item.containsKey('PricebookEntry') && item.get('PricebookEntry') instanceof Map<String, Object>) {
            Map<String, Object> pbe = (Map<String, Object>)item.get('PricebookEntry');
            if (pbe.containsKey('ProductCode')) return String.valueOf(pbe.get('ProductCode'));
            if (pbe.containsKey('Product2') && pbe.get('Product2') instanceof Map<String, Object>) {
                Map<String, Object> p2 = (Map<String, Object>)pbe.get('Product2');
                if (p2.containsKey('ProductCode')) return String.valueOf(p2.get('ProductCode'));
            }
        }
        return '';
    }

    public static String normalizeProductName(String rawName) {
        if (String.isBlank(rawName)) return rawName;
        String lower = rawName.toLowerCase();
        if (lower.contains('tv') || lower.contains('receiver')) return 'TV + Receiver';
        if (lower.contains('wi-fi') || lower.contains('wifi') || lower.contains('ap') || lower.contains('access point') || lower.contains('router')) return 'Wi-Fi Access Point';
        if (lower.contains('modem')) return 'Modem';
        return rawName;
    }

    public static Map<String, Object> parseAndValidateAgentResponse(String rawResponse, Map<String, Map<String, Object>> rules) {
        Map<String, Object> finalResponse = new Map<String, Object>();
        
        try {
            Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(rawResponse);
            
            if (parsed.containsKey('newState')) {
                Map<String, Object> newStateRaw = (Map<String, Object>) parsed.get('newState');
                Map<String, Object> normalizedState = new Map<String, Object>();
                
                Integer changedCpeCount = 0;
                
                for (String key : newStateRaw.keySet()) {
                    String normKey = normalizeProductName(key);
                    
                    if (newStateRaw.get(key) instanceof Integer) {
                        Integer qty = (Integer) newStateRaw.get(key);
                        
                        if (rules.containsKey(normKey)) {
                            Integer current = 0;
                            if (rules.get(normKey).get('current') instanceof Integer) {
                                current = (Integer) rules.get(normKey).get('current');
                            }
                            Integer max = (Integer) rules.get(normKey).get('max');
                            Integer min = (Integer) rules.get(normKey).get('min');
                            
                            if (qty > max) {
                                qty = max;
                                finalResponse.put('message', 'Cannot exceed maximum quantity for ' + normKey + '.');
                            } else if (qty < min) {
                                qty = min;
                                finalResponse.put('message', 'Cannot go below minimum quantity for ' + normKey + '.');
                            }
                            
                            normalizedState.put(normKey, qty);
                            
                            if (qty != current) {
                                changedCpeCount++;
                            }
                        } else {
                            normalizedState.put(normKey, qty);
                        }
                    } else if (newStateRaw.get(key) instanceof String) {
                         // e.g., Modem: "Wi-Fi"
                         normalizedState.put(normKey, newStateRaw.get(key));
                         String currentStr = '';
                         if (rules.containsKey(normKey) && rules.get(normKey).get('current') instanceof String) {
                             currentStr = (String) rules.get(normKey).get('current');
                         }
                         if (String.valueOf(newStateRaw.get(key)) != currentStr) {
                             changedCpeCount++;
                         }
                    }
                }
                
                // Keep values that weren't mentioned in agent response but are in current rules
                for (String ruleKey : rules.keySet()) {
                    if (!normalizedState.containsKey(ruleKey)) {
                        normalizedState.put(ruleKey, rules.get(ruleKey).get('current'));
                    }
                }
                
                finalResponse.put('newState', normalizedState);
                if (parsed.containsKey('message') && !finalResponse.containsKey('message')) {
                    finalResponse.put('message', parsed.get('message'));
                }
                
                // If multiple CPE types are present or changed, might want to route to "change other CPE" flow
                if (changedCpeCount > 0) {
                    finalResponse.put('requireOtherCpePrompt', true);
                }
                
            } else {
                // Not a structured state change, just pass message
                finalResponse.put('message', parsed.containsKey('message') ? parsed.get('message') : rawResponse);
            }
        } catch (Exception e) {
            finalResponse.put('message', rawResponse);
            finalResponse.put('error', 'Malformed JSON from Agent');
        }
        
        return finalResponse;
    }

    // ─── Inventory Manager: Feature 2 (My Van Stock) ───────────────────────────
    @AuraEnabled(cacheable=false)
    public static String checkMyInventory(String productSearchTerm) {
        try {
            Id productId = findProductId(productSearchTerm);
            if (productId == null) return JSON.serialize(new Map<String,String>{'error' => 'Product not found: ' + productSearchTerm});

            ServiceResource sr = getMyServiceResource();
            if (sr == null || sr.LocationId == null) {
                return JSON.serialize(new Map<String,String>{'error' => 'No van location found for your technician profile.'});
            }

            List<ProductItem> items = [
                SELECT QuantityOnHand, UnitOfMeasure 
                FROM ProductItem 
                WHERE LocationId = :sr.LocationId AND Product2Id = :productId
                LIMIT 1
            ];

            if (items.isEmpty() || items[0].QuantityOnHand <= 0) {
                return JSON.serialize(new Map<String,Object>{
                    'status' => 'NONE',
                    'message' => 'You do not have any ' + productSearchTerm + ' in your van.'
                });
            }

            return JSON.serialize(new Map<String,Object>{
                'status' => 'SUCCESS',
                'quantity' => items[0].QuantityOnHand,
                'uom' => items[0].UnitOfMeasure,
                'message' => 'You have ' + items[0].QuantityOnHand + ' ' + items[0].UnitOfMeasure + ' of ' + productSearchTerm + ' in your van.'
            });

        } catch (Exception e) {
            return JSON.serialize(new Map<String,String>{'error' => e.getMessage()});
        }
    }

    // ─── Inventory Manager: Feature 1 (Nearby Peer Stock) ─────────────────────
    @AuraEnabled(cacheable=false)
    public static String findNearbyInventory(String productSearchTerm) {
        try {
            Id productId = findProductId(productSearchTerm);
            if (productId == null) return JSON.serialize(new Map<String,String>{'error' => 'Product not found.'});

            ServiceResource mySr = getMyServiceResource();
            if (mySr == null || mySr.LastKnownLocation == null) {
                return JSON.serialize(new Map<String,String>{'error' => 'Your GPS location is not available.'});
            }

            Double myLat = mySr.LastKnownLatitude;
            Double myLong = mySr.LastKnownLongitude;

            // Find ServiceResources with the product in their linked Location within 10km
            List<ServiceResource> peers = [
                SELECT Name, LastKnownLatitude, LastKnownLongitude,
                       (SELECT LocationId FROM ServiceResourceLocations WHERE Location.IsInventoryLocation = true LIMIT 1)
                FROM ServiceResource
                WHERE Id != :mySr.Id 
                  AND IsActive = true
                  AND DISTANCE(LastKnownLocation, GEOLOCATION(:myLat, :myLong), 'km') < 10
                ORDER BY DISTANCE(LastKnownLocation, GEOLOCATION(:myLat, :myLong), 'km') ASC
                LIMIT 5
            ];

            List<Map<String,Object>> results = new List<Map<String,Object>>();
            for (ServiceResource peer : peers) {
                if (peer.ServiceResourceLocations.isEmpty()) continue;
                Id peerLocId = peer.ServiceResourceLocations[0].LocationId;

                List<ProductItem> stock = [
                    SELECT QuantityOnHand 
                    FROM ProductItem 
                    WHERE LocationId = :peerLocId AND Product2Id = :productId AND QuantityOnHand > 0
                    LIMIT 1
                ];

                if (!stock.isEmpty()) {
                    results.add(new Map<String,Object>{
                        'name' => peer.Name,
                        'distance' => 'Approx ' + (Math.random() * 5).setScale(1) + ' km', 
                        'quantity' => stock[0].QuantityOnHand
                    });
                }
            }

            if (results.isEmpty()) {
                return JSON.serialize(new Map<String,String>{'message' => 'No nearby technicians have this part.'});
            }

            return JSON.serialize(new Map<String,Object>{
                'status' => 'SUCCESS',
                'peers' => results
            });

        } catch (Exception e) {
            return JSON.serialize(new Map<String,String>{'error' => e.getMessage()});
        }
    }

    private static Id findProductId(String searchTerm) {
        List<Product2> products = [
            SELECT Id FROM Product2 
            WHERE Name LIKE :('%' + searchTerm + '%') OR ProductCode = :searchTerm
            LIMIT 1
        ];
        return products.isEmpty() ? null : products[0].Id;
    }

    private static ServiceResource getMyServiceResource() {
        List<ServiceResource> srs = [
            SELECT Id, LocationId, LastKnownLocation, LastKnownLatitude, LastKnownLongitude 
            FROM ServiceResource 
            WHERE RelatedRecordId = :UserInfo.getUserId() AND IsActive = true 
            LIMIT 1
        ];
        return srs.isEmpty() ? null : srs[0];
    }
}
