/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define([
  'N/error',
  'N/url',
  'N/runtime',
  'N/ui/message',
  'N/record',
  'N/search',
  './modules/project_financials_mod',
  './core/validator',
  '../pm_config',
], (
  error,
  url,
  runtime,
  message,
  record,
  search,
  project_financials_mod,
  validator,
  pmConfig,
) => {
  /**
   * Add custom button to create Revenue Recognition Plan for project's, [phases]
   * Executed only in VIEW mode
   *
   * @governance 0 units
   * @param {Object} context - User Event execution context
   * @param {Record} context.newRecord - Current item record
   */
  const beforeLoad = (context) => {
    try {
      const { newRecord, type } = context;
      const recordType = newRecord.type;

      switch (type) {
        case context.UserEventType.VIEW:
          if (runtime.executionContext === runtime.ContextType.USER_INTERFACE) {
            dispProjectBadgeOnSO(context);
            dispProjectSummaryHeaderAndBtn(context);
          }
          break;
      }
    } catch (e) {
      log.error({
        name: e.name || 'Error in beforeLoad User Event',
        details: e.message || 'Unexpected error in beforeLoad User Event',
      });
    }
  };

  const beforeSubmit = (context) => {
    try {
      const { newRecord, type } = context;
      const recordType = newRecord.type;

      switch (type) {
        case context.UserEventType.CREATE:
          preventDuplProjectNames(context);
          break;
        case context.UserEventType.COPY:
          preventDuplProjectNames(context);
          break;
        case context.UserEventType.EDIT:
          preventDuplProjectNames(context);
          break;
      }
    } catch (e) {
      log.error({
        name: e.name || 'Error in beforeSubmit User Event',
        details: e.message || 'Unexpected error in beforeSubmit User Event',
      });

      if (e.name === 'preventDuplProjectNames') {
        throw error.create({
          name: e.name,
          message: e.message,
          notifyOff: false,
        }); // re-throw to block action
      }
    }
  };

  /*********************************/
  /** SALES ORDER RELATED LOGICS **/
  /*********************************/
  const dispProjectBadgeOnSO = ({ newRecord, form }) => {
    if (newRecord.type !== record.Type.SALES_ORDER) return;

    // Display Project badge on Sales Order if associated with a project
    // - filtered by subsidiary Franklin
    const projectName = String(
      newRecord.getText({ fieldId: 'cseg_project_seg' }) || '',
    ).trim();
    const projectId = validator.resolveProjectIdBySegmentName(projectName);
    const subsidiaryId = newRecord.getValue({ fieldId: 'subsidiary' });

    if (projectId && subsidiaryId === pmConfig.SUBS.FRANKLIN) {
      const projectPortalUrl = url.resolveScript({
        scriptId: 'customscript_bc_pm_ssu_projectphase',
        deploymentId: 'customdeploy_bc_pm_ssu_projectphase',
      });

      const projectUrl = `${projectPortalUrl}#/projects/${projectId}`;
      const anchorTag = `<span>PROJECT: <a href="${projectUrl}" style="color: inherit;" target="_blank">${projectName}</a></span>`;
      const svgEle = `
      <svg
        width="18px"
        height="18px"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g stroke-width="0"></g>
        <g stroke-linecap="round" stroke-linejoin="round"></g>
        <g>
          <path
            d="M10 13H14M19 9V20H5V9M19 9H5M19 9C19.5523 9 20 8.55228 20 8V5C20 4.44772 19.5523 4 19 4H5C4.44772 4 4 4.44772 4 5V8C4 8.55228 4.44772 9 5 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </g>
      </svg>
      `;

      form.addField({
        id: 'custpage_project_badge',
        label: 'Project Badge',
        type: 'inlinehtml',
      }).defaultValue = `
    <style>
        .uir-page-title .cust-status .badge {
            border-radius: 5px;
            padding: 0.3rem 0.5rem;
            font-size: 0.75em;
            font-weight: 600;
            margin-left: 0.5rem;
            display: inline-block;
        }
        .cust-complexitem-badge {
          background-color: #404040;
          color: #ffffff;
          border: 1px solid #5e5e5e;
        }
        .cust-centered {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 5px;
        }
    </style>

    <script>
    (function() {
        const containerEle = document.querySelector('div.uir-page-title-firstline');
        if (!containerEle) return;

        let statusContainer = containerEle.querySelector('div.cust-status');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.classList.add('cust-status');
            statusContainer.style.display = 'inline-block';

            const recordTypeEle = containerEle.querySelector('.uir-record-type');
            if (recordTypeEle) {
                recordTypeEle.insertAdjacentElement('afterend', statusContainer);
            }
        }

        if (statusContainer.querySelector('.' + 'cust-complexitem-badge')) return;
        const badge = document.createElement('span');
        badge.classList.add('badge', 'cust-complexitem-badge');
        badge.innerHTML = '<div class="cust-centered">' + ${JSON.stringify(svgEle)} + ${JSON.stringify(anchorTag)} + "</div>";
        statusContainer.appendChild(badge);

    })();
    </script>`;
    }
  };

  /************************************/
  /** PROJECT RECORD RELATED LOGICS **/
  /************************************/
  const preventDuplProjectNames = ({ newRecord }) => {
    if (newRecord.type !== 'customrecord_pm_projects') return;

    let recName = newRecord.getValue({ fieldId: 'name' });
    if (!recName) return;

    recName = recName.trim();

    const filters = [['name', 'is', recName]];

    // Exclude current record (on edit)
    if (newRecord.id) {
      filters.push('AND', ['internalid', 'noneof', newRecord.id]);
    }

    const recSearch = search.create({
      type: newRecord.type,
      filters: filters,
      columns: ['internalid'],
    });

    const results = recSearch.run().getRange({ start: 0, end: 1 });

    if (results && results.length > 0) {
      const duplicateId = results[0].getValue({ name: 'internalid' });
      const errmsg = `Create/Update Error: Duplicate record found named: '${recName}' at internal id: ${duplicateId}`;

      throw error.create({
        name: 'preventDuplProjectNames',
        message: errmsg,
        notifyOff: false,
      });
    }
  };

  const dispProjectSummaryHeaderAndBtn = ({ newRecord, form }) => {
    if (newRecord.type !== 'customrecord_pm_projects') return;
    let financial_data = project_financials_mod.getProjectFinancials(
      newRecord.id,
    );
    dispProjectSummaryHeader({ newRecord, form, financial_data });
    addGenerateRevenuePlanButton({ newRecord, form, financial_data });
  };

  /**
   * Add SUmmary Header to Project Record, displaying key financial metrics (Project Total, SO Total, Variance)
   * Executed only in VIEW mode
   *
   * @governance 0 units
   * @param {Record} newRecord - Current item record
   * @param {Form} form - NetSuite form object

   */
  const dispProjectSummaryHeader = ({ newRecord, form, financial_data }) => {
    if (!form || !newRec?.id || !financial_data?.totals) return;

    const t = financial_data.totals;

    // Format values
    const projectTotal = Number(t.projectTotal || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const soTotal = Number(t.soTotal || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const variance = Number(t.variance || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const varianceRaw = Number(t.variance || 0);
    const varianceCheck = validator.isVarianceWithinTolerance(financial_data);

    if (!varianceCheck.ok) {
      form.addPageInitMessage({
        type: message.Type.ERROR,
        title: 'Revenue Plan Blocked',
        message: `Cannot generate Revenue Plan due to variance of $${varianceRaw}. Please resolve discrepancies between Project and Sales Order (by Department).`,
      });
    }

    form.addField({
      id: 'custpage_project_summary_header',
      label: 'Project Summary Header',
      type: 'inlinehtml',
    }).defaultValue = `
    <style>
        .pm-kpi-wrapper {
            background: #f3f4f6;
            border-radius: 14px;
            padding: 15px 25px;
            margin-left: 15px;
            margin-top: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .pm-kpi-container {
            display: flex;
            align-items: center;
        }

        .pm-kpi-item {
            padding: 0 25px;
        }

        .pm-kpi-item:not(:last-child) {
            border-right: 1px solid #ddd;
        }

        .pm-kpi-label {
            font-size: 11px;
            color: #6b7280;
            text-transform: uppercase;
            margin-bottom: 4px;
        }

        .pm-kpi-value {
            font-size: 22px;
            font-weight: 600;
            color: #111827;
        }

        .pm-kpi-negative {
            color: #dc2626;
        }

        .pm-kpi-positive {
            color:  #dc2626;
        }

        .pm-kpi-wrapper:hover {
            transform: translateY(-1px);
            transition: 0.2s ease;
        }
    </style>

    <script>
    (function() {

        const containerEle = document.querySelector('div.uir-page-title-firstline');
        if (!containerEle) return;

        // prevent duplicate render
        if (document.querySelector('.pm-kpi-wrapper')) return;

        const wrapper = document.createElement('div');

        wrapper.innerHTML = \`
            <div class="pm-kpi-wrapper">
                <div class="pm-kpi-container">

                    <div class="pm-kpi-item">
                        <div class="pm-kpi-label">PROJECT TOTAL</div>
                        <div class="pm-kpi-value">$${projectTotal}</div>
                    </div>

                    <div class="pm-kpi-item">
                        <div class="pm-kpi-label">SO TOTAL</div>
                        <div class="pm-kpi-value">$${soTotal}</div>
                    </div>

                    <div class="pm-kpi-item">
                        <div class="pm-kpi-label">VARIANCE</div>
                        <div class="pm-kpi-value ${
                          t.variance > 0
                            ? 'pm-kpi-positive'
                            : t.variance < 0
                              ? 'pm-kpi-negative'
                              : ''
                        }">
                            $${variance}
                        </div>
                    </div>

                </div>
            </div>
        \`;

        // POSITION: after title
        const title = containerEle.querySelector('.uir-record-name') 
                   || containerEle.querySelector('.uir-record-type');

        if (title) {
            title.insertAdjacentElement('afterend', wrapper);
        } else {
            containerEle.appendChild(wrapper);
        }

    })();
    </script>
    `;
  };

  /**
   * Add custom button to create Revenue Recognition Plan for project's, [phases]
   * Resolves Suitelet URL and binds client-side functionality
   *
   * @governance 1 unit
   * @param {Record} newRecord - Current item record
   * @param {Form} form - NetSuite form object
   */

  const addGenerateRevenuePlanButton = ({
    newRecord,
    form,
    financial_data,
  }) => {
    const status = newRecord.getValue({
      fieldId: 'custrecord_pm_project_status',
    });

    if (status != pmConfig?.LIST_IDS?.PROJECT_STATUS?.ACTIVE) return;
    if (financial_data && financial_data.totals) {
      const varianceCheck = validator.isVarianceWithinTolerance(financial_data);
      if (!varianceCheck.ok) return;
    }

    const suiteletUrl = url.resolveScript({
      scriptId: 'customscript_bc_pm_ssu_projectphase_hdl',
      deploymentId: 'customdeploy_bc_pm_ssu_projectphase_hdl',
      returnExternalUrl: false,
    });

    form.addButton({
      id: 'custpage_genrevplan_btn',
      label: 'Generate Revenue Plan',
      functionName: `btnFunctionality(
                 '${suiteletUrl}',
                 'generate_rev_plans',
                 'custpage_genrevplan_btn',
                 ${newRecord.id}
             )`,
    });

    form.clientScriptModulePath = './modules/misc_mod';
  };

  return { beforeLoad };
});
