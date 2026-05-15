import { LightningElement, track, api } from 'lwc';
import sendMessageToAgent from '@salesforce/apex/CpeAiAssistantController.sendMessageToAgent';
import sendFaqToAgent from '@salesforce/apex/CpeAiAssistantController.sendFaqToAgent';
import checkMyInventory from '@salesforce/apex/CpeAiAssistantController.checkMyInventory';
import findNearbyInventory from '@salesforce/apex/CpeAiAssistantController.findNearbyInventory';

export default class CpeAiAssistant extends LightningElement {
    @api serviceAppointmentNumber = 'SA-00045721';
    @api customerName = 'John Doe';
    @api cpeItems = `{
  "CpeItems": [
    {
      "action": "Add",
      "itemType": "lineItem",
      "maxQuantity": 3,
      "minQuantity": 0,
      "defaultQuantity": 1,
      "ProductCode": "O_RES_TV_PLUS_STB"
    },
    {
      "itemType": "childProduct",
      "maxQuantity": 15,
      "minQuantity": 0,
      "defaultQuantity": 0,
      "ProductCode": "O_RES_TV_PLUS_ADDL_STB"
    },
    {
      "action": "Add",
      "itemType": "lineItem",
      "maxQuantity": 99999,
      "minQuantity": 0,
      "defaultQuantity": 1,
      "ProductCode": "O_RES_HSI_MODEM"
    },
    {
      "itemType": "childProduct",
      "maxQuantity": 99999,
      "minQuantity": 0,
      "defaultQuantity": 0,
      "ProductCode": "O_RES_HSI_WIFI_EXTENDER"
    }
  ]
}`;

    @track messages = [
        {
            id: 0,
            isAi: true,
            wrapperClass: 'chat-wrapper ai',
            bubbleClass: 'chat-bubble ai',
            text: '👋🏼 I have reviewed your current setup.',
            textLines: ['👋🏼 I have reviewed your current setup.'],
            isSetupIntro: true,
            setupItems: [
                { label: '2 TV Receiver' },
                { label: 'Wired Modem' },
                { label: '2 Wi-Fi AP' }
            ],
            ctaText: 'What would you like to improve?'
        }
    ];

    @track quickActions = ['Add Receivers', 'Add Wi-Fi AP', 'Change Modem', 'Remove Device'];
    @track draftOrder = [];
    @track isChatOpen = false;
    @track isCartOpen = false;
    @track isTyping = false;
    @track isListening = false;
    @track interimTranscript = '';
    @track sessionId = 'session-' + Math.random().toString(36).substr(2, 9);
    
    userInput = '';
    messageIdCounter = 1;
    currentFlow = null;

    // Base States (Current confirmed state)
    @track baseTv = 2;
    @track baseWifi = 2;
    @track baseModem = 'Wired';

    // Initial States (Component load state - used to calculate session consumption)
    initialBaseTv = 2;
    initialBaseWifi = 2;
    initialBaseModem = 'Wired';

    // Device States (Draft state)
    @track tvCurrent = 2;
    @track wifiCurrent = 2;
    @track modemCurrent = 'Wired';

    get tvAvailable() { return this.tvMax - this.tvCurrent; }
    get wifiAvailable() { return this.wifiMax - this.wifiCurrent; }
    get tvMax() { return 18; }
    get wifiMax() { return 11; }
    get tvMin() { return 1; }
    get wifiMin() { return 1; }
    modemAvailable = ['Wired', 'Wi-Fi', 'Customer Provided'];
    get modemOtherOptions() {
        return this.modemAvailable.filter(opt => opt !== this.modemCurrent);
    }

    // Draft calculations
    get tvDiff() { return this.tvCurrent - this.baseTv; }
    get wifiDiff() { return this.wifiCurrent - this.baseWifi; }
    get isModemChanged() { return this.modemCurrent !== this.baseModem; }

