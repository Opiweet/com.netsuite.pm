/** 
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * 
 * This Client Script dynamically controls the form assigned to the Project record based on the selected Customer.
 * 
 * Functionality:
 * - When a customer is selected or changed, the script retrieves the customer's subsidiary.
 * - Based on the subsidiary:
 *      - If subsidiary = 11 [BC] → Form 30 is applied
 *      - If subsidiary = 19 [FR] → Form 29 is applied
 *      - Otherwise → Default form is applied
 * - The form is switched dynamically using URL redirection, triggering a page reload.
 * - The selected customer is preserved during reload using URL parameters.
 * 
 * governance 0 unit
 * @returns {void}
 */
define(['N/search'], function (search) {

    /*********************************
     * CONFIGURATION OBJECT
     * - Centralized configuration for field IDs, form IDs, and business rules
     *********************************/
    const CONFIG = {
        FIELDS: {
            CUSTOMER: 'custrecord_pm_project_customer',
            FORM: 'customform',
            SUBSIDIARY: 'custrecord_pm_project_subsidiary'
        },

        DEFAULT_FORM: -1338,

        SUBSIDIARY_RULES: {
            11: { form: 30 },
            19: { form: 29 }
        },

        URL_PARAM: 'custparam_customer'
    };

    /**
     * Retrieves a parameter value from the current page URL.
     * 
     * @param {string} name - URL parameter name
     * @returns {string|null} Parameter value or null if not found
     * @governance 0 unit
     */
    function getUrlParam(name) {
        let params = new URLSearchParams(window.location.search);
        return params.get(name);
    }


    /**
     * Redirects the page with updated URL parameters to enforce form switching.
     * - Adds customer and form parameters to the URL
     * - Forces NetSuite to reload the record with the correct form
     * 
     * @param {string|number} customerId - Selected customer internal ID
     * @param {number} formId - Target form internal ID
     * @returns {void}
     * @governance 0 unit
     */
    function redirectWithParams(customerId, formId) {
        let url = new URL(window.location.href);

        url.searchParams.set(CONFIG.URL_PARAM, customerId);
        url.searchParams.set('cf', formId);

        window.location.href = url.toString();
    }

    /**
     * Core business logic function.
     * - Retrieves selected customer
     * - Looks up customer subsidiary
     * - Determines the appropriate form based on configuration rules
     * - Redirects to enforce form change if current form differs
     * 
     * @param {Record} currentRecord - Current record object
     * @returns {void}
     * @governance 1 unit
     */
    function handleCustomerLogic(currentRecord) {
        try {
            let customerId = currentRecord.getValue({
                fieldId: CONFIG.FIELDS.CUSTOMER
            });

            if (!customerId) return;

            let customerData = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: customerId,
                columns: ['subsidiary']
            });

            let subsidiaryId = customerData.subsidiary?.[0]?.value;

            currentRecord.setValue({
                fieldId: CONFIG.FIELDS.SUBSIDIARY,
                value: subsidiaryId,
                ignoreFieldChange: true
            });

            let rule = CONFIG.SUBSIDIARY_RULES[subsidiaryId];
            let targetForm = rule ? rule.form : CONFIG.DEFAULT_FORM;

            let currentForm = currentRecord.getValue(CONFIG.FIELDS.FORM);

            if (currentForm != targetForm) {
                redirectWithParams(customerId, targetForm);
            }

        } catch (e) {
            log.error('Error', e);
        }
    }

    /**
     * Page initialization handler.
     * - Restores customer value from URL parameter after form reload
     * - Reapplies business logic to ensure correct form is used
     * 
     * @param {Object} context - Script context
     * @param {Record} context.currentRecord - Current record
     * @param {string} context.mode - Record mode (create/edit/view)
     * @returns {void}
     * @governance 0 unit
     */
    function pageInit(context) {
        let currentRecord = context.currentRecord;

        // Restore customer from URL (after reload)
        let customerFromUrl = getUrlParam(CONFIG.URL_PARAM);

        if (customerFromUrl) {
            currentRecord.setValue({
                fieldId: CONFIG.FIELDS.CUSTOMER,
                value: customerFromUrl,
                ignoreFieldChange: true
            });
        }

        if (context.mode === 'create' || context.mode === 'edit') {
            handleCustomerLogic(currentRecord);
        }
    }

    /**
 * Field change handler.
 * - Triggers form switching logic when customer field is modified
 * 
 * @param {Object} context - Script context
 * @param {Record} context.currentRecord - Current record
 * @param {string} context.fieldId - Changed field ID
 * @returns {void}
 * @governance 0 unit
 */
    function fieldChanged(context) {
        let currentRecord = context.currentRecord;

        if (context.fieldId === CONFIG.FIELDS.CUSTOMER) {
            handleCustomerLogic(currentRecord);
        }
    }

    return {
        pageInit: pageInit,
        fieldChanged: fieldChanged
    };
});