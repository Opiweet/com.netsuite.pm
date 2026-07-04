/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', './helper'], (search, helper) => {
  const { getAllResults, toId } = helper;
  const PROJECT_RECORD_TYPE = 'customrecord_pm_projects';
  const PROJECT_MANAGER_FIELD = 'custrecord_pm_project_manager';

  function extractLookupId(fieldValue) {
    if (Array.isArray(fieldValue) && fieldValue.length) {
      const first = fieldValue[0];
      return toId(first?.value ?? first?.id ?? first);
    }
    return toId(fieldValue);
  }

  function getProjectPermissionMeta(projectId) {
    const pid = toId(projectId);
    if (!pid) return { projectId: '', projectManagerId: '', createdById: '' };

    let projectManagerId = '';
    let createdById = '';

    try {
      const fields = search.lookupFields({
        type: PROJECT_RECORD_TYPE,
        id: pid,
        columns: [PROJECT_MANAGER_FIELD, 'createdby'],
      });
      projectManagerId = extractLookupId(fields?.[PROJECT_MANAGER_FIELD]);
      createdById = extractLookupId(fields?.createdby);
    } catch (_e) {
      // fallback below
    }

    if (!projectManagerId || !createdById) {
      try {
        const suiteSearch = search.create({
          type: PROJECT_RECORD_TYPE,
          filters: [['internalid', 'anyof', pid]],
          columns: [
            search.createColumn({ name: PROJECT_MANAGER_FIELD }),
            search.createColumn({ name: 'createdby' }),
          ],
        });
        const first = getAllResults(suiteSearch)?.[0] || null;
        if (first) {
          if (!projectManagerId) {
            projectManagerId = toId(
              first.getValue({ name: PROJECT_MANAGER_FIELD }),
            );
          }
          if (!createdById) {
            createdById = toId(first.getValue({ name: 'createdby' }));
          }
        }
      } catch (_e) {
        // leave as empty
      }
    }

    return {
      projectId: pid,
      projectManagerId,
      createdById,
    };
  }

  return {
    getProjectPermissionMeta,
  };
});