    get hasDraftChanges() { return this.tvDiff !== 0 || this.wifiDiff !== 0 || this.isModemChanged; }
    get draftItemCount() { return Math.abs(this.tvDiff) + Math.abs(this.wifiDiff) + (this.isModemChanged ? 1 : 0); }
    
    // Cost Calculations
    get tvCostImpact() { return this.tvDiff * 15; }
    get wifiCostImpact() { return this.wifiDiff * 10; }
    get modemCostImpact() { return this.isModemChanged ? 15 : 0; }

    get totalCostImpact() { return this.tvCostImpact + this.wifiCostImpact + this.modemCostImpact; }
    
    formatCost(cost) { return cost >= 0 ? `+$${cost}/mo` : `-$${Math.abs(cost)}/mo`; }
    get totalCostImpactStr() { return this.formatCost(this.totalCostImpact); }
    get totalCostImpactClass() { return 'total-impact-green'; }
    
    get tvCostImpactStr() { return this.formatCost(this.tvCostImpact); }
    get wifiCostImpactStr() { return this.formatCost(this.wifiCostImpact); }
    get modemCostImpactStr() { return this.formatCost(this.modemCostImpact); }

    // Visibility Getters
    get isTvInCart() { return this.tvDiff !== 0; }
    get isWifiInCart() { return this.wifiDiff !== 0; }
    get isModemInCart() { return this.isModemChanged; }

    // Draft getters/setters for HTML
    get tvDraft() { return this.tvDiff; }
    get wifiDraft() { return this.wifiDiff; }

    increaseTvDraft() { if (this.tvCurrent < this.tvMax) this.tvCurrent++; }
    decreaseTvDraft() { if (this.tvCurrent > 0) this.tvCurrent--; }
    increaseWifiDraft() { if (this.wifiCurrent < this.wifiMax) this.wifiCurrent++; }
    decreaseWifiDraft() { if (this.wifiCurrent > 0) this.wifiCurrent--; }

    get modemDraftOptions() {
        return this.modemAvailable.map(opt => ({
            label: opt,
            value: opt,
            selected: opt === this.modemCurrent
        }));
    }

    handleModemDraftChange(event) {
        this.modemCurrent = event.target.value;
    }

    get showInterim() { return this.isListening && this.interimTranscript; }
    get voiceBtnClass() { return this.isListening ? 'icon-btn voice-btn listening' : 'icon-btn voice-btn'; }
    get voiceBtnIcon() { return this.isListening ? 'utility:record' : 'utility:unmuted'; }
    get voiceBtnTitle() { return this.isListening ? 'Stop Listening' : 'Voice Input'; }
    get isSendDisabled() { return this.isTyping || (!this.userInput.trim() && !this.template.querySelector('.chat-input')?.value); }

    toggleChat() { this.isChatOpen = !this.isChatOpen; }
    toggleCart() { this.isCartOpen = !this.isCartOpen; }

    // --- Intent Detection ---
    isLikelyFaqQuestion(text) {
        const lower = text.toLowerCase();
        const faqKeywords = ['how', 'what is', 'why', 'troubleshoot', 'reset', 'stock', 'have', 'nearby', 'who has', 'van', 'inventory'];
        return faqKeywords.some(keyword => lower.includes(keyword));
    }

