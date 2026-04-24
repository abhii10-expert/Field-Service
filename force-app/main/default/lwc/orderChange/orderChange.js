import { LightningElement, api, track } from 'lwc';
import getAccountSummary from '@salesforce/apex/AccountSummaryController.getAccountSummary';

export default class OrderChange extends LightningElement {
    @api recordId;
    @track summary;
    @track isLoading = false;
    @track error;

    handleSummarize() {
        this.isLoading = true;
        this.summary = null;
        this.error = null;

        getAccountSummary({ recordId: this.recordId })
            .then(result => {
                this.summary = result;
                this.isLoading = false;
            })
            .catch(err => {
                this.error = err.body?.message || 'Something went wrong.';
                this.isLoading = false;
            });
    }
}