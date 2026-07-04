/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/runtime',
  'N/search',
  'N/query',
  'N/log',
  '../../pm_config',
  '../core/helper',
  '../core/statuses',
  '../core/validator',
  '../core/user_types',
], (
  runtime,
  search,
  query,
  log,
  pmConfig,
  helper,
  statuses,
  validator,
  user_types,
) => {
  const {
    getAllResults,
    mapIdName,
    normalizeSalesOrderLabel,
    runSuiteQLMapped,
    toNumericIdList,
  } = helper;
  const { getProjectNameById, createProjectSegmentNameFilter } = validator;

  let cachedSubsidiaryScopeIds = null;
  let cachedSubsidiaryParentById = null;

  function getConfiguredSubsidiaryId() {
    const raw = pmConfig?.SUBSIDIARY ?? null;
    const id = raw != null ? String(raw).trim() : '';
    return id || null;
  }

  function getSubsidiaryScopeIds() {
    if (cachedSubsidiaryScopeIds) return cachedSubsidiaryScopeIds.slice();
    const baseId = getConfiguredSubsidiaryId();
    if (!baseId) {
      cachedSubsidiaryScopeIds = [];
      return [];
    }

    try {
      const suiteSearch = search.create({
        type: 'subsidiary',
        filters: [],
        columns: [
          search.createColumn({ name: 'internalid' }),
          search.createColumn({ name: 'parent' }),
        ],
      });

      const parentById = {};
      const childrenByParentId = {};
      getAllResults(suiteSearch).forEach((res) => {
        const id = res.getValue({ name: 'internalid' });
        if (!id) return;
        const pid = res.getValue({ name: 'parent' }) || null;
        const sid = String(id);
        parentById[sid] = pid != null ? String(pid) : null;
        const parentKey = pid != null ? String(pid) : '';
        if (!childrenByParentId[parentKey]) childrenByParentId[parentKey] = [];
        childrenByParentId[parentKey].push(sid);
      });

      const out = new Set([String(baseId)]);

      // Ancestors (walk up parents)
      let cur = String(baseId);
      for (let i = 0; i < 50; i++) {
        const p = parentById[cur];
        if (!p) break;
        if (out.has(p)) break;
        out.add(p);
        cur = p;
      }

      // Descendants (DFS)
      const stack = [String(baseId)];
      while (stack.length) {
        const id = stack.pop();
        const kids = childrenByParentId[String(id)] || [];
        kids.forEach((k) => {
          if (out.has(k)) return;
          out.add(k);
          stack.push(k);
        });
      }

      cachedSubsidiaryScopeIds = Array.from(out);
      return cachedSubsidiaryScopeIds.slice();
    } catch (e) {
      cachedSubsidiaryScopeIds = [String(baseId)];
      return cachedSubsidiaryScopeIds.slice();
    }
  }

  function getSubsidiaryParentById() {
    if (cachedSubsidiaryParentById) return { ...cachedSubsidiaryParentById };
    const out = {};
    try {
      const suiteSearch = search.create({
        type: 'subsidiary',
        filters: [],
        columns: [
          search.createColumn({ name: 'internalid' }),
          search.createColumn({ name: 'parent' }),
        ],
      });
      getAllResults(suiteSearch).forEach((res) => {
        const id = res.getValue({ name: 'internalid' });
        if (!id) return;
        const pid = res.getValue({ name: 'parent' }) || null;
        out[String(id)] = pid != null ? String(pid) : null;
      });
    } catch (e) {
      // ignore
    }
    cachedSubsidiaryParentById = out;
    return { ...out };
  }

  function tryCreateSearch({ type, filters, columns }) {
    try {
      const suiteSearch = search.create({ type, filters, columns });
      return getAllResults(suiteSearch);
    } catch (e) {
      return null;
    }
  }

  function createSearchWithFilterVariants({ type, filterVariants, columns }) {
    const variants = Array.isArray(filterVariants) ? filterVariants : [];
    for (const filters of variants) {
      try {
        return search.create({ type, filters, columns });
      } catch (e) {
        // try next variant
      }
    }
    return null;
  }

  function buildSubsidiaryScopeFilter(fieldId) {
    const ids = getSubsidiaryScopeIds();
    if (!ids.length) return null;
    return [String(fieldId || 'subsidiary'), 'anyof', ...ids.map(String)];
  }

  function buildFiltersWithSubsidiaryScope(baseFilters, fieldIdVariants) {
    const safeBase = Array.isArray(baseFilters) ? baseFilters.slice() : [];
    const variants =
      Array.isArray(fieldIdVariants) && fieldIdVariants.length
        ? fieldIdVariants
        : ['subsidiary'];

    const scoped = [];
    variants.forEach((fieldId) => {
      const f = buildSubsidiaryScopeFilter(fieldId);
      if (!f) return;
      scoped.push([...safeBase, 'AND', f]);
    });
    scoped.push(safeBase);
    return scoped;
  }

  function getFirstNResults(suiteSearch, limit) {
    const safeLimit = Math.max(0, parseInt(String(limit || 0), 10) || 0);
    if (!safeLimit) return [];

    try {
      const paged = suiteSearch.runPaged({ pageSize: 1000 });
      const out = [];
      for (const range of paged.pageRanges) {
        if (out.length >= safeLimit) break;
        const page = paged.fetch({ index: range.index });
        const data = page?.data || [];
        for (let i = 0; i < data.length && out.length < safeLimit; i++) {
          out.push(data[i]);
        }
      }
      return out;
    } catch (e) {
      // Fallback to helper (may be more expensive, but preserves behavior).
      return getAllResults(suiteSearch).slice(0, safeLimit);
    }
  }

  function getActiveCustomers({ limit = 500000 } = {}) {
    const scopeIds = getSubsidiaryScopeIds();
    const idList = toNumericIdList(scopeIds);
    const subFilter = idList
      ? ` AND (cust.subsidiary IN (${idList}) OR map.subsidiary IN (${idList}))`
      : '';
    const safeLimit = Math.max(0, parseInt(String(limit || 0), 10) || 0);
    if (!safeLimit) return [];

    const q = `
      SELECT
        cust.id,
        cust.entityid,
        cust.subsidiary AS primary_subsidiary,
        map.subsidiary,
        cust.fullname
      FROM
        customer cust
      INNER JOIN
        customersubsidiarymap map ON map.entity = cust.id
      WHERE
        cust.isinactive = 'F'${subFilter}
      ORDER BY
        cust.entityid
    `;

    const scopeSet = new Set(scopeIds.map(String));
    const seen = new Set();

    const rows = runSuiteQLMapped(q, query, (v) => ({
      id: v?.[0] != null ? String(v[0]) : null,
      entityId: v?.[1] != null ? String(v[1]) : '',
      primarySubsidiaryId: v?.[2] != null ? String(v[2]) : null,
      subsidiaryId: v?.[3] != null ? String(v[3]) : null,
      fullName: v?.[4] != null ? String(v[4]) : '',
    })).filter((r) => r?.id);

    const out = [];
    rows.forEach((r) => {
      const inScope =
        !scopeSet.size ||
        (r.primarySubsidiaryId &&
          scopeSet.has(String(r.primarySubsidiaryId))) ||
        (r.subsidiaryId && scopeSet.has(String(r.subsidiaryId)));
      if (!inScope) return;
      if (seen.has(r.id)) return;
      seen.add(r.id);
      const label = String(r.fullName || r.entityId || r.id || '').trim();
      out.push({ id: r.id, name: label || String(r.id || '') });
    });

    return out.slice(0, safeLimit);
  }

  function getActiveProjectManagers({ limit = 500000 } = {}) {
    // const scopeIds = getSubsidiaryScopeIds();
    // const idList = toNumericIdList(scopeIds);

    const idList = getConfiguredSubsidiaryId(); // For employees, we only filter by the configured subsidiary (not the full scope)
    const subFilter = idList ? ` AND subsidiary IN (${idList})` : '';
    const safeLimit = Math.max(0, parseInt(String(limit || 0), 10) || 0);
    if (!safeLimit) return [];

    const q = `
      SELECT
        id,
        entityid,
        firstname,
        lastname
      FROM
        employee
      WHERE
        isinactive = 'F' AND giveaccess = 'T'${subFilter}
      ORDER BY
        entityid
    `;

    return runSuiteQLMapped(q, query, (v) => {
      const id = v?.[0] != null ? String(v[0]) : null;
      const entityId = v?.[1] != null ? String(v[1]) : '';
      const first = v?.[2] != null ? String(v[2]) : '';
      const last = v?.[3] != null ? String(v[3]) : '';
      const fullName = String(`${first} ${last}`).trim();
      const label = String(fullName || entityId || '').trim();
      return { id, name: label || String(id || '') };
    })
      .filter((r) => r?.id)
      .slice(0, safeLimit);
  }

  function getDepartments() {
    const scopeIds = getSubsidiaryScopeIds();
    const idList = toNumericIdList(scopeIds);
    const subFilter = idList ? ` AND dept_map.subsidiary IN (${idList})` : '';
    const q = `
      SELECT DISTINCT
        id,
        name
      FROM
        department d
        INNER JOIN departmentsubsidiarymap dept_map ON dept_map.department = d.id
      WHERE
        isinactive = 'F'${subFilter}
      ORDER BY
        name
    `;

    return runSuiteQLMapped(q, query, (v) => ({
      id: v?.[0] != null ? String(v[0]) : null,
      name: String(v?.[1] || v?.[0] || '').trim(),
    })).filter((r) => r?.id && r?.name);
  }

  function toSqlTextLiteral(value) {
    return String(value == null ? '' : value).replace(/'/g, "''");
  }

  function getProjectSalesOrders(projectId) {
    const rawProjectId = projectId != null ? String(projectId).trim() : '';
    if (!rawProjectId || !rawProjectId.match(/^\d+$/)) return [];
    const projectName = getProjectNameById(rawProjectId);
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) return [];

    const scopeIds = getSubsidiaryScopeIds();
    const idList = toNumericIdList(scopeIds);
    const subFilter = idList ? ` AND tll.subsidiary IN (${idList})` : '';
    const safeName = toSqlTextLiteral(normalizedName.toLowerCase());

    const q = `
      SELECT
        t.id,
        t.tranid
      FROM
        transaction t
      INNER JOIN
        transactionline tll
        ON tll.transaction = t.id
        AND tll.mainline = 'T'
      WHERE
        t.type = 'SalesOrd'
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'${subFilter}
      ORDER BY
        t.tranid
    `;

    return runSuiteQLMapped(q, query, (v) => ({
      id: v?.[0] != null ? String(v[0]) : null,
      tranId: normalizeSalesOrderLabel(v?.[1] != null ? String(v[1]) : ''),
    })).filter((r) => r?.id);
  }

  function buildProjectMilestones(projectId) {
    const milestoneMap = {};

    if (!projectId) return { milestones: [] };
    const projectName = getProjectNameById(projectId);
    const normalizedName = String(projectName || '').trim();
    log.audit({
      title: 'PHASE_LOOKUPS_MILESTONES_START',
      details: JSON.stringify({
        projectId: String(projectId || ''),
        projectName: normalizedName || null,
      }),
    });
    if (!normalizedName) return { milestones: [] };
    const milestoneProductFamilyId =
      pmConfig?.LIST_IDS?.ITEM_PRODUCT_FAMILY?.MILESTONE != null
        ? String(pmConfig.LIST_IDS.ITEM_PRODUCT_FAMILY.MILESTONE).trim()
        : '6';
    if (!milestoneProductFamilyId) return { milestones: [] };

    const segmentFilter = createProjectSegmentNameFilter(projectName);
    if (!segmentFilter) return { milestones: [] };

    const columns = [
      search.createColumn({ name: 'item' }),
      search.createColumn({ name: 'memo' }),
    ];
    const baseFilters = [
      ['type', 'anyof', 'SalesOrd'],
      'AND',
      segmentFilter,
      'AND',
      ['mainline', 'is', 'F'],
      'AND',
      ['taxline', 'is', 'F'],
      'AND',
      ['shipping', 'is', 'F'],
      'AND',
      ['memo', 'isnotempty', ''],
    ];

    const withMilestoneByJoin = [
      ...baseFilters,
      'AND',
      ['item.custitem_product_family', 'anyof', milestoneProductFamilyId],
    ];
    const withMilestoneByFormula = [
      ...baseFilters,
      'AND',
      [
        'formulatext: {item.custitem_product_family}',
        'is',
        milestoneProductFamilyId,
      ],
    ];
    const filterVariants = [
      ...buildFiltersWithSubsidiaryScope(withMilestoneByJoin, ['subsidiary']),
      ...buildFiltersWithSubsidiaryScope(withMilestoneByFormula, [
        'subsidiary',
      ]),
    ];

    const suiteSearch = createSearchWithFilterVariants({
      type: 'salesorder',
      filterVariants,
      columns,
    });
    if (!suiteSearch) return { milestones: [] };

    let savedSearchRows = 0;
    const sample = [];
    getAllResults(suiteSearch).forEach((res) => {
      const itemId = String(res.getValue({ name: 'item' }) || '').trim();
      const desc = String(res.getValue({ name: 'memo' }) || '').trim();
      if (!itemId || !desc) return;

      savedSearchRows++;
      if (sample.length < 5) sample.push({ itemId, desc });

      const key = `${itemId}|||${desc}`;
      if (milestoneMap[key]) return;
      milestoneMap[key] = { key, label: desc, itemId, desc };
    });
    log.audit({
      title: 'PHASE_LOOKUPS_MILESTONES_SAVED_SEARCH_ROWS',
      details: JSON.stringify({
        projectId: String(projectId || ''),
        milestoneProductFamilyId,
        rowCount: savedSearchRows,
        sample,
      }),
    });

    const milestones = Object.values(milestoneMap).sort((a, b) =>
      String(a?.label || '').localeCompare(String(b?.label || '')),
    );
    log.audit({
      title: 'PHASE_LOOKUPS_MILESTONES_RESULT',
      details: JSON.stringify({
        projectId: String(projectId || ''),
        milestoneCount: milestones.length,
        sample: milestones.slice(0, 5),
      }),
    });
    return { milestones };
  }

  function getActiveServiceItems() {
    const scopeIds = getSubsidiaryScopeIds();
    const scopeSet = new Set(scopeIds.map(String));
    const milestoneProductFamilyId =
      pmConfig?.LIST_IDS?.ITEM_PRODUCT_FAMILY?.MILESTONE != null
        ? String(pmConfig.LIST_IDS.ITEM_PRODUCT_FAMILY.MILESTONE).trim()
        : '6';
    if (!milestoneProductFamilyId) return [];

    // If an item is mapped to an ancestor subsidiary with includechildren=T,
    // it is also available to all descendant subsidiaries.
    const parentById = getSubsidiaryParentById();
    const ancestorSet = new Set();
    scopeIds.forEach((sid) => {
      let cur = String(sid);
      for (let i = 0; i < 50; i++) {
        const p = parentById[cur];
        if (!p) break;
        const ps = String(p);
        if (ancestorSet.has(ps)) break;
        ancestorSet.add(ps);
        cur = ps;
      }
    });

    const q = `
      SELECT
        i.id,
        i.includechildren,
        i.itemid,
        i.displayname,
        map.subsidiary
      FROM item i
      INNER JOIN itemsubsidiarymap map ON map.item = i.id
      WHERE i.isinactive = 'F'
        AND i.custitem_product_family = '${toSqlTextLiteral(
          milestoneProductFamilyId,
        )}'
      ORDER BY i.itemid
    `;

    const rows = runSuiteQLMapped(q, query, (v) => ({
      id: v?.[0] != null ? String(v[0]) : null,
      includeChildren: String(v?.[1] || '').toUpperCase() === 'T',
      itemId: v?.[2] != null ? String(v[2]) : null,
      displayName: v?.[3] != null ? String(v[3]) : '',
      subsidiaryId: v?.[4] != null ? String(v[4]) : null,
    })).filter((r) => r?.id && r?.subsidiaryId);

    const out = [];
    const seen = new Set();
    rows.forEach((r) => {
      const subId = String(r.subsidiaryId || '');
      const include =
        scopeSet.has(subId) || (r.includeChildren && ancestorSet.has(subId));
      if (!include) return;
      if (seen.has(r.id)) return;
      seen.add(r.id);
      const name = String(r.displayName || r.itemId || r.id || '').trim();
      out.push({ id: r.id, name, itemId: r.itemId });
    });

    return out;
  }

  function getCustomListValues(customListScriptId, entityType) {
    if (!customListScriptId) return [];

    const suiteSearch = search.create({
      type: String(customListScriptId),
      filters: [['isinactive', 'is', 'F']],
      columns: [
        search.createColumn({ name: 'name', sort: search.Sort.ASC }),
        search.createColumn({ name: 'internalid' }),
      ],
    });

    const groupedByKey = {};
    const orderedKeys = [];
    getAllResults(suiteSearch).forEach((res) => {
      const id = String(res.getValue({ name: 'internalid' }) || '').trim();
      const name = String(res.getValue({ name: 'name' }) || '').trim();
      const mapped = statuses.mapNetSuiteStatusStrict(entityType, {
        id,
        text: name,
        contextAction: 'init_data.statuses',
        logger: log,
        logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
      });
      const key = String(mapped.key || '').trim();
      if (!key) return;
      if (!groupedByKey[key]) {
        groupedByKey[key] = {
          id,
          name: mapped.label || name || key,
          key,
          label: mapped.label || key,
        };
        orderedKeys.push(key);
      }
    });
    return orderedKeys.map((key) => groupedByKey[key]);
  }

  function getInitData() {
    const currentUser = runtime.getCurrentUser();
    const types = user_types.getUserTypes() || {};
    const varianceToleranceConfig = validator.getVarianceToleranceConfig(null);

    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch (e) {
        return fallback;
      }
    };

    return {
      user: {
        id: currentUser?.id ?? null,
        name: currentUser?.name ?? null,
        email: currentUser?.email ?? null,
        roleId: types.roleId || null,
        roleName: types.roleName || null,
        isFinanceUser: Boolean(types.isFinanceUser),
        isAdmin: Boolean(types.isAdmin),
        isSalesManager: Boolean(types.isSalesManager),
      },
      access: {
        departments: safe(getDepartments, []),
      },
      lookups: {
        customers: safe(() => getActiveCustomers({ limit: 500000 }), []),
        projectManagers: safe(
          () => getActiveProjectManagers({ limit: 500000 }),
          [],
        ),
        departments: safe(getDepartments, []),
      },
      serviceItems: safe(getActiveServiceItems, []),
      settings: {
        revRecJournalBulkAsyncThreshold:
          pmConfig?.REV_REC_JNL_BULK_ASYNC_THRESHOLD,
        varianceTolerancePercent: varianceToleranceConfig?.percent ?? null,
        varianceToleranceAbsolute: varianceToleranceConfig?.absolute ?? null,
      },
      statuses: {
        projects: safe(
          () =>
            getCustomListValues(
              'customlist_pm_project_status',
              statuses.ENTITY_TYPES.PROJECT,
            ),
          [],
        ),
        projectPhases: safe(
          () =>
            getCustomListValues(
              'customlist_pm_projectphase_status',
              statuses.ENTITY_TYPES.PHASE,
            ),
          [],
        ),
        revPlans: safe(
          () =>
            getCustomListValues(
              'customlist_pm_revplan_status',
              statuses.ENTITY_TYPES.REVPLAN,
            ),
          [],
        ),
      },
    };
  }

  function getPhaseLookups(projectId) {
    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch (e) {
        return fallback;
      }
    };

    const salesOrders = safe(() => getProjectSalesOrders(projectId), []);
    const departments = safe(getDepartments, []);
    const { milestones } = safe(() => buildProjectMilestones(projectId), {
      milestones: [],
    });
    log.audit({
      title: 'PHASE_LOOKUPS_PAYLOAD_COUNTS',
      details: JSON.stringify({
        projectId: String(projectId || ''),
        salesOrderCount: salesOrders.length,
        departmentCount: departments.length,
        milestoneCount: milestones.length,
      }),
    });

    return { salesOrders, departments, milestonesByDept: {}, milestones };
  }

  function getProjectEditLookups({
    customerLimit = 500000,
    projectManagerLimit = 500000,
  } = {}) {
    return {
      customers: getActiveCustomers({ limit: customerLimit }),
      projectManagers: getActiveProjectManagers({ limit: projectManagerLimit }),
      departments: getDepartments(),
    };
  }

  return { getInitData, getPhaseLookups, getProjectEditLookups };
});