    async handleFaqSend(userText) {
        this.isTyping = true;
        try {
            const resultRaw = await sendFaqToAgent({ userMessage: userText, sessionId: this.sessionId });
            this.isTyping = false;
            let result;
            try {
                result = JSON.parse(resultRaw);
            } catch (e) {
                result = { message: resultRaw }; // Fallback to raw text if not JSON
            }
            let msgText = result.message || 'I couldn\'t find an answer to that.';
            let textLines = msgText.replace(/(?:\r\n|\r|\n)/g, '\n').replace(/(\d+\.\s+[A-Z])/g, '\n$1').split('\n').filter(l => l.trim() !== '');
            if(textLines.length === 0) textLines = [msgText];
            
            this.messages.push({
                id: this.messageIdCounter++,
                text: msgText,
                textLines: textLines,
                isAi: true,
                isFaq: true,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
            this.scrollToBottom();
        } catch (error) {
            this.isTyping = false;
            this.addAiMessage("⚠️ Sorry, I encountered an error communicating with the agent.");
        }
    }

    handleInputChange(event) {
        this.userInput = event.target.value;
    }

    handleInputKeyup(event) {
        if (event.keyCode === 13) {
            this.handleSend();
        }
    }

    addAiMessage(text) {
        let textLines = text.replace(/(?:\r\n|\r|\n)/g, '\n').replace(/(\d+\.\s+[A-Z])/g, '\n$1').split('\n').filter(l => l.trim() !== '');
        if(textLines.length === 0) textLines = [text];

        this.messages.push({
            id: this.messageIdCounter++,
            text: text,
            textLines: textLines,
            isAi: true,
            wrapperClass: 'chat-wrapper ai',
            bubbleClass: 'chat-bubble ai'
        });
        this.scrollToBottom();
    }

    async handleSend() {
        const input = this.template.querySelector('.chat-input');
        let userText = (input && input.value) ? input.value.trim() : this.userInput.trim();
        if (!userText) return;

        this.messages.push({
            id: this.messageIdCounter++,
            text: userText,
            textLines: [userText],
            isAi: false,
            wrapperClass: 'chat-wrapper user',
            bubbleClass: 'chat-bubble user'
        });
        this.scrollToBottom();

        if (input) input.value = '';
        this.userInput = '';

        if (userText === 'Add Receivers') {
            this.currentFlow = 'AddReceivers';
            this.addAiMessage('How many receivers to be added?');
            return;
        }
        if (userText === 'Add Wi-Fi AP') {
            this.currentFlow = 'AddWifiAP';
            this.addAiMessage('How many Wi-Fi access points to be added?');
            return;
        }
        if (userText === 'Change Modem') {
            this.currentFlow = 'ChangeModem';
            let otherTypes = this.modemAvailable.filter(m => m !== this.modemCurrent).join(' or ');
            this.addAiMessage(`Which type would you like to change to? (${otherTypes})`);
            return;
        }
        if (userText === 'Remove Device') {
            this.currentFlow = 'RemoveDevice_Product';
            this.addAiMessage('Which product would you like to remove? (Wi-Fi Access Point or TV Receiver)');
            return;
        }

        if (this.currentFlow === 'AddReceivers') {
            userText = `Add ${userText} TV Receivers`;
            this.currentFlow = null;
        } else if (this.currentFlow === 'AddWifiAP') {
            userText = `Add ${userText} Wi-Fi Access Points`;
            this.currentFlow = null;
        } else if (this.currentFlow === 'ChangeModem') {
            userText = `Change modem to ${userText}`;
            this.currentFlow = null;
        } else if (this.currentFlow === 'RemoveDevice_Product') {
            this.removeProduct = userText;
            this.currentFlow = 'RemoveDevice_Quantity';
            this.addAiMessage('How much quantity?');
            return;
        } else if (this.currentFlow === 'RemoveDevice_Quantity') {
            const quantity = parseInt(userText) || 1;
            this.currentFlow = null;
            
            // Show scanning simulation
            this.isTyping = true;
            setTimeout(() => {
                this.isTyping = false;
                let mockItems = [];
                for(let i=0; i<quantity; i++) {
                    mockItems.push({ id: i, sn: 'SN' + Math.floor(Math.random()*10000000) });
                }

                this.messages.push({
                    id: this.messageIdCounter++,
                    isAi: true,
                    wrapperClass: 'chat-wrapper ai',
                    bubbleClass: 'chat-bubble ai',
                    isScanner: true,
                    scannerItems: mockItems
                });
                this.scrollToBottom();

                setTimeout(() => {
                    this.sendToAgent(`Remove ${quantity} ${this.removeProduct}`);
                }, 2000);
            }, 800);
            return;
        }

        const lower = userText.toLowerCase();
        // --- GUARANTEED DEMO FIX: Intercept Nearby/Peer Questions FIRST ---
        const nearbyKeywords = ['nearby', 'near me', 'near', 'closest', 'nearby technician', 'nearby stock', 'nearby inventory', 'who nearby has', 'nearby available', 'closest technician', 'nearest technician', 'nearby van', 'nearby equipment', 'peer', 'anybody'];
        const isNearbyIntent = nearbyKeywords.some(keyword => lower.includes(keyword));
        if (isNearbyIntent) {
            this.isTyping = true;
            try {
                // Determine if a product is mentioned
                let prod = null;
                if (lower.includes('modem')) {
                    prod = 'Modem';
                } else if (lower.includes('receiver') || lower.includes('tv') || lower.includes('tv reciever')) {
                    prod = 'Receiver';
                } else if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('access point') || lower.includes('wifi access point') || lower.includes('accesspoint') || lower.includes('wifi accesspoint')) {
                    prod = 'Wi-Fi';
                }
                const resultRaw = await findNearbyInventory({ productSearchTerm: prod });
                this.isTyping = false;
                
                let result;
                try {
                    result = JSON.parse(resultRaw);
                } catch(e) {
                    result = { peers: [] };
                }
                
                if (result.peers && result.peers.length > 0) {
                    this.messages.push({
                        id: this.messageIdCounter++,
                        isAi: true,
                        wrapperClass: 'chat-wrapper ai',
                        bubbleClass: 'chat-bubble ai',
                        isNearby: true,
                        peers: result.peers,
                        productMentioned: prod ? true : false,
                        productName: prod
                    });
                } else {
                    this.addAiMessage('No nearby technicians found with this equipment.');
                }
                this.scrollToBottom();
                return;
            } catch (err) {
                // Fall back to agent
            }
        }

        // --- THEN Van Inventory ---
        if (lower.includes('inventory') || lower.includes('stock') || lower.includes('van')) {
            this.isTyping = true;
            try {
                let prod = 'all';
                if (lower.includes('modem')) prod = 'Modem';
                else if (lower.includes('receiver') || lower.includes('tv')) prod = 'Receiver';
                else if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('ap')) prod = 'Wi-Fi';

                const resultRaw = await checkMyInventory({ productSearchTerm: prod });
                this.isTyping = false;
                const result = JSON.parse(resultRaw);
                
                if (result.status === 'SUCCESS' && result.items && result.items.length > 0) {
                    this.messages.push({
                        id: this.messageIdCounter++,
                        isAi: true,
                        wrapperClass: 'chat-wrapper ai',
                        bubbleClass: 'chat-bubble ai',
                        isInventory: true,
                        inventoryItems: result.items
                    });
                } else if (result.status === 'SUCCESS') {
                    // Fallback for singular item backward compatibility
                    this.messages.push({
                        id: this.messageIdCounter++,
                        isAi: true,
                        wrapperClass: 'chat-wrapper ai',
                        bubbleClass: 'chat-bubble ai',
                        isInventory: true,
                        inventoryItems: [{
                            productName: prod !== 'all' ? prod : 'Equipment',
                            quantity: result.quantity,
                            statusText: 'In Stock',
                            statusClass: 'inv-status in-stock',
                            hasStock: true,
                            uom: 'Units'
                        }]
                    });
                } else {
                    this.addAiMessage(result.message || 'I couldn\'t find that in your inventory.');
                }
                this.scrollToBottom();
                return;
            } catch (err) {
                // Fall back to agent
            }
        }

        if (!this.currentFlow && this.isLikelyFaqQuestion(userText)) {
            await this.handleFaqSend(userText);
            return;
        }

        if (lower.includes('summary') || lower.includes('final summary')) {
            this.isTyping = true;
            setTimeout(() => {
                this.isTyping = false;
                this.messages.push({
                    id: this.messageIdCounter++,
                    isAi: true,
                    wrapperClass: 'chat-wrapper ai',
                    bubbleClass: 'chat-bubble ai',
                    isSummary: true,
                    preExisting: [
                        { desc: `TV+ Receiver (Qty ${this.baseTv})`, price: '15.00' },
                        { desc: `${this.baseModem} Modem`, price: '0.00' },
                        { desc: `Wi-Fi Access Point (Qty ${this.baseWifi})`, price: '10.00' }
                    ],
                    changes: this.getDraftChangesList(),
                    totalStr: this.totalCostImpactStr,
                    totalClass: this.totalCostImpactClass
                });
                this.scrollToBottom();
            }, 600);
            return;
        }

        await this.sendToAgent(userText);
    }

