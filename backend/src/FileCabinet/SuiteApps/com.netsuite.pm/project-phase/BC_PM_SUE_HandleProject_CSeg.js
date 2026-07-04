/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search'], function (record, search) {

    /**
     * Handles Project record lifecycle events (Create, Update, Delete).
     *
     * Syncs Project data with Custom Segment values:
     *  - Creates segment value on project creation
     *  - Updates segment value on project edit
     *  - Deletes segment value on project deletion
     *
     * @param {Object} context - User Event context
     * @param {Record} context.newRecord - New record (create/edit)
     * @param {Record} context.oldRecord - Old record (delete)
     * @param {string} context.type - Trigger type (CREATE | EDIT | DELETE)
     *
     * @governance ~10–20 units per execution
     */
    function afterSubmit(context) {
        try {


            let rec = context.newRecord;
            let type = context.type;
            let projectId = rec.id;
            let projectName = rec.getValue('name');
            let subsidiary = rec.getValue('custrecord_pm_project_subsidiary');

            if (type === context.UserEventType.CREATE) {
                createSegment(projectId, projectName, subsidiary);
            }

            if (type === context.UserEventType.EDIT || type === context.UserEventType.XEDIT) {
                updateSegment(projectId, projectName, subsidiary);
            }

            // if (type === context.UserEventType.DELETE) {
            //     deleteSegment(context.oldRecord.id);
            // }
        } catch (error) {
            log.error('error', error)
        }
    }

    /**
     * Creates a Custom Segment value based on Project data.
     *
     * Sets:
     *  - Name = Project Name
     *  - Subsidiary = Project Subsidiary
     *  - Reference = Project ID
     *
     * @param {number} projectId - Project internal ID
     * @param {string} name - Project name
     * @param {number} subsidiary - Subsidiary ID
     *
     * @governance ~5–10 units
     */
    function createSegment(projectId, name, subsidiary) {

        let seg = record.create({
            type: 'customrecord_cseg_project_seg'
        });

        seg.setValue({
            fieldId: 'name',
            value: name
        });

        seg.setValue({
            fieldId: 'custrecord_project_pm',
            value: projectId
        });

        seg.setValue({
            fieldId: 'cseg_project_seg_filterby_subsidiary',
            value: subsidiary
        });

        seg.save();
    }

    /**
     * Updates existing Custom Segment value linked to a Project.
     *
     * Synchronizes:
     *  - Name (Project name)
     *  - Subsidiary
     *
     * @param {number} projectId - Project internal ID
     * @param {string} name - Updated project name
     * @param {number} subsidiary - Updated subsidiary ID
     *
     * @governance ~10–15 units
     */
    function updateSegment(projectId, name, subsidiary) {

        let segId = findSegment(projectId);
        if (!segId) return;

        let seg = record.load({
            type: 'customrecord_cseg_project_seg',
            id: segId
        });

        seg.setValue({
            fieldId: 'name',
            value: name
        });

        seg.setValue({
            fieldId: 'cseg_project_seg_filterby_subsidiary',
            value: subsidiary
        });

        seg.save();
    }

    /**
     * Deletes Custom Segment value associated with a Project.
     *
     * Triggered when Project record is deleted.
     *
     * @param {number} projectId - Project internal ID
     *
     * @governance ~5–10 units
     */
    function deleteSegment(projectId) {

        let segId = findSegment(projectId);
        if (!segId) return;

        record.delete({
            type: 'customrecord_cseg_project_seg',
            id: segId
        });
    }

    /**
     * Retrieves Custom Segment value linked to a Project.
     *
     * Searches by project reference field to ensure
     * correct mapping between Project and Segment value.
     *
     * @param {number} projectId - Project internal ID
     * @returns {number|null} Segment internal ID or null if not found
     *
     * @governance ~5 units
     */
    function findSegment(projectId) {
        let result = search.create({
            type: 'customrecord_cseg_project_seg',
            filters: [
                ['custrecord_project_pm', 'is', projectId]
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return result.length ? result[0].getValue('internalid') : null;
    }


    function beforeSubmit(context) {
        if (context.type === context.UserEventType.DELETE) {
            let projectId = context.oldRecord.id;
            deleteSegment(projectId);
        }
    }
    return {
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});