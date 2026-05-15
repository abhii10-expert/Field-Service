import { LightningElement, track, api } from 'lwc';
import sendMessageToAgent from '@salesforce/apex/CpeAiAssistantController.sendMessageToAgent';
import sendFaqToAgent from '@salesforce/apex/CpeAiAssistantController.sendFaqToAgent';

export default class CpeAiAssistant extends LightningElement {
    @api serviceAppointmentNumber = 'SA-00045721';
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
            text: "👋 I reviewed your current setup. 1 TV Receiver, Wired Modem, 1 Wi-Fi AP. What would you like to update?",
            isAi: true,
            wrapperClass: 'chat-wrapper ai',
            bubbleClass: 'chat-bubble ai'
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

    // Device States
    tvCurrent = 1; tvAvailable = 17; tvMax = 18;
    modemCurrent = 'Wired'; modemAvailable = ['Wi-Fi', 'Customer Provided'];
    wifiCurrent = 1; wifiAvailable = 10; wifiMax = 11;

    get isCartEmpty() { return this.draftOrder.length === 0; }
    get hasDraftChanges() { return this.draftOrder.length > 0; }
    get draftItemCount() { return this.draftOrder.reduce((sum, item) => sum + item.units, 0); }
    
    // Cost Calculations
    get tvCostImpact() { 
        const change = this.draftOrder.find(i => i.productCode === 'O_RES_TV_PLUS_STB' || i.productCode === 'O_RES_TV_PLUS_ADDL_STB');
        return change ? (change.units * 15) : 0;
    }
    get wifiCostImpact() {
        const change = this.draftOrder.find(i => i.productCode === 'O_RES_HSI_WIFI_EXTENDER');
        return change ? (change.units * 10) : 0;
    }
    get modemCostImpact() {
        const change = this.draftOrder.find(i => i.productCode === 'O_RES_HSI_MODEM');
        return change ? 15 : 0; // Flat fee for modem change
    }

    get totalCostImpact() { return this.tvCostImpact + this.wifiCostImpact + this.modemCostImpact; }
    
    get totalCostImpactStr() { return this.totalCostImpact >= 0 ? `+$${this.totalCostImpact}/mo` : `-$${Math.abs(this.totalCostImpact)}/mo`; }
    get totalCostImpactClass() { return this.totalCostImpact >= 0 ? 'impact-value positive' : 'impact-value negative'; }
    
    get tvCostImpactStr() { return `+$${this.tvCostImpact}/mo`; }
    get wifiCostImpactStr() { return `+$${this.wifiCostImpact}/mo`; }
    get modemCostImpactStr() { return `+$${this.modemCostImpact}/mo`; }

    // Visibility Getters
    get isTvInCart() { return this.draftOrder.some(i => i.productCode.includes('TV')); }
    get isWifiInCart() { return this.draftOrder.some(i => i.productCode.includes('WIFI')); }
    get isModemInCart() { return this.draftOrder.some(i => i.productCode.includes('MODEM')); }

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
            this.addAiMessage(result.message || 'I couldn\'t find an answer to that.');
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
        this.messages.push({
            id: this.messageIdCounter++,
            text: text,
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
            isAi: false,
            wrapperClass: 'chat-wrapper user',
            bubbleClass: 'chat-bubble user'
        });
        this.scrollToBottom();

        if (input) input.value = '';
        this.userInput = '';
        this.quickActions = [];

        if (!this.currentFlow && this.isLikelyFaqQuestion(userText)) {
            await this.handleFaqSend(userText);
            return;
        }

        this.isTyping = true;
        try {
            const rawResult = await sendMessageToAgent({
                userMessage: userText,
                cpeItemsJson: this.cpeItems,
                serviceAppointmentNumber: this.serviceAppointmentNumber
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
                const existingIndex = this.draftOrder.findIndex(item => item.productCode === change.productCode);
                if (existingIndex !== -1) {
                    this.draftOrder[existingIndex].units = change.units;
                    diffDetected = true;
                } else if (change.units > 0) {
                    this.draftOrder.push(change);
                    diffDetected = true;
                }
            });
        }

        if (diffDetected && parsed.message) {
            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message,
                isAi: true,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai',
                isStateChange: true,
                changes: parsed.stateChanges
            });
        } else {
            this.addAiMessage(parsed.message || 'Done.');
        }
        
        if (parsed.quickActions) {
            this.quickActions = parsed.quickActions;
        }
        this.scrollToBottom();
    }

    handleQuickAction(event) {
        const val = event.target.dataset.val;
        this.userInput = val;
        this.handleSend();
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