    getChatHistoryForAgent() {
        let history = '';
        this.messages.forEach(m => {
            if (m.isSetupIntro || m.isScanner || m.isInventory || m.isNearby || m.isSummary) return;
            let role = m.isAi ? 'Agent' : 'Technician';
            history += `${role}: ${m.text}\n`;
        });
        return history;
    }

    async sendToAgent(userText) {
        this.isTyping = true;
        const currentCart = {
            "TV + Receiver": this.tvCurrent,
            "Modem": this.modemCurrent,
            "Wi-Fi Access Point": this.wifiCurrent,
            "baseTv": this.baseTv,
            "baseWifi": this.baseWifi,
            "baseModem": this.baseModem,
            "consumedTv": Math.max(0, this.baseTv - this.initialBaseTv),
            "consumedWifi": Math.max(0, this.baseWifi - this.initialBaseWifi)
        };

        try {
            const history = this.getChatHistoryForAgent();
            const rawResult = await sendMessageToAgent({
                userMessage: userText,
                cpeItemsJson: this.cpeItems,
                currentCartJson: JSON.stringify(currentCart),
                chatHistory: history
            });
            this.isTyping = false;
            try {
                const parsed = JSON.parse(rawResult);
                this.processAiResponse(parsed);
            } catch (e) {
                this.addAiMessage("⚠️ I received an unexpected response from the agent. Please try again.");
            }
        } catch (error) {
            this.isTyping = false;
            this.addAiMessage("⚠️ Sorry, I'm having trouble connecting to the service.");
        }
    }

