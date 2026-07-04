/**
 * SINGLE FILE DEBUG MODULE
 * Runs in browser console + NetSuite
 */

/* global require */
require([
    'N/query',
    'N/record'
], function (query, record) {

    // ===============================
    // HELPER: LOG + RETURN
    // ===============================
    function logAndReturn(label, obj) {
        try {
            console.log('🔍 ' + label, JSON.stringify(obj, null, 2));
        } catch (e) {
            console.log('🔍 ' + label, obj);
        }
        return obj;
    }

    // ===============================
    // MAIN FUNCTION
    // ===============================
    function upsertProject(data) {

        console.log('🚀 INPUT DATA', data);

        try {

            const projectId = parseInt(data.projectId);

            if (!projectId) {
                return logAndReturn('NO PROJECT ID', {
                    status: 'ERROR',
                    message: 'Missing projectId'
                });
            }

            // ===============================
            // START DATE VALIDATION
            // ===============================
            if (data.startDate) {

                let startValidation = validateStartDateAdvanced(
                    projectId,
                    data.startDate
                );

                if (startValidation.status === 'ERROR') {
                    return logAndReturn('START DATE ERROR', startValidation);
                }

                if (startValidation.status === 'WARNING' && !data.forceUpdate) {
                    return logAndReturn('START DATE WARNING', startValidation);
                }

                if (startValidation.status === 'WARNING' && data.forceUpdate) {

                    let plans = startValidation.data?.plansToDelete || [];

                    console.log('⚠️ Deleting START forecast plans', plans);

                    plans.forEach(id => {
                        record.delete({
                            type: 'customrecord_pm_revenue_plan',
                            id: id
                        });
                    });
                }

                // ✅ UPDATE START DATE
                record.submitFields({
                    type: 'customrecord_pm_projects',
                    id: projectId,
                    values: {
                        custrecord_pm_project_startdate: new Date(data.startDate)
                    }
                });
            }

            // ===============================
            // END DATE VALIDATION
            // ===============================
            if (data.endDate) {

                let endValidation = validateEndDateAdvanced(
                    projectId,
                    data.endDate
                );

                if (endValidation.status === 'ERROR') {
                    return logAndReturn('END DATE ERROR', endValidation);
                }

                if (endValidation.status === 'WARNING' && !data.forceUpdate) {
                    return logAndReturn('END DATE WARNING', endValidation);
                }

                if (endValidation.status === 'WARNING' && data.forceUpdate) {

                    let plans = endValidation.data?.plansToDelete || [];

                    console.log('⚠️ Deleting END forecast plans', plans);

                    plans.forEach(id => {
                        record.delete({
                            type: 'customrecord_pm_revenue_plan',
                            id: id
                        });
                    });
                }

                // ✅ UPDATE END DATE
                record.submitFields({
                    type: 'customrecord_pm_projects',
                    id: projectId,
                    values: {
                        custrecord_pm_project_enddate: new Date(data.endDate)
                    }
                });
            }

            return logAndReturn('UPSERT SUCCESS', {
                status: 'SUCCESS',
                projectId: projectId
            });

        } catch (e) {
            return logAndReturn('UPSERT ERROR', {
                status: 'ERROR',
                message: e.message || e
            });
        }
    }

    // ===============================
    // START DATE VALIDATION
    // ===============================
    function validateStartDateAdvanced(projectId, newStartDate) {

        try {

            let project = record.load({
                type: 'customrecord_pm_projects',
                id: projectId
            });

            let oldStartDate = project.getValue('custrecord_pm_project_startdate');

            if (!oldStartDate) {
                return logAndReturn('NO OLD START DATE', { status: 'SUCCESS' });
            }

            let newStart = new Date(newStartDate);
            let oldStart = new Date(oldStartDate);

            // 🚫 BLOCK ANY CHANGE
            if (newStart.getTime() !== oldStart.getTime()) {
                return logAndReturn('START DATE BLOCKED', {
                    status: 'ERROR',
                    message: 'Start Date cannot be changed once set'
                });
            }

            return logAndReturn('START DATE SAME', { status: 'SUCCESS' });

        } catch (e) {
            return logAndReturn('START VALIDATION ERROR', {
                status: 'ERROR',
                message: e.message || e
            });
        }
    }

    // ===============================
    // END DATE VALIDATION
    // ===============================
    function validateEndDateAdvanced(projectId, newEndDate) {

        try {

            let project = record.load({
                type: 'customrecord_pm_projects',
                id: projectId
            });

            let oldEndDate = project.getValue('custrecord_pm_project_enddate');

            if (!oldEndDate) {
                return logAndReturn('NO OLD END DATE', { status: 'SUCCESS' });
            }

            let newEnd = new Date(newEndDate);
            let oldEnd = new Date(oldEndDate);

            // SAME DATE
            if (newEnd.getTime() === oldEnd.getTime()) {
                return logAndReturn('END DATE SAME', { status: 'SUCCESS' });
            }

            // EXTEND
            if (newEnd > oldEnd) {
                return logAndReturn('END DATE EXTENDED', {
                    status: 'SUCCESS'
                });
            }

            // REDUCE → CHECK PLANS
            let formattedEnd = formatDateForSQL(newEnd);

            let sql = `
    SELECT rp.id, rp.custrecord_pm_revplan_type as type
    FROM customrecord_pm_revenue_plan rp
    WHERE rp.custrecord_pm_revplan_project = ${projectId}
    AND rp.custrecord_pm_revplan_period > TO_DATE('${formattedEnd}', 'YYYY-MM-DD')
`;

            let results = query.runSuiteQL({ query: sql }).asMappedResults();

            if (!results.length) {
                return logAndReturn('NO END DATE PLANS', { status: 'SUCCESS' });
            }

            let hasActual = results.some(r => r.type == 1);
            console.log('END DATE VALIDATION PLANS', results, 'HAS ACTUAL?', hasActual);

            if (hasActual) {
                return logAndReturn('END DATE BLOCKED ACTUAL', {
                    status: 'ERROR',
                    message: 'Actual revenue exists after selected date'
                });
            }

            return logAndReturn('END DATE WARNING DELETE', {
                status: 'WARNING',
                message: results.length + ' forecast plans will be deleted',
                data: {
                    plansToDelete: results.map(r => r.id)
                }
            });

        } catch (e) {
            return logAndReturn('END VALIDATION ERROR', {
                status: 'ERROR',
                message: e.message || e
            });
        }
    }

    // ===============================
    // FORMAT DATE
    // ===============================
    function formatDateForSQL(date) {
        let d = new Date(date);
        let y = d.getFullYear();
        let m = String(d.getMonth() + 1).padStart(2, '0');
        let day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    // ===============================
    // EXPOSE TO WINDOW
    // ===============================
    window.pm_project_mod = {
        upsertProject: upsertProject
    };

    console.log('✅ Module Loaded: pm_project_mod');

});