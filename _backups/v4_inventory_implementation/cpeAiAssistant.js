import { LightningElement, track, api } from 'lwc';
import sendMessageToAgent from '@salesforce/apex/CpeAiAssistantController.sendMessageToAgent';
import sendFaqToAgent from '@salesforce/apex/CpeAiAssistantController.sendFaqToAgent';
import checkMyInventory from '@salesforce/apex/CpeAiAssistantController.checkMyInventory';
import findNearbyInventory from '@salesforce/apex/CpeAiAssistantController.findNearbyInventory';
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
      "action": "Add",
      "itemType": "lineItem",
      "maxQuantity": 1,
      "minQuantity": 1,
      "defaultQuantity": 1,
      "ProductCode": "O_RES_HSI_INCL_ACCESS_POINT"
    },
    {
      "action": "Add",
      "itemType": "lineItem",
      "maxQuantity": 10,
      "minQuantity": 0,
      "defaultQuantity": 0,
      "ProductCode": "O_RES_HSI_ADDL_ACCESS_POINT"
    }
  ]
}`;

    // Default Fallback CPE Menu Data (Used if JSON does not contain current quantities)
    @track tvCurrent = 0;
    @track tvAvailable = 3;
    @track tvMaxIncluded = 3;
    @track tvMaxAdditional = 15;
    @track tvMax = 18;
    @track tvMin = 1;

    @track modemCurrent = 'Wired';
    modemAvailable = ['Wi-Fi', 'Customer Provided'];

    @track wifiCurrent = 0;
    @track wifiAvailable = 1;
    @track wifiMaxIncluded = 1;
    @track wifiMaxAdditional = 10;
    @track wifiMax = 11;
    @track wifiMin = 1;

    @track isNewCustomer = false;
    @track hasModem = false;

    @track isChatOpen = false;
    @track isCartOpen = false;

    @track tvDraft = 0;
    @track wifiDraft = 0;
    @track modemDraft = 'Wired';

    get canAddTv() { return this.tvAvailable > 0; }
    get canAddWifi() { return this.wifiAvailable > 0; }

    get tvAvailableDraft() { return Math.max(0, this.tvMax - this.tvDraft); }
    get wifiAvailableDraft() { return Math.max(0, this.wifiMax - this.wifiDraft); }

    // Modem chip options for screenshot-style card
    get modemChipOptions() {
        const allOptions = ['Wi-Fi', 'Wired', 'Customer Provided'];
        const shortLabels = { 'Customer Provided': 'Own' };
        return allOptions.map(opt => {
            const isActive = this.modemCurrent === opt;
            return {
                label: (shortLabels[opt] || opt) + (isActive ? ' ✓' : ''),
                chipClass: 'modem-chip ' + (isActive ? 'modem-chip-active' : 'modem-chip-default')
            };
        });
    }

    toggleChat() {
        this.isChatOpen = !this.isChatOpen;
        if (this.isChatOpen) {
            this.scrollToBottom();
        }
    }

    toggleCart() {
        this.isCartOpen = !this.isCartOpen;
    }

    get hasDraftChanges() {
        return this.draftItemCount > 0;
    }

    get isTvInCart() { return this.tvDraft !== this.tvCurrent; }
    get isWifiInCart() { return this.wifiDraft !== this.wifiCurrent; }
    get isModemInCart() { return this.modemDraft !== this.modemCurrent; }

    get draftItemCount() {
        let count = 0;
        if (this.isTvInCart) count++;
        if (this.isWifiInCart) count++;
        if (this.isModemInCart) count++;
        return count;
    }

    get tvCostImpactStr() {
        const cost = this.calculateTvCost(this.tvDraft, this.tvCurrent);
        return cost >= 0 ? `+$${cost.toFixed(2)}` : `-$${Math.abs(cost).toFixed(2)}`;
    }

    get wifiCostImpactStr() {
        const cost = this.calculateWifiCost(this.wifiDraft, this.wifiCurrent);
        return cost >= 0 ? `+$${cost.toFixed(2)}` : `-$${Math.abs(cost).toFixed(2)}`;
    }

    get modemCostImpactStr() {
        const oldCost = (this.modemCurrent === 'Wi-Fi') ? 10 : ((this.modemCurrent === 'Wired') ? 5 : 0);
        const newCost = (this.modemDraft === 'Wi-Fi') ? 10 : ((this.modemDraft === 'Wired') ? 5 : 0);
        const diff = newCost - oldCost;
        return diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
    }

    get totalCostImpactStr() {
        const cost1 = this.calculateTvCost(this.tvDraft, this.tvCurrent);
        const cost2 = this.calculateWifiCost(this.wifiDraft, this.wifiCurrent);
        const oldModemCost = (this.modemCurrent === 'Wi-Fi') ? 10 : ((this.modemCurrent === 'Wired') ? 5 : 0);
        const newModemCost = (this.modemDraft === 'Wi-Fi') ? 10 : ((this.modemDraft === 'Wired') ? 5 : 0);
        const total = cost1 + cost2 + (newModemCost - oldModemCost);
        return total >= 0 ? `+$${total.toFixed(2)}` : `-$${Math.abs(total).toFixed(2)}`;
    }

    get totalCostImpactClass() {
        return 'total-positive';
    }

    get modemDraftOptions() {
        return this.modemAvailable.map(opt => ({
            label: opt,
            value: opt,
            selected: opt === this.modemDraft
        }));
    }

    increaseTvDraft() {
        if (this.tvDraft < this.tvMax) this.tvDraft++;
        this.updateCurrentInventory();
    }
    decreaseTvDraft() {
        if (this.tvDraft > 0) this.tvDraft--;
        this.updateCurrentInventory();
    }

    increaseWifiDraft() {
        if (this.wifiDraft < this.wifiMax) this.wifiDraft++;
        this.updateCurrentInventory();
    }
    decreaseWifiDraft() {
        if (this.wifiDraft > 0) this.wifiDraft--;
        this.updateCurrentInventory();
    }

    handleModemDraftChange(event) {
        this.modemDraft = event.target.value;
        this.updateCurrentInventory();
    }

    confirmCartOrder() {
        const tvDiff = this.tvDraft - this.tvCurrent;
        if (tvDiff !== 0) {
            const cost = this.calculateTvCost(this.tvDraft, this.tvCurrent);
            this.additionalChanges.push({ desc: `${tvDiff > 0 ? '+' : ''}${tvDiff} TV Receivers`, price: cost });
        }
        
        const wifiDiff = this.wifiDraft - this.wifiCurrent;
        if (wifiDiff !== 0) {
            const cost = this.calculateWifiCost(this.wifiDraft, this.wifiCurrent);
            this.additionalChanges.push({ desc: `${wifiDiff > 0 ? '+' : ''}${wifiDiff} Access Points`, price: cost });
        }

        if (this.modemDraft !== this.modemCurrent) {
            const oldCost = (this.modemCurrent === 'Wi-Fi') ? 10 : ((this.modemCurrent === 'Wired') ? 5 : 0);
            const newCost = (this.modemDraft === 'Wi-Fi') ? 10 : ((this.modemDraft === 'Wired') ? 5 : 0);
            this.additionalChanges.push({ desc: `Modem Change (${this.modemDraft})`, price: newCost - oldCost });
        }

        this.tvCurrent = this.tvDraft;
        this.wifiCurrent = this.wifiDraft;
        this.modemCurrent = this.modemDraft;
        
        this.tvAvailable = Math.max(0, this.tvMax - this.tvCurrent);
        this.wifiAvailable = Math.max(0, this.wifiMax - this.wifiCurrent);
        
        this.isCartOpen = false;
        this.isChatOpen = true; // Open chat to show summary
        this.showFinalSummary();
    }

    updateCurrentInventory() {
        this.currentInventory = {
            "TV + Receiver": this.tvDraft,
            "Modem": this.modemDraft || "None",
            "Wi-Fi Access Point": this.wifiDraft
        };
    }

    extractNumber(text) {
        const wordToNum = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 };
        const match = text.toLowerCase().match(/\d+/);
        if (match) return parseInt(match[0], 10);
        for (const [word, num] of Object.entries(wordToNum)) {
            if (text.toLowerCase().includes(word)) return num;
        }
        return null;
    }

    getDynamicQuickActions() {
        let actions = [];
        if (this.tvAvailableDraft > 0) actions.push('Add Receivers');
        if (this.wifiAvailableDraft > 0) actions.push('Add Wi-Fi AP');
        if (this.hasModem) {
            if (this.isNewCustomer && !this.modemDraft) {
                actions.push('Add Modem');
            } else {
                actions.push('Change Modem');
            }
        }
        if (this.tvDraft > 0 || this.wifiDraft > 0) actions.push('Remove Device');
        return actions.length > 0 ? actions : ['Show Summary'];
    }

    calculateTvCost(newQuantity, oldQuantity) {
        // Assume 1 TV is included for free
        const oldCost = Math.max(0, oldQuantity - 1) * 9;
        const newCost = Math.max(0, newQuantity - 1) * 9;
        return newCost - oldCost;
    }

    calculateWifiCost(newQuantity, oldQuantity) {
        // Assume 1 AP is included for free
        const oldCost = Math.max(0, oldQuantity - 1) * 5;
        const newCost = Math.max(0, newQuantity - 1) * 5;
        return newCost - oldCost;
    }

    // Chat Data
    @track messages = [];
    @track quickActions = [];
    @track isTyping = false;
    userInput = '';
    messageIdCounter = 1;
    sessionId;

    // FAQ Mode
    @track isFaqMode = false;
    faqSessionId = null;
    @track currentInventory = { "TV + Receiver": 1, Modem: 1, "Wi-Fi Access Point": 0 };

    // Voice Input State
    @track isListening = false;
    @track interimTranscript = 'Listening...';
    voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    _recognition = null;

    get voiceBtnClass() {
        return this.isListening
            ? 'icon-btn voice-btn voice-btn--listening'
            : 'icon-btn voice-btn';
    }

    get voiceBtnIcon() {
        return this.isListening ? 'utility:stop' : 'utility:mic';
    }

    get voiceBtnTitle() {
        if (!this.voiceSupported) return 'Voice input not supported on this browser';
        return this.isListening ? 'Stop listening' : 'Voice input';
    }

    // Work Order State
    preExistingWorkOrder = [
        { desc: 'Initial Service Call', price: 0 }
    ];
    @track additionalChanges = [];

    // State Machine
    currentFlow = null; // 'ADD_TV', 'CHANGE_MODEM', 'REMOVE_AP'

    connectedCallback() {
        this.parseCpeItems();
        this.addSetupIntroMessage();
    }

    addSetupIntroMessage() {
        let setupItems = [];
        if (this.tvCurrent > 0) {
            setupItems.push({ label: `${this.tvCurrent} TV Receiver${this.tvCurrent > 1 ? 's' : ''}` });
        }
        if (this.modemCurrent) {
            setupItems.push({ label: `${this.modemCurrent} Modem` });
        }
        if (this.wifiCurrent > 0) {
            setupItems.push({ label: `${this.wifiCurrent} Wi-Fi AP${this.wifiCurrent > 1 ? 's' : ''}` });
        }

        if (this.isNewCustomer || setupItems.length === 0) {
            this.addAiMessage("👋 Welcome! This is a new installation. Let's get your home set up with the right equipment.");
        } else {
            this.messages.push({
                id: this.messageIdCounter++,
                text: "👋 I reviewed your current setup.",
                isAi: true,
                isSetupIntro: true,
                setupItems: setupItems,
                ctaText: "What would you like to update?",
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
            this.scrollToBottom();
        }
        // Restore equipment quick actions after intro
        this.quickActions = this.getDynamicQuickActions();
    }

    parseCpeItems() {
        if (!this.cpeItems) return;
        
        try {
            let itemsObj = typeof this.cpeItems === 'string' ? JSON.parse(this.cpeItems) : this.cpeItems;
            let items = itemsObj.CpeItems || itemsObj;
            
            if (!Array.isArray(items)) return;

            let parsedTvMaxIncluded = 0;
            let parsedTvMaxAdditional = 0;
            let parsedWifiMaxIncluded = 0;
            let parsedWifiMaxAdditional = 0;
            let parsedTvMinIncluded = 0;
            let parsedWifiMinIncluded = 0;
            let tvExistingQty = 0;
            let wifiExistingQty = 0;
            let allAdd = true;
            
            const parseItem = (item) => {
                let code = item.ProductCode;
                if (!code && item.Product2) code = item.Product2.ProductCode;
                if (!code && item.PricebookEntry && item.PricebookEntry.Product2) code = item.PricebookEntry.Product2.ProductCode;
                if (!code && item.PricebookEntry) code = item.PricebookEntry.ProductCode;
                
                if (item.action && item.action !== 'Add') allAdd = false;
                if (!item.action) allAdd = false;

                let qty = 0;
                if (typeof item.Quantity === 'number') {
                    qty = item.Quantity;
                } else if (item.Quantity && typeof item.Quantity.value === 'number') {
                    qty = item.Quantity.value;
                } else if (item.vlocity_cmt__Quantity__c && typeof item.vlocity_cmt__Quantity__c === 'number') {
                    qty = item.vlocity_cmt__Quantity__c;
                } else if (typeof item.defaultQuantity === 'number') {
                    qty = item.defaultQuantity;
                }

                if (code === 'O_RES_HSI_MODEM') {
                    this.hasModem = true;
                }

                if (code === 'O_RES_TV_PLUS_STB') {
                    if (item.maxQuantity) parsedTvMaxIncluded = item.maxQuantity;
                    parsedTvMinIncluded = (item.minQuantity > 0) ? item.minQuantity : (item.defaultQuantity || 1);
                    tvExistingQty += qty;
                }
                if (code === 'O_RES_TV_PLUS_ADDL_STB') {
                    if (item.maxQuantity) parsedTvMaxAdditional = item.maxQuantity;
                    tvExistingQty += qty;
                }
                
                if (code === 'O_RES_HSI_INCL_ACCESS_POINT') {
                    if (item.maxQuantity) parsedWifiMaxIncluded = item.maxQuantity;
                    parsedWifiMinIncluded = (item.minQuantity > 0) ? item.minQuantity : (item.defaultQuantity || 1);
                    wifiExistingQty += qty;
                }
                if (code === 'O_RES_HSI_ADDL_ACCESS_POINT') {
                    if (item.maxQuantity) parsedWifiMaxAdditional = item.maxQuantity;
                    wifiExistingQty += qty;
                }

                // Recursively parse child records if they exist
                if (item.childProducts && item.childProducts.records) {
                    item.childProducts.records.forEach(parseItem);
                }
            };
            
            items.forEach(parseItem);
            
            // If all actions are "Add", it's a new install
            this.isNewCustomer = allAdd;
            
            if (this.isNewCustomer) {
                this.modemCurrent = null;
                this.modemAvailable = ['Wi-Fi', 'Wired', 'Customer Provided'];
            } else {
                this.modemCurrent = 'Wired';
                this.modemAvailable = ['Wi-Fi', 'Customer Provided'];
            }

            this.quickActions = this.getDynamicQuickActions();

            if (parsedTvMaxIncluded > 0 || parsedTvMaxAdditional > 0) {
                this.tvMaxIncluded = parsedTvMaxIncluded || 3;
                this.tvMaxAdditional = parsedTvMaxAdditional || 15;
                this.tvMax = this.tvMaxIncluded + this.tvMaxAdditional;
                this.tvMin = parsedTvMinIncluded || 1;
                
                this.tvCurrent = this.isNewCustomer ? 0 : tvExistingQty;
                this.tvDraft = this.tvCurrent;
                this.tvAvailable = Math.max(0, this.tvMax - this.tvCurrent);
            }
            if (parsedWifiMaxIncluded > 0 || parsedWifiMaxAdditional > 0) {
                this.wifiMaxIncluded = parsedWifiMaxIncluded || 1;
                this.wifiMaxAdditional = parsedWifiMaxAdditional || 10;
                this.wifiMax = this.wifiMaxIncluded + this.wifiMaxAdditional;
                this.wifiMin = parsedWifiMinIncluded || 1;
                
                this.wifiCurrent = this.isNewCustomer ? 0 : wifiExistingQty;
                this.wifiDraft = this.wifiCurrent;
                this.wifiAvailable = Math.max(0, this.wifiMax - this.wifiCurrent);
            }
            
            this.modemDraft = this.modemCurrent;

            // Sync currentInventory with the parsed values
            this.updateCurrentInventory();
            
        } catch(e) {
            console.error('Error parsing cpeItems JSON:', e);
        }
    }

    get isSendDisabled() {
        return this.isTyping || this.userInput.trim() === '';
    }

    handleInputChange(event) {
        this.userInput = event.target.value;
    }

    handleInputKeyup(event) {
        if (event.key === 'Enter' && !this.isSendDisabled) {
            this.handleSend();
        }
    }

    handleQuickAction(event) {
        const actionText = event.target.dataset.val;
        const inputEl = this.template.querySelector('.chat-input');
        if (inputEl) inputEl.value = actionText;
        this.userInput = actionText;
        this.handleSend();
    }

    async handleFaqSend(userText) {
        this.isTyping = true;
        try {
            const rawResult = await sendFaqToAgent({
                userMessage: userText,
                sessionId: ''
            });
            this.isTyping = false;

            try {
                const parsed = JSON.parse(rawResult);
                if (parsed.error) {
                    this.addAiMessage('⚠️ ' + parsed.error);
                } else if (parsed.message) {
                    this.addAiMessage(parsed.message);
                } else {
                    this.addAiMessage('No answer received. Please try rephrasing your question.');
                }
            } catch (e) {
                this.addAiMessage(rawResult || 'No response received.');
            }
            // Always restore equipment quick actions after an FAQ answer
            this.quickActions = this.getDynamicQuickActions();
        } catch (error) {
            this.isTyping = false;
            this.addAiMessage('Sorry, could not reach the FAQ agent: ' + (error?.body?.message || error?.message || 'Unknown error'));
            this.quickActions = this.getDynamicQuickActions();
        }
    }

    // ─── FAQ Intent Detection ───────────────────────────────────────────────────
    // Returns true when a message looks like a general knowledge/troubleshooting
    // question rather than an equipment change command.
    isLikelyFaqQuestion(text) {
        const t = text.toLowerCase().trim();

        // Clear equipment action patterns → NOT a FAQ
        const equipmentActionPatterns = [
            /^(add|remove|set|change|switch|update)\s+\d*\s*(tv|receiver|stb|modem|wifi|wi-fi|ap|access\s*point)/i,
            /^\d+\s*(tv|receiver|wifi|wi-fi|ap|access\s*point)/i,
            /^(add receivers|add tv|add wi-fi|add ap|change modem|remove devices|show summary)$/i
        ];
        if (equipmentActionPatterns.some(p => p.test(t))) return false;

        // Question starters → likely FAQ
        const questionStarters = [
            'how', 'why', 'what', 'when', 'where', 'who', 'which',
            'can you', 'could you', 'should', 'is there', 'are there',
            'does', 'do i', 'do you', 'will', 'tell me', 'explain'
        ];
        if (questionStarters.some(q => t.startsWith(q))) return true;

        // Ends with a question mark → FAQ
        if (t.endsWith('?')) return true;

        // Troubleshooting / knowledge keywords → FAQ
        const faqKeywords = [
            'reset', 'restart', 'reboot', 'blinking', 'blink', 'flashing',
            'light', 'led', 'error', 'issue', 'problem', 'troubleshoot',
            'fix', 'broken', 'not working', 'offline', 'slow', 'help',
            'steps', 'procedure', 'guide', 'manual', 'difference', 'mean',
            'indicate', 'signal', 'connect', 'connection', 'speed', 'range',
            'warranty', 'replace', 'install', 'configure', 'compatible'
        ];
        if (faqKeywords.some(k => t.includes(k))) return true;

        return false;
    }

    async handleSend() {
        const input = this.template.querySelector('.chat-input');
        let userText = (input && input.value) ? input.value.trim() : this.userInput.trim();
        if (!userText) return;

        // Add user message to chat UI
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

        this.quickActions = []; // Hide quick actions while processing

        // ── Auto-detect FAQ questions and route to Agentforce agent ───────────────
        // Fully automatic — no mode buttons needed
        if (!this.currentFlow && this.isLikelyFaqQuestion(userText)) {
            await this.handleFaqSend(userText);
            return;
        }

        // --- LOCAL STATE MACHINE INTERCEPTION & CONTEXT BUILDING ---
        let t = userText.toLowerCase();

        // 1. Handling "Anything Else" Loop
        if (this.currentFlow === 'ANYTHING_ELSE') {
            if (t === 'no' || t.includes('no ') || t.includes('summary')) {
                this.showFinalSummary();
                this.currentFlow = null;
                return;
            } else if (t === 'yes' || t.includes('yes ')) {
                this.addAiMessage("What else would you like to do?");
                this.quickActions = this.getDynamicQuickActions();
                this.currentFlow = null;
                return;
            }
            this.currentFlow = null;
        }

        // 2. Handling multi-turn "Add Receivers" flow
        if (this.currentFlow === 'ADD_TV') {
            const amount = this.extractNumber(userText) || 1;
            userText = `Add ${amount} TV Receivers`; // Build full context for AI
            this.currentFlow = null;
        } else if (t === 'add receivers' || t === 'add tv') {
            this.currentFlow = 'ADD_TV';
            this.addAiMessage("How many TV receivers would you like to add?");
            this.quickActions = ['1', '2', '3'];
            return;
        }

        // 3. Handling multi-turn "Add Wi-Fi" flow
        if (this.currentFlow === 'ADD_WIFI') {
            const amount = this.extractNumber(userText) || 1;
            userText = `Add ${amount} Wi-Fi Access Points`; // Build full context for AI
            this.currentFlow = null;
        } else if (t === 'add wi-fi' || t === 'add ap') {
            this.currentFlow = 'ADD_WIFI';
            this.addAiMessage("How many Wi-Fi Access Points would you like to add?");
            this.quickActions = ['1', '2'];
            return;
        }

        // 4. Handling multi-turn "Change Modem" flow
        if (this.currentFlow === 'CHANGE_MODEM') {
            userText = `Change Modem to ${userText}`; // Build full context for AI
            this.currentFlow = null;
        } else if (t === 'change modem') {
            if (!this.hasModem) {
                this.addAiMessage("You don't have a modem to change.");
                this.askAnythingElse();
                return;
            }
            this.currentFlow = 'CHANGE_MODEM';
            this.addAiMessage("What type of modem would you like to change to?");
            this.quickActions = this.modemAvailable;
            return;
        }

        // 5. Handling multi-turn "Remove Devices" flow
        if (this.currentFlow === 'REMOVE_DEVICE_TYPE') {
            if (t.includes('tv') || t.includes('receiver')) {
                this.currentFlow = 'REMOVE_TV_COUNT';
                this.addAiMessage("How many TV Receivers would you like to remove?");
                this.quickActions = ['1', '2', '3'];
                return;
            } else if (t.includes('wi-fi') || t.includes('ap')) {
                this.currentFlow = 'REMOVE_AP_COUNT';
                this.addAiMessage("How many Wi-Fi Access Points would you like to remove?");
                this.quickActions = ['1', '2'];
                return;
            }
            this.currentFlow = null;
        } else if (this.currentFlow === 'REMOVE_TV_COUNT') {
            const amount = this.extractNumber(userText) || 1;
            userText = `Remove ${amount} TV Receivers`;
            this.currentFlow = null;
        } else if (this.currentFlow === 'REMOVE_AP_COUNT') {
            const amount = this.extractNumber(userText) || 1;
            userText = `Remove ${amount} Wi-Fi Access Points`;
            this.currentFlow = null;
        } else if (t === 'remove devices') {
            this.currentFlow = 'REMOVE_DEVICE_TYPE';
            this.addAiMessage("Which device would you like to remove?");
            let removeActions = [];
            if (this.tvDraft > 0) removeActions.push('TV Receiver');
            if (this.wifiDraft > 0) removeActions.push('Wi-Fi AP');
            this.quickActions = removeActions.length ? removeActions : ['None'];
            return;
        }

        // --- END LOCAL INTERCEPTION ---

        this.isTyping = true;
        const cartJson = JSON.stringify(this.currentInventory);

        try {
            const rawResult = await sendMessageToAgent({
                userMessage: userText,
                cpeItemsJson: typeof this.cpeItems === 'string' ? this.cpeItems : JSON.stringify(this.cpeItems),
                currentCartJson: cartJson
            });

            this.isTyping = false;
            this.handleAgentResponse(rawResult || '');
        } catch (error) {
            console.error('Agentforce error stringified:', JSON.stringify(error, null, 2));
            console.error('Agentforce error direct:', error);
            if (error && error.body && error.body.message) {
                console.error('Apex Error Message:', error.body.message);
            }
            this.isTyping = false;
            this.addAiMessage('Sorry, there was an error connecting to Agentforce: ' + (error?.body?.message || error?.message || 'Unknown error. Check browser console.'));
        }
    }

    handleAgentResponse(raw) {
        try {
            // Check if Agentforce wrapped it in its standard {"type":"Text","value":"..."} format
            let textValue = raw;
            const initialParse = JSON.parse(raw);
            if (initialParse && initialParse.type === 'Text') {
                textValue = initialParse.value;
            } else if (initialParse && initialParse.newState) {
                textValue = raw; 
            }

            // Attempt to parse the actual JSON payload
            try {
                const parsed = JSON.parse(textValue);
                if (parsed && parsed.newState) {
                    this.processStateChange(parsed);
                    return;
                } else if (parsed && parsed.error) {
                    throw new Error(parsed.error);
                } else if (parsed && parsed.message) {
                    this.addAiMessage(parsed.message);
                    this.handleConversationalQuickActions(parsed.message);
                    return;
                }
            } catch(e) {
                // If it's not JSON, it's just conversational text from the agent
                this.addAiMessage(textValue);
                this.handleConversationalQuickActions(textValue);
                return;
            }
        } catch (e) {
            // raw was not JSON at all
            this.addAiMessage(raw || 'No response from Agent.');
            this.handleConversationalQuickActions(raw || '');
        }
    }

    processStateChange(parsed) {
        const oldTv = this.tvDraft;
        const oldWifi = this.wifiDraft;
        const oldModem = this.modemDraft;

        // Keep the payload state updated
        this.currentInventory = parsed.newState;
        const newTv = parsed.newState["TV + Receiver"] !== undefined ? parsed.newState["TV + Receiver"] : (parsed.newState.TV !== undefined ? parsed.newState.TV : this.tvDraft);
        const newWifi = parsed.newState["Wi-Fi Access Point"] !== undefined ? parsed.newState["Wi-Fi Access Point"] : (parsed.newState.Wifi !== undefined ? parsed.newState.Wifi : this.wifiDraft);
        const newModem = parsed.newState.Modem !== undefined ? parsed.newState.Modem : this.modemDraft;

        let diffDetected = false;

        // =====================================================================
        // WAY 1: Individual Success Messages (Original)
        // Each product change (TV, Wi-Fi, Modem) gets its own separate chat
        // bubble card pushed to the messages array one at a time.
        // =====================================================================

        /*
        // Check TV changes
        if (newTv > oldTv) {
            diffDetected = true;
            const amount = newTv - oldTv;
            const cost = this.calculateTvCost(newTv, oldTv);
            this.tvDraft = newTv;
            let chargeText = cost === 0 ? "No additional charge" : `+$${cost.toFixed(2)}`;
            
            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message || `Sure — ${amount} TV+ Receiver(s) drafted.`,
                isAi: true,
                isDeviceUpdate: true,
                oldUnits: oldTv,
                newUnits: this.tvDraft,
                availableUnits: this.tvAvailableDraft,
                chargeImpact: chargeText,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
            parsed.message = null; // Clear so it doesn't repeat on subsequent cards
        } else if (newTv < oldTv) {
            diffDetected = true;
            const amount = oldTv - newTv;
            this.triggerScanner(amount, 'TV', parsed);
            return; // triggerScanner handles the removal summary and askAnythingElse
        }

        // Check Wi-Fi changes
        if (newWifi > oldWifi) {
            diffDetected = true;
            const amount = newWifi - oldWifi;
            const cost = this.calculateWifiCost(newWifi, oldWifi);
            this.wifiDraft = newWifi;
            let chargeText = cost === 0 ? "No additional charge" : `+$${cost.toFixed(2)}`;
            
            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message || `Sure — ${amount} Wi-Fi AP(s) drafted.`,
                isAi: true,
                isDeviceUpdate: true,
                oldUnits: oldWifi,
                newUnits: this.wifiDraft,
                availableUnits: this.wifiAvailableDraft,
                chargeImpact: chargeText,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
            parsed.message = null;
        } else if (newWifi < oldWifi) {
            diffDetected = true;
            const amount = oldWifi - newWifi;
            this.triggerScanner(amount, 'WIFI', parsed);
            return; // triggerScanner handles the removal summary and askAnythingElse
        }

        // Check Modem changes
        if (newModem !== oldModem && newModem !== 1 && newModem !== "1") {
            diffDetected = true;
            this.modemDraft = newModem;
            let cost = (newModem === 'Wi-Fi') ? 10 : ((newModem === 'Wired') ? 5 : 0);
            let oldCost = (oldModem === 'Wi-Fi') ? 10 : ((oldModem === 'Wired') ? 5 : 0);
            let diffCost = cost - oldCost;
            let chargeText = diffCost === 0 ? "No additional charge" : (diffCost > 0 ? `+$${diffCost.toFixed(2)}` : `-$${Math.abs(diffCost).toFixed(2)}`);
            
            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message || `Sure — Modem drafted to ${newModem}.`,
                isAi: true,
                isModemUpdate: true,
                oldModem: oldModem || 'None',
                newModem: newModem,
                chargeImpact: chargeText,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
            parsed.message = null;
        }

        if (!diffDetected) {
            // General success or failure message without state change
            this.addAiMessage(parsed.message || 'Done.');
        }

        this.scrollToBottom();
        this.askAnythingElse();
        */

        // =====================================================================
        // WAY 2: Combined Single Success Message (New)
        // All product changes detected from a single agent response are
        // collected into one array and pushed as a single combined chat bubble.
        // =====================================================================

        let combinedItems = []; // Holds all change details for the combined card

        // --- Collect TV changes ---
        if (newTv > oldTv) {
            diffDetected = true;
            const amount = newTv - oldTv;
            const cost = this.calculateTvCost(newTv, oldTv);
            this.tvDraft = newTv;
            combinedItems.push({
                type: 'device',
                isDevice: true,
                isModem: false,
                label: 'TV+ Receiver',
                oldUnits: oldTv,
                newUnits: this.tvDraft,
                availableUnits: this.tvAvailableDraft,
                chargeImpact: cost === 0 ? 'No additional charge' : `+$${cost.toFixed(2)}`
            });
        } else if (newTv < oldTv) {
            diffDetected = true;
            const amount = oldTv - newTv;
            // Removal still goes through triggerScanner (scanner UI is a separate flow)
            this.triggerScanner(amount, 'TV', parsed);
            return;
        }

        // --- Collect Wi-Fi changes ---
        if (newWifi > oldWifi) {
            diffDetected = true;
            const amount = newWifi - oldWifi;
            const cost = this.calculateWifiCost(newWifi, oldWifi);
            this.wifiDraft = newWifi;
            combinedItems.push({
                type: 'device',
                isDevice: true,
                isModem: false,
                label: 'Wi-Fi Access Point',
                oldUnits: oldWifi,
                newUnits: this.wifiDraft,
                availableUnits: this.wifiAvailableDraft,
                chargeImpact: cost === 0 ? 'No additional charge' : `+$${cost.toFixed(2)}`
            });
        } else if (newWifi < oldWifi) {
            diffDetected = true;
            const amount = oldWifi - newWifi;
            this.triggerScanner(amount, 'WIFI', parsed);
            return;
        }

        // --- Collect Modem changes ---
        if (newModem !== oldModem && newModem !== 1 && newModem !== "1") {
            diffDetected = true;
            this.modemDraft = newModem;
            const cost = (newModem === 'Wi-Fi') ? 10 : ((newModem === 'Wired') ? 5 : 0);
            const oldCost = (oldModem === 'Wi-Fi') ? 10 : ((oldModem === 'Wired') ? 5 : 0);
            const diffCost = cost - oldCost;
            combinedItems.push({
                type: 'modem',
                isDevice: false,
                isModem: true,
                label: 'Modem',
                oldModem: oldModem || 'None',
                newModem: newModem,
                chargeImpact: diffCost === 0 ? 'No additional charge' : (diffCost > 0 ? `+$${diffCost.toFixed(2)}` : `-$${Math.abs(diffCost).toFixed(2)}`)
            });
        }

        // --- Push a single combined message card if any changes were detected ---
        if (diffDetected && combinedItems.length > 0) {
            this.messages.push({
                id: this.messageIdCounter++,
                text: parsed.message || `✅ ${combinedItems.length} change${combinedItems.length > 1 ? 's' : ''} drafted successfully.`,
                isAi: true,
                isCombinedUpdate: true,
                combinedItems: combinedItems,
                wrapperClass: 'chat-wrapper ai',
                bubbleClass: 'chat-bubble ai'
            });
        } else if (!diffDetected) {
            // General success or failure message without state change
            this.addAiMessage(parsed.message || 'Done.');
        }

        this.scrollToBottom();
        this.askAnythingElse();
    }

    handleConversationalQuickActions(text) {
        let t = text.toLowerCase();
        if (t.includes('how many')) {
            if (t.includes('tv') || t.includes('receiver')) {
                let actions = [];
                for(let i=1; i<=Math.min(3, this.tvAvailableDraft || 3); i++) actions.push(i.toString());
                this.quickActions = actions.length ? actions : ['1', '2', '3'];
            } else if (t.includes('wi-fi') || t.includes('ap') || t.includes('access point')) {
                let actions = [];
                for(let i=1; i<=Math.min(2, this.wifiAvailableDraft || 2); i++) actions.push(i.toString());
                this.quickActions = actions.length ? actions : ['1', '2'];
            } else {
                this.quickActions = ['1', '2', '3'];
            }
        } else if (t.includes('what type') || t.includes('which modem') || t.includes('type of modem')) {
            this.quickActions = this.modemAvailable;
        } else if (t.includes('which device') || t.includes('remove')) {
            let removeActions = [];
            if (this.tvDraft > 0) removeActions.push('TV Receiver');
            if (this.wifiDraft > 0) removeActions.push('Wi-Fi AP');
            this.quickActions = removeActions;
        } else if (t.includes('anything else') || t.includes('done')) {
            this.quickActions = ['Yes', 'No', 'Show Summary'];
        } else {
            this.quickActions = this.getDynamicQuickActions();
        }
    }



    askAnythingElse() {
        this.currentFlow = 'ANYTHING_ELSE';
        setTimeout(() => {
            this.addAiMessage("Anything else to add or change?");
            this.quickActions = ['Yes', 'No'];
        }, 600);
    }

    triggerScanner(amount, deviceType = 'WIFI', parsed = null) {
        let items = [];
        const isTv = deviceType === 'TV';
        const prefix = isTv ? 'STB-' : 'AP-8X';
        
        for (let i = 0; i < amount; i++) {
            items.push({ id: i, sn: prefix + Math.floor(Math.random() * 9000 + 1000) });
        }

        this.messages.push({
            id: this.messageIdCounter++,
            isAi: true,
            isScanner: true,
            scannerItems: items,
            wrapperClass: 'chat-wrapper ai',
            bubbleClass: 'chat-bubble ai'
        });
        this.scrollToBottom();

        // After scan, complete removal
        setTimeout(() => {
            this.isTyping = true;
            this.scrollToBottom();
            setTimeout(() => {
                this.isTyping = false;
                
                if (isTv) {
                    const oldAmount = this.tvDraft;
                    const newAmount = Math.max(0, this.tvDraft - amount);
                    const actualRemoved = oldAmount - newAmount;
                    const savings = this.calculateTvCost(newAmount, oldAmount);
                    
                    this.tvDraft = newAmount;
                    
                    this.addAiMessage((parsed && parsed.message) ? parsed.message : `Successfully drafted removal of ${actualRemoved} TV Receiver(s). Cost impact: ${savings === 0 ? '$0' : '-$' + Math.abs(savings)}/mo.`);
                } else {
                    const oldAmount = this.wifiDraft;
                    const newAmount = Math.max(0, this.wifiDraft - amount);
                    const actualRemoved = oldAmount - newAmount;
                    const savings = this.calculateWifiCost(newAmount, oldAmount);
                    
                    this.wifiDraft = newAmount;
                    
                    this.addAiMessage((parsed && parsed.message) ? parsed.message : `Successfully drafted removal of ${actualRemoved} Wi-Fi AP(s). Cost impact: ${savings === 0 ? '$0' : '-$' + Math.abs(savings)}/mo.`);
                }
                
                this.updateCurrentInventory();
                
                this.askAnythingElse();
            }, 800);
        }, 1500);
    }

    showFinalSummary() {
        let total = 0;
        let formattedChanges = this.additionalChanges.map(change => {
            total += change.price;
            return {
                desc: change.desc,
                priceStr: change.price >= 0 ? `+$${change.price}` : `-$${Math.abs(change.price)}`
            };
        });

        this.preExistingWorkOrder.forEach(item => total += item.price);

        const totalStr = total >= 0 ? `+$${total}` : `-$${Math.abs(total)}`;
        const totalClass = total >= 0 ? 'total-positive' : 'total-positive'; // same color

        this.messages.push({
            id: this.messageIdCounter++,
            isAi: true,
            isSummary: true,
            preExisting: this.preExistingWorkOrder,
            changes: formattedChanges,
            totalStr: totalStr,
            totalClass: totalClass,
            wrapperClass: 'chat-wrapper ai',
            bubbleClass: 'chat-bubble ai'
        });
        this.scrollToBottom();
    }

    handleCancelOrder() {
        this.addAiMessage("Order changes cancelled. Anything else?");
        this.quickActions = this.getDynamicQuickActions();
        // Reset changes for simplicity
        this.additionalChanges = [];
    }

    handleConfirmOrder() {
        // Mock successful save
        this.addAiMessage("✅ Work order successfully updated!");
        this.quickActions = [];
        this.currentFlow = null;
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

    scrollToBottom() {
        // Allow DOM update before scrolling
        setTimeout(() => {
            const chatContainer = this.template.querySelector('.chat-history');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }, 50);
    }

    extractNumber(text) {
        const match = text.match(/\d+/);
        if (match) return parseInt(match[0], 10);
        
        // simple word to number fallback
        const words = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
        for (const [w, n] of Object.entries(words)) {
            if (text.toLowerCase().includes(w)) return n;
        }
        return null;
    }

    // ── Voice Input ─────────────────────────────────────────────────────────────

    startVoiceInput() {
        // If already listening, stop it
        if (this.isListening) {
            this._stopRecognition();
            return;
        }

        if (!this.voiceSupported) {
            this.addAiMessage("⚠️ Voice input is not supported in this browser. Please type your request.");
            return;
        }

        // eslint-disable-next-line no-undef
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();

        recognition.lang = 'en-US';
        recognition.interimResults = true;   // live preview as user speaks
        recognition.maxAlternatives = 1;
        recognition.continuous = false;      // stop after one utterance

        recognition.onstart = () => {
            this.isListening = true;
            this.interimTranscript = 'Listening...';
        };

        recognition.onresult = (event) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            // Show live interim text in the preview bar
            if (interim) {
                this.interimTranscript = interim;
            }

            // When a final result lands, push it into the text box
            if (final) {
                const trimmed = final.trim();
                this.userInput = trimmed;
                // Sync the visible <input> element value as well
                const inputEl = this.template.querySelector('.chat-input');
                if (inputEl) inputEl.value = trimmed;
                this.interimTranscript = trimmed;
            }
        };

        recognition.onerror = (event) => {
            this._stopRecognition();
            const msg = event.error === 'not-allowed'
                ? "⚠️ Microphone access was denied. Please allow mic permissions and try again."
                : `⚠️ Voice recognition error: ${event.error}`;
            this.addAiMessage(msg);
        };

        recognition.onend = () => {
            this._stopRecognition();
        };

        this._recognition = recognition;
        recognition.start();
    }

    _stopRecognition() {
        this.isListening = false;
        this.interimTranscript = 'Listening...';
        if (this._recognition) {
            try { this._recognition.stop(); } catch (e) { /* already stopped */ }
            this._recognition = null;
        }
    }

    disconnectedCallback() {
        this._stopRecognition();
    }

    // ── End Voice Input ──────────────────────────────────────────────────────────
}