    processAiResponse(parsed) {
        if (parsed.error) {
            this.addAiMessage('⚠️ ' + parsed.error);
            return;
        }

        let diffDetected = false;
        if (parsed.stateChanges) {
            parsed.stateChanges.forEach(change => {
                // Update the local "current" state so the UI reflects the change
                if (change.label === 'TV + RECEIVER') {
                    if (this.tvCurrent !== change.newUnits) diffDetected = true;
                    this.tvCurrent = change.newUnits;
                }
                if (change.label === 'WI-FI ACCESS POINT') {
                    if (this.wifiCurrent !== change.newUnits) diffDetected = true;
                    this.wifiCurrent = change.newUnits;
                }
                if (change.label === 'MODEM') {
                    if (this.modemCurrent !== change.newUnits) diffDetected = true;
                    this.modemCurrent = change.newUnits;
                }
            });
        }

        if (diffDetected && parsed.message) {
            // Aggregated configuration card mapping
            const combinedItems = (parsed.stateChanges || []).map(change => {
                const isModem = (change.productCode === 'O_RES_TV_PLUS_MODEM' || change.label === 'MODEM');
                let baseOld = change.label === 'TV + RECEIVER' ? this.baseTv : (change.label === 'WI-FI ACCESS POINT' ? this.baseWifi : this.baseModem);
                let isRemoval = !isModem && (change.newUnits < baseOld);
                let removedQuantity = isRemoval ? (baseOld - change.newUnits) : 0;
                return {
                    ...change,
                    isDevice: !isModem,
                    isModem: isModem,
                    isRemoval: isRemoval,
                    removedQuantity: removedQuantity,
                    label: change.label || (isModem ? 'MODEM' : 'DEVICE'),
                    oldModem: isModem ? this.baseModem : change.oldModem,
                    newModem: change.newUnits || change.newModem || this.modemCurrent,
                    oldUnits: !isModem ? baseOld : change.oldUnits
                };
            });

            let textLines = parsed.message.replace(/(?:\r\n|\r|\n)/g, '\n').replace(/(\d+\.\s+[A-Z])/g, '\n$1').split('\n').filter(l => l.trim() !== '');
            if(textLines.length === 0) textLines = [parsed.message];

            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message,
                textLines: textLines,
                isAi: true,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai',
                isCombinedUpdate: true,
                combinedItems: combinedItems
            });
        } else {
            this.addAiMessage(parsed.message || 'Done.');
        }
        
        if (parsed.quickActions) {
            this.quickActions = parsed.quickActions;
        } else {
            this.quickActions = ['Add Receivers', 'Add Wi-Fi AP', 'Change Modem', 'Remove Device'];
        }
        this.scrollToBottom();
    }

    handleQuickAction(event) {
        const val = event.target.dataset.val;
        this.userInput = val;
        this.handleSend();
    }

    getDraftChangesList() {
        let list = [];
        if (this.tvDiff !== 0) list.push({ desc: `TV+ Receiver (${this.tvDiff > 0 ? '+' : ''}${this.tvDiff})`, priceStr: this.tvCostImpactStr });
        if (this.wifiDiff !== 0) list.push({ desc: `Wi-Fi AP (${this.wifiDiff > 0 ? '+' : ''}${this.wifiDiff})`, priceStr: this.wifiCostImpactStr });
        if (this.isModemChanged) list.push({ desc: `Modem (${this.modemCurrent})`, priceStr: this.modemCostImpactStr });
        return list;
    }

    handleCancelOrder() {
        this.tvCurrent = this.baseTv;
        this.wifiCurrent = this.baseWifi;
        this.modemCurrent = this.baseModem;
        this.addAiMessage('Order cancelled. All draft changes have been reverted.');
    }

    handleConfirmOrder() {
        this.confirmCartOrder();
    }

    @track isSubmitting = false;

    confirmCartOrder() {
        this.isSubmitting = true;
        setTimeout(() => {
            this.isSubmitting = false;
            this.baseTv = this.tvCurrent;
            this.baseWifi = this.wifiCurrent;
            this.baseModem = this.modemCurrent;
            this.isCartOpen = false;
            this.isChatOpen = false;
            
            // Reinitialize chat session
            this.sessionId = 'session-' + Math.random().toString(36).substr(2, 9);
            this.messages = [this.messages[0]];
            this.messages[0].setupItems = [
                { label: `${this.baseTv} TV Receiver${this.baseTv !== 1 ? 's' : ''}` },
                { label: `${this.baseModem} Modem` },
                { label: `${this.baseWifi} Wi-Fi AP${this.baseWifi !== 1 ? 's' : ''}` }
            ];
        }, 1500);
    }

    scrollToBottom() {
        setTimeout(() => {
            const el = this.template.querySelector('.chat-history');
            if (el) el.scrollTop = el.scrollHeight;
        }, 100);
    }

    startVoiceInput() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.addAiMessage("⚠️ Voice recognition is not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.continuous = false;

        recognition.onstart = () => { this.isListening = true; this.interimTranscript = 'Listening...'; };
        recognition.onresult = (event) => {
            let interim = ''; let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) final += transcript;
                else interim += transcript;
            }
            if (interim) this.interimTranscript = interim;
            if (final) {
                const trimmed = final.trim();
                this.userInput = trimmed;
                const inputEl = this.template.querySelector('.chat-input');
                if (inputEl) inputEl.value = trimmed;
            }
        };
        recognition.onerror = (event) => { this._stopRecognition(); this.addAiMessage("⚠️ Voice recognition error: " + event.error); };
        recognition.onend = () => { this._stopRecognition(); };
        this._recognition = recognition;
        recognition.start();
    }

    _stopRecognition() {
        this.isListening = false;
        if (this._recognition) {
            try { this._recognition.stop(); } catch (e) {}
            this._recognition = null;
        }
    }
}
