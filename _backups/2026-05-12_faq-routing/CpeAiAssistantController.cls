public with sharing class CpeAiAssistantController {

    // ─── General FAQ: calls the Agentforce agent via REST API ─────────────────
    // Agent ID from Setup URL: .../EinsteinCopilot/0XxdL000003Pg0jSAC/edit
    private static final String AGENT_ID = '0XxdL000003Pg0jSAC';

    @AuraEnabled
    public static String sendFaqToAgent(String userMessage, String sessionId) {
        try {
            String baseUrl = URL.getOrgDomainUrl().toExternalForm();
            String token   = UserInfo.getSessionId();
            String apiVer  = 'v62.0';

            // 1. Start a new agent session
            HttpRequest startReq = new HttpRequest();
            startReq.setEndpoint(baseUrl + '/services/data/' + apiVer + '/einstein/ai-agent/sessions');
            startReq.setMethod('POST');
            startReq.setHeader('Authorization', 'Bearer ' + token);
            startReq.setHeader('Content-Type', 'application/json');
            startReq.setBody('{"agentId":"' + AGENT_ID + '","variables":[]}');
            startReq.setTimeout(30000);

            HttpResponse startRes = new Http().send(startReq);
            if (startRes.getStatusCode() < 200 || startRes.getStatusCode() >= 300) {
                return JSON.serialize(new Map<String,String>{
                    'error' => 'Session start failed (' + startRes.getStatusCode() + '): ' + startRes.getBody()
                });
            }
            Map<String,Object> startData = (Map<String,Object>) JSON.deserializeUntyped(startRes.getBody());
            String sid = String.valueOf(startData.get('id'));

            // 2. Send the message
            Map<String,Object> msgPayload = new Map<String,Object>{
                'message' => new Map<String,Object>{
                    'role'       => 'user',
                    'content'    => new List<Object>{ new Map<String,Object>{ 'type'=>'text', 'text'=>userMessage } },
                    'sequenceId' => 1
                },
                'variables' => new List<Object>()
            };
            HttpRequest msgReq = new HttpRequest();
            msgReq.setEndpoint(baseUrl + '/services/data/' + apiVer + '/einstein/ai-agent/sessions/' + sid + '/messages');
            msgReq.setMethod('POST');
            msgReq.setHeader('Authorization', 'Bearer ' + token);
            msgReq.setHeader('Content-Type', 'application/json');
            msgReq.setBody(JSON.serialize(msgPayload));
            msgReq.setTimeout(30000);

            HttpResponse msgRes = new Http().send(msgReq);
            if (msgRes.getStatusCode() < 200 || msgRes.getStatusCode() >= 300) {
                return JSON.serialize(new Map<String,String>{
                    'error' => 'Message failed (' + msgRes.getStatusCode() + '): ' + msgRes.getBody()
                });
            }

            // 3. Extract the reply text
            Map<String,Object> msgData = (Map<String,Object>) JSON.deserializeUntyped(msgRes.getBody());
            String reply = extractAgentReply(msgData);

            // 4. Close session (best-effort)
            try {
                HttpRequest delReq = new HttpRequest();
                delReq.setEndpoint(baseUrl + '/services/data/' + apiVer + '/einstein/ai-agent/sessions/' + sid);
                delReq.setMethod('DELETE');
                delReq.setHeader('Authorization', 'Bearer ' + token);
                delReq.setTimeout(10000);
                new Http().send(delReq);
            } catch (Exception ex) { /* ignore */ }

            if (String.isBlank(reply)) {
                return JSON.serialize(new Map<String,String>{'message' => 'No answer returned. Please rephrase your question.'});
            }
            return JSON.serialize(new Map<String,String>{'message' => reply});

        } catch (Exception e) {
            System.debug('FAQ Agent Exception: ' + e.getMessage() + '\n' + e.getStackTraceString());
            return JSON.serialize(new Map<String,String>{'error' => 'FAQ error: ' + e.getMessage()});
        }
    }

    private static String extractAgentReply(Map<String,Object> data) {
        if (data.containsKey('messages')) {
            for (Object m : (List<Object>) data.get('messages')) {
                Map<String,Object> msg = (Map<String,Object>) m;
                if ('assistant'.equalsIgnoreCase(String.valueOf(msg.get('role'))) && msg.containsKey('content')) {
                    String txt = '';
                    for (Object c : (List<Object>) msg.get('content')) {
                        Map<String,Object> chunk = (Map<String,Object>) c;
                        if (chunk.containsKey('text')) txt += String.valueOf(chunk.get('text'));
                    }
                    if (String.isNotBlank(txt)) return txt;
                }
            }
        }
        if (data.containsKey('message')) {
            Object inner = data.get('message');
            if (inner instanceof Map<String,Object>) {
                Map<String,Object> m = (Map<String,Object>) inner;
                if (m.containsKey('content')) return String.valueOf(m.get('content'));
                if (m.containsKey('text'))    return String.valueOf(m.get('text'));
            }
            return String.valueOf(inner);
        }
        for (String k : new List<String>{'text','response','answer','output'}) {
            if (data.containsKey(k) && data.get(k) != null) return String.valueOf(data.get(k));
        }
        return null;
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
}
