import { defineStore } from 'pinia'

const MAX_PROJECT_DOCUMENTS = 3

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    backendMonthsByProject: {},
    revenueRowsByProject: {},
    revenueSummaryByProject: {},
    phasesByProject: {},
    projectPhasesFetchedAtByProject: {},
    projectPhasesInFlightByProject: {},
    projectRevPlansFetchedAtByProject: {},
    projectRevPlansInFlightByProject: {},
    projectRevPlansMetaByProject: {},
    handlerUrl: '',
    projectsFetchedAt: 0,
    projectsInFlight: null,
    projectsPaginatedInFlight: null,
    projectsPaginatedRequestSeq: 0,
    projectsPaginatedAppliedSeq: 0,
    projectsPagination: {
      page: 1,
      pageSize: 25,
      totalCount: 0,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    },
    projectsStatusCounters: { all: 0 },
    projectsRevPlanStatusCounters: { all: 0 },
    initData: {
      user: null,
      authz: { roles: [], capabilities: [] },
      access: { departments: [] },
      links: {},
      lookups: { customers: [], projectManagers: [], departments: [] },
      settings: { revRecJournalBulkAsyncThreshold: 5 },
      statuses: { projects: [], projectPhases: [], revPlans: [] },
      serviceItems: [],
      fetchedAt: 0,
    },
    initDataInFlight: null,
    rbacConfig: null,
    rbacConfigFetchedAt: 0,
    rbacConfigInFlight: null,
    saveRbacConfigInFlight: null,
    projectEditLookups: {
      customers: [],
      projectManagers: [],
      departments: [],
      fetchedAt: 0,
    },
    projectEditLookupsInFlight: null,
    phaseLookups: {
      salesOrders: [],
      departments: [],
      milestonesByDept: {},
      milestones: [],
      fetchedAt: 0,
      projectId: null,
    },
    phaseLookupsInFlight: null,
    phaseLookupsInFlightKey: '',
    projectFinancialsByProject: {},
    projectFinancialsInFlightByProject: {},
    projectLoadByProject: {},
    projectLoadFetchedAtByProject: {},
    projectLoadInFlightByProject: {},
    generateRevPlansInFlightByProject: {},
    updateRevenuePlansInFlightByProject: {},
    reopenRevPlansInFlightByProject: {},
    generateRevRecJournalInFlightByProject: {},
    generateRevRecJournalsInFlight: null,
    activateProjectInFlightByProject: {},
    projectStatusTransitionInFlightByProject: {},
    documentsByProject: {},
    documentsFetchedAtByProject: {},
    documentsInFlightByProject: {},
    notesByProject: {},
    notesFetchedAtByProject: {},
    notesInFlightByProject: {},
  }),
  actions: {
    _debugAuthzLog(scope, payload = {}) {
      if (!import.meta?.env?.DEV) return
      try {
        const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : []
        console.log(`[PM RBAC] ${scope}`, {
          ...payload,
          capabilityCount: capabilities.length,
          capabilities,
        })
      } catch (_e) {
        // no-op
      }
    },
    _parseDateAny(value) {
      if (!value) return null
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

      if (typeof value === 'number') {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
      }

      const raw = String(value).trim()
      if (!raw) return null

      // Date-only ISO (YYYY-MM-DD): treat as local date to avoid timezone day-shifts.
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (iso) {
        const year = parseInt(iso[1], 10)
        const month = parseInt(iso[2], 10)
        const day = parseInt(iso[3], 10)
        const d = new Date(year, month - 1, day)
        return Number.isNaN(d.getTime()) ? null : d
      }

      // NetSuite commonly returns dates like "4/9/2026" and datetimes like "4/9/2026 8:51 am".
      // In this app, backend date payloads are standardized as DD/MM/YYYY where possible.
      // For slash dates, prefer DD/MM parsing to keep frontend aligned with backend.
      const slash = raw.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])[Mm])?)?$/,
      )
      if (slash) {
        const a = parseInt(slash[1], 10)
        const b = parseInt(slash[2], 10)
        const year = parseInt(slash[3], 10)
        const hourRaw = slash[4] != null ? parseInt(slash[4], 10) : 0
        const minute = slash[5] != null ? parseInt(slash[5], 10) : 0
        const second = slash[6] != null ? parseInt(slash[6], 10) : 0
        const ampm = slash[7] != null ? String(slash[7]).toLowerCase() : null

        if (year >= 1900 && year <= 3000) {
          let hour = Number.isFinite(hourRaw) ? hourRaw : 0
          if (ampm === 'a' || ampm === 'p') {
            hour = hour % 12
            if (ampm === 'p') hour += 12
          }

          const make = (month, day) => new Date(year, month - 1, day, hour, minute, second)
          const isValid = (d, month, day) =>
            d instanceof Date &&
            !Number.isNaN(d.getTime()) &&
            d.getFullYear() === year &&
            d.getMonth() === month - 1 &&
            d.getDate() === day

          const asDdMm = make(b, a)
          const asMmDd = make(a, b)
          const ddmmValid = isValid(asDdMm, b, a)
          const mmddValid = isValid(asMmDd, a, b)

          if (ddmmValid && !mmddValid) return asDdMm
          if (mmddValid && !ddmmValid) return asMmDd
          if (ddmmValid && mmddValid) {
            const now = Date.now()
            const maxFutureMs = 24 * 60 * 60 * 1000 // 1 day
            const ddmmFuture = asDdMm.getTime() > now + maxFutureMs
            const mmddFuture = asMmDd.getTime() > now + maxFutureMs
            if (ddmmFuture && !mmddFuture) return asMmDd
            if (mmddFuture && !ddmmFuture) return asDdMm
            // If both are plausible, default to DD/MM to match backend payload convention.
            return asDdMm
          }
        }
      }

      // ISO / browser-parseable fallback
      const parsed = new Date(raw)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    },
    _pmInitials(name) {
      if (!name) return '—'
      const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2)
      const initials = parts.map((p) => p[0]?.toUpperCase()).join('')
      return initials || '—'
    },
    _pmColorFromKey(key) {
      const palette = ['blue', 'teal', 'purple', 'orange']
      const str = String(key || '')
      let hash = 0
      for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
      return palette[hash % palette.length]
    },
    _statusColorFromKey(key) {
      const k = String(key || '')
        .trim()
        .toLowerCase()
      if (k === 'rejected' || k === 'cancelled') return 'var(--red)'
      if (k === 'pending_approval' || k === 'on_hold') return 'var(--orange)'
      if (k === 'active') return 'var(--blue)'
      if (k === 'closed') return 'var(--green)'
      if (k === 'approved' || k === 'completed') return 'var(--lime)'
      return '#6b7280'
    },
    _formatTypedStatusLabel(entityType, label) {
      const entity = String(entityType || '')
        .trim()
        .toLowerCase()
      const rawLabel = String(label || '').trim()
      if (!rawLabel) return ''
      const prefixByEntity = {
        project: 'Project',
        phase: 'Phase',
        revplan: 'Rev Plan',
      }
      const prefix = prefixByEntity[entity] || ''
      if (!prefix) return rawLabel
      if (rawLabel.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)) return rawLabel
      return `${prefix}: ${rawLabel}`
    },
    _normalizeStatusObject(status, { fallbackKey = null, fallbackLabel = null } = {}) {
      const obj = status && typeof status === 'object' ? status : null
      const id = obj?.id != null ? String(obj.id) : null
      const key = obj?.key != null ? String(obj.key) : fallbackKey
      const label = obj?.label != null ? String(obj.label) : fallbackLabel
      if (!id && !key && !label) return null
      return { id, key, label }
    },
    _normalizeProjectStatus(source) {
      const status = this._normalizeStatusObject(source?.status, {
        fallbackKey: null,
        fallbackLabel: null,
      })
      if (status?.label) status.label = this._formatTypedStatusLabel('project', status.label)
      return status
    },
    _normalizeRevPlanStatus(source) {
      const revPlanStatusRaw =
        source?.revPlanStatus && typeof source.revPlanStatus === 'object'
          ? source.revPlanStatus
          : null
      const status = this._normalizeStatusObject(revPlanStatusRaw, {
        fallbackKey: null,
        fallbackLabel: null,
      })
      if (status?.label) status.label = this._formatTypedStatusLabel('revplan', status.label)
      return status
    },
    _formatDisplayDate(value) {
      if (!value) return null
      const parsed = this._parseDateAny(value)
      if (!parsed) return String(value)
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
        .format(parsed)
        .replace(',', '')
    },
    _formatDisplayDateTime(value) {
      if (!value) return null
      const parsed = this._parseDateAny(value)
      if (!parsed) return String(value)
      const date = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      })
        .format(parsed)
        .replace(',', '')
      const time = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(parsed)
      return `${date}, ${time}`
    },
    _formatCurrency(value) {
      const num = Number(value)
      if (!Number.isFinite(num) || num === 0) return null
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num)
      } catch (e) {
        return String(num.toFixed(2))
      }
    },
    ensureHandlerUrl() {
      if (
        !this.handlerUrl &&
        typeof import.meta !== 'undefined' &&
        import.meta.env?.DEV &&
        import.meta.env?.VITE_PM_PROJECT_PHASE_HANDLER_URL
      ) {
        this.handlerUrl = String(import.meta.env.VITE_PM_PROJECT_PHASE_HANDLER_URL || '')
      }
      if (
        !this.handlerUrl &&
        typeof window !== 'undefined' &&
        window.PM_PROJECT_PHASE_HANDLER_URL
      ) {
        this.handlerUrl = window.PM_PROJECT_PHASE_HANDLER_URL
      }
      return this.handlerUrl
    },
    invalidateProjectRevPlansCache(projectId) {
      const pid = String(projectId || '').trim()
      if (!pid) return
      this.projectRevPlansFetchedAtByProject[pid] = 0
      delete this.backendMonthsByProject[pid]
      delete this.revenueRowsByProject[pid]
      delete this.revenueSummaryByProject[pid]
      delete this.projectRevPlansMetaByProject[pid]
    },
    addPhase(projectId, phase) {
      if (!this.phasesByProject[projectId]) this.phasesByProject[projectId] = []
      this.phasesByProject[projectId].push(phase)
    },
    setProjectPhases(projectId, phases) {
      if (!projectId) return
      this.phasesByProject[String(projectId)] = Array.isArray(phases) ? phases : []
      this.projectPhasesFetchedAtByProject[String(projectId)] = Date.now()
    },
    setProjectLoad(projectId, load) {
      if (!projectId) return
      const pid = String(projectId)
      const safe = load && typeof load === 'object' ? load : null
      this.projectLoadByProject[pid] = safe
      this.projectLoadFetchedAtByProject[pid] = Date.now()
    },
    updatePhase(projectId, phaseId, updates) {
      const phases = this.phasesByProject[projectId]
      if (!phases) return
      const index = phases.findIndex((item) => item.id === phaseId)
      if (index === -1) return
      phases[index] = { ...phases[index], ...updates }
    },
    setRevenueRows(projectId, rows) {
      if (!projectId) return
      const safeRows = Array.isArray(rows)
        ? rows.map((row) => ({
            ...row,
            contingency: Number(row?.contingency || 0),
            months: { ...(row?.months || {}) },
          }))
        : []
      this.revenueRowsByProject[projectId] = safeRows
    },
    setHandlerUrl(url) {
      this.handlerUrl = url || ''
    },
    _mapProjectRows(rows) {
      return (Array.isArray(rows) ? rows : []).map((p) => {
        const pmName = p?.projectManagerName || null
        const pmInitials = this._pmInitials(pmName)
        const pmColor = this._pmColorFromKey(p?.projectManagerId || pmName || p?.id)
        const status = this._normalizeProjectStatus(p)
        const revPlanStatus = this._normalizeRevPlanStatus(p)
        const revPlanStatusConflict = Boolean(p?.revPlanStatusConflict)
        const revPlanStatusConflictCount = Number(p?.revPlanStatusConflictCount || 0)
        const revPlanStatusConflicts = Array.isArray(p?.revPlanStatusConflicts)
          ? p.revPlanStatusConflicts
          : []
        const jnlProcTaskId = p?.jnlProcTaskId != null ? String(p.jnlProcTaskId) : null
        const jnlProcLog = p?.jnlProcLog != null ? String(p.jnlProcLog) : null
        const isLockedForJnlProc = Boolean(p?.isLockedForJnlProc) || Boolean(jnlProcTaskId)

        const contractValueRaw = Number(p?.contractValue || 0)
        const invoicedToDateRaw = Number(p?.invoicedToDate || 0)
        const recognizedToDateRaw = Number(p?.recognizedToDate || 0)
        const revenueReadyRaw = Number(p?.revenueReady || 0)
        const recognizedToDatePctRaw = Number(p?.recognizedToDatePct || 0)
        const amountRecognizedPct = Number.isFinite(recognizedToDatePctRaw)
          ? Math.max(0, Math.min(100, Math.round(recognizedToDatePctRaw)))
          : 0

        const contractValueFmt = this._formatCurrency(contractValueRaw)
        const recognizedToDateFmt = this._formatCurrency(recognizedToDateRaw) || '$0.00'
        const amountRecognizedText = contractValueFmt
          ? `${recognizedToDateFmt} / ${contractValueFmt}`
          : recognizedToDateFmt

        return {
          id: String(p?.id || ''),
          ref: p?.ref || '',
          name: p?.title || p?.ref || '',
          description: p?.description || null,
          customerId: p?.customerId != null ? String(p.customerId) : null,
          client: p?.customerName || '-',
          projectManagerId: p?.projectManagerId != null ? String(p.projectManagerId) : null,
          departmentId: p?.departmentId != null ? String(p.departmentId) : null,
          department: p?.department || null,
          status,
          statusColor: this._statusColorFromKey(status?.key),
          pm: pmName || '—',
          pmInitials,
          pmColor,
          poRef: p?.poRef != null ? String(p.poRef) : null,
          lastUpdate: this._formatDisplayDateTime(p?.lastModified) || '—',
          lastJournalPostedDate: this._formatDisplayDate(p?.lastJournalPostedDate) || '—',
          timelineStart: this._formatDisplayDate(p?.startDate),
          timelineEnd: this._formatDisplayDate(p?.endDate),
          startDate: p?.startDate || null,
          endDate: p?.endDate || null,
          estimation: contractValueFmt,
          _contractValueRaw: contractValueRaw,
          invoicedToDate: this._formatCurrency(invoicedToDateRaw) || '$0.00',
          _invoicedToDateRaw: invoicedToDateRaw,
          revenueReady: this._formatCurrency(revenueReadyRaw) || '$0.00',
          _revenueReadyRaw: revenueReadyRaw,
          revPlanStatus,
          revPlanStatusConflict,
          revPlanStatusConflictCount,
          revPlanStatusConflicts,
          amountRecognized: recognizedToDateRaw,
          amountRecognizedPct,
          amountRecognizedText,
          isLockedForJnlProc,
          jnlProcTaskId,
          jnlProcLog,
          phases: Number.isFinite(Number(p?.phasesCount)) ? Number(p.phasesCount) : 0,
          resources: null,
        }
      })
    },
    async fetchProjects({ force = false } = {}) {
      const ttlMs = 5 * 60 * 1000
      const hasFreshCache =
        !force && this.projectsFetchedAt && Date.now() - this.projectsFetchedAt < ttlMs

      if (hasFreshCache) return this.projects
      if (this.projectsInFlight) return this.projectsInFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.projectsInFlight = (async () => {
        try {
          const perfNow =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? () => performance.now()
              : () => Date.now()
          const startedAt = perfNow()
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'projects_list' }),
          })
          const afterFetchAt = perfNow()
          const json = await res.json()
          const afterJsonAt = perfNow()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch projects')
          }

          const rows = Array.isArray(json?.data?.projects) ? json.data.projects : []
          this.projects = this._mapProjectRows(rows)
          const finishedAt = perfNow()
          console.info('[PM_TIMING] projects_list FE', {
            totalMs: Math.round(finishedAt - startedAt),
            fetchMs: Math.round(afterFetchAt - startedAt),
            parseJsonMs: Math.round(afterJsonAt - afterFetchAt),
            mapRowsMs: Math.round(finishedAt - afterJsonAt),
            rowsCount: rows.length,
          })
          this.projectsFetchedAt = Date.now()
          return this.projects
        } finally {
          this.projectsInFlight = null
        }
      })()

      return this.projectsInFlight
    },
    async fetchProjectsPaginated({
      page = 1,
      pageSize = 25,
      search = '',
      statusKeys = [],
      sortBy = '',
      sortDir = 'asc',
      customerId = null,
      projectManagerId = null,
      departmentId = null,
      includeRevPlanCounters = false,
      revPlanStatusKeys = [],
      revPlanStatusConflictOnly = false,
    } = {}) {
      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const requestSeq = Number(this.projectsPaginatedRequestSeq || 0) + 1
      this.projectsPaginatedRequestSeq = requestSeq
      this.projectsPaginatedInFlight = (async () => {
        try {
          const body = {
            action: 'projects_list_paginated',
            page,
            pageSize,
            search,
            statusKeys,
            sortBy,
            sortDir,
            customerId,
            projectManagerId,
            departmentId,
            includeRevPlanCounters,
            revPlanStatusKeys,
            revPlanStatusConflictOnly,
          }
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch paginated projects')
          }
          // Ignore stale responses from older queries.
          if (requestSeq < Number(this.projectsPaginatedRequestSeq || 0)) {
            return {
              projects: this.projects,
              pagination: this.projectsPagination,
              statusCounters: this.projectsStatusCounters,
              revPlanStatusCounters: this.projectsRevPlanStatusCounters,
              stale: true,
            }
          }
          const rows = Array.isArray(json?.data?.projects) ? json.data.projects : []
          this.projects = this._mapProjectRows(rows)
          const p = json?.data?.pagination || {}
          this.projectsPagination = {
            page: Number(p.page || page || 1),
            pageSize: Number(p.pageSize || pageSize || 25),
            totalCount: Number(p.totalCount || 0),
            totalPages: Math.max(1, Number(p.totalPages || 1)),
            hasPrev: Boolean(p.hasPrev),
            hasNext: Boolean(p.hasNext),
          }
          const counters = json?.data?.statusCounters
          this.projectsStatusCounters =
            counters && typeof counters === 'object' ? { ...counters } : { all: 0 }
          const revPlanCounters = json?.data?.revPlanStatusCounters
          this.projectsRevPlanStatusCounters =
            revPlanCounters && typeof revPlanCounters === 'object'
              ? { ...revPlanCounters }
              : { all: 0 }
          this.projectsPaginatedAppliedSeq = requestSeq
          this.projectsFetchedAt = Date.now()
          return {
            projects: this.projects,
            pagination: this.projectsPagination,
            statusCounters: this.projectsStatusCounters,
            revPlanStatusCounters: this.projectsRevPlanStatusCounters,
          }
        } finally {
          if (requestSeq >= Number(this.projectsPaginatedRequestSeq || 0)) {
            this.projectsPaginatedInFlight = null
          }
        }
      })()
      return this.projectsPaginatedInFlight
    },
    async fetchInitData({ force = false } = {}) {
      const ttlMs = 5 * 60 * 1000
      const hasFreshCache =
        !force && this.initData.fetchedAt && Date.now() - this.initData.fetchedAt < ttlMs

      if (hasFreshCache) return this.initData
      if (this.initDataInFlight) return this.initDataInFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.initDataInFlight = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'init_data' }),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch init data')
          }

          const data = json.data || {}
          this.initData = {
            user: data.user ?? null,
            authz:
              data.authz && typeof data.authz === 'object'
                ? {
                    roles: Array.isArray(data.authz.roles) ? data.authz.roles : [],
                    capabilities: Array.isArray(data.authz.capabilities)
                      ? data.authz.capabilities
                      : [],
                  }
                : { roles: [], capabilities: [] },
            access: data.access ?? { departments: [] },
            links: data.links && typeof data.links === 'object' ? data.links : {},
            lookups: data.lookups ?? { customers: [], projectManagers: [], departments: [] },
            settings:
              data.settings && typeof data.settings === 'object'
                ? { revRecJournalBulkAsyncThreshold: 5, ...data.settings }
                : { revRecJournalBulkAsyncThreshold: 5 },
            statuses: data.statuses ?? { projects: [], projectPhases: [], revPlans: [] },
            serviceItems: Array.isArray(data.serviceItems) ? data.serviceItems : [],
            fetchedAt: Date.now(),
          }
          this._debugAuthzLog('init_data', {
            user: this.initData.user || null,
            roles: this.initData.authz?.roles || [],
            capabilities: this.initData.authz?.capabilities || [],
          })

          // Populate the project edit dropdown cache from init_data (preferred source).
          const customers = Array.isArray(this.initData?.lookups?.customers)
            ? this.initData.lookups.customers
            : []
          const projectManagers = Array.isArray(this.initData?.lookups?.projectManagers)
            ? this.initData.lookups.projectManagers
            : []
          const departments = Array.isArray(this.initData?.lookups?.departments)
            ? this.initData.lookups.departments
            : []
          this.projectEditLookups = {
            customers,
            projectManagers,
            departments,
            fetchedAt: Date.now(),
          }

          return this.initData
        } finally {
          this.initDataInFlight = null
        }
      })()

      return this.initDataInFlight
    },
    async fetchProjectEditLookups({ force = false } = {}) {
      const ttlMs = 10 * 60 * 1000
      const hasFreshCache =
        !force &&
        this.projectEditLookups.fetchedAt &&
        Date.now() - this.projectEditLookups.fetchedAt < ttlMs &&
        Array.isArray(this.projectEditLookups.customers) &&
        Array.isArray(this.projectEditLookups.projectManagers) &&
        Array.isArray(this.projectEditLookups.departments)

      if (hasFreshCache) return this.projectEditLookups
      if (this.projectEditLookupsInFlight) return this.projectEditLookupsInFlight

      this.projectEditLookupsInFlight = (async () => {
        try {
          // Preferred source is init_data (single roundtrip & cached).
          await this.fetchInitData({ force })

          const customers = Array.isArray(this.initData?.lookups?.customers)
            ? this.initData.lookups.customers
            : []
          const projectManagers = Array.isArray(this.initData?.lookups?.projectManagers)
            ? this.initData.lookups.projectManagers
            : []
          const departments = Array.isArray(this.initData?.lookups?.departments)
            ? this.initData.lookups.departments
            : []

          this.projectEditLookups = {
            customers,
            projectManagers,
            departments,
            fetchedAt: Date.now(),
          }

          return this.projectEditLookups
        } finally {
          this.projectEditLookupsInFlight = null
        }
      })()

      return this.projectEditLookupsInFlight
    },
    async fetchRbacConfig({ force = false } = {}) {
      const ttlMs = 2 * 60 * 1000
      const hasFreshCache =
        !force && this.rbacConfigFetchedAt && Date.now() - this.rbacConfigFetchedAt < ttlMs

      if (hasFreshCache) return this.rbacConfig
      if (this.rbacConfigInFlight) return this.rbacConfigInFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.rbacConfigInFlight = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rbac_config_snapshot' }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch RBAC config')
          }
          this.rbacConfig = json?.data && typeof json.data === 'object' ? json.data : null
          this.rbacConfigFetchedAt = Date.now()
          return this.rbacConfig
        } finally {
          this.rbacConfigInFlight = null
        }
      })()

      return this.rbacConfigInFlight
    },
    async saveRbacConfig({ config } = {}) {
      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      if (this.saveRbacConfigInFlight) return this.saveRbacConfigInFlight

      this.saveRbacConfigInFlight = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'rbac_config_upsert',
              config: config && typeof config === 'object' ? config : {},
            }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to save RBAC config')
          }
          const snapshot =
            json?.data?.snapshot && typeof json.data.snapshot === 'object' ? json.data.snapshot : null
          this.rbacConfig = snapshot
          this.rbacConfigFetchedAt = Date.now()
          await this.fetchInitData({ force: true }).catch(() => {})
          return json?.data || { saved: true, snapshot }
        } finally {
          this.saveRbacConfigInFlight = null
        }
      })()

      return this.saveRbacConfigInFlight
    },
    async fetchPhaseLookups({ force = false } = {}) {
      return this.fetchPhaseLookupsForProject({ force, projectId: null })
    },
    async fetchPhaseLookupsForProject({ force = false, projectId } = {}) {
      const ttlMs = 5 * 60 * 1000
      const key = projectId ? String(projectId) : 'global'
      const hasFreshCache =
        !force &&
        this.phaseLookups.fetchedAt &&
        Date.now() - this.phaseLookups.fetchedAt < ttlMs &&
        String(this.phaseLookups.projectId || '') === String(projectId || '')

      if (hasFreshCache) return this.phaseLookups
      if (this.phaseLookupsInFlight && this.phaseLookupsInFlightKey === key) {
        return this.phaseLookupsInFlight
      }

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.phaseLookupsInFlightKey = key
      this.phaseLookupsInFlight = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'phase_lookups', projectId: projectId || null }),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch phase lookups')
          }

          const data = json.data || {}
          this.phaseLookups = {
            salesOrders: Array.isArray(data.salesOrders) ? data.salesOrders : [],
            departments: Array.isArray(data.departments) ? data.departments : [],
            milestonesByDept: data.milestonesByDept || {},
            milestones: Array.isArray(data.milestones) ? data.milestones : [],
            fetchedAt: Date.now(),
            projectId: projectId || null,
          }

          return this.phaseLookups
        } finally {
          this.phaseLookupsInFlight = null
          this.phaseLookupsInFlightKey = ''
        }
      })()

      return this.phaseLookupsInFlight
    },
    async fetchProjectPhases({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 5 * 60 * 1000
      const fetchedAt = this.projectPhasesFetchedAtByProject[pid] || 0
      const hasFreshCache = !force && fetchedAt && Date.now() - fetchedAt < ttlMs
      if (hasFreshCache) return this.phasesByProject[pid] || []

      const inFlight = this.projectPhasesInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.projectPhasesInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'project_phases_list', projectId: pid }),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch project phases')
          }

          const rows = Array.isArray(json?.data?.phases) ? json.data.phases : []
          const phases = rows.map((p) => ({
            id: String(p?.id || ''),
            name: p?.name || '',
            sequence: p?.sequence != null ? Number(p.sequence) : 0,
            department: p?.department || null,
            departmentId: p?.departmentId || null,
            status: this._normalizeStatusObject(p?.status, {
              fallbackKey: null,
              fallbackLabel: null,
            }),
            statusId: p?.status?.id ?? null,
            milestone: p?.milestone || null,
            milestoneId: p?.milestoneId || null,
            milestoneDesc: p?.milestoneDesc || null,
            serviceItem: p?.serviceItem || null,
            definedQty: p?.definedQty != null ? Number(p.definedQty) : null,
            rate: p?.rate != null ? Number(p.rate) : null,
            startDate: p?.startDate || null,
            endDate: p?.endDate || null,
            recognizedPct: p?.recognizedPct != null ? Number(p.recognizedPct) : 0,
            revPlansCount: p?.revPlansCount != null ? Number(p.revPlansCount) : 0,
            numOfPlans: p?.numOfPlans != null ? Number(p.numOfPlans) : null,
            numOfMissingPlans: p?.numOfMissingPlans != null ? Number(p.numOfMissingPlans) : null,
            desiredPlansPerPhase:
              p?.desiredPlansPerPhase != null ? Number(p.desiredPlansPerPhase) : null,
            totalActualQty: p?.totalActualQty != null ? Number(p.totalActualQty) : 0,
            totalForecastQty: p?.totalForecastQty != null ? Number(p.totalForecastQty) : 0,
          }))

          this.setProjectPhases(pid, phases)
          return phases
        } finally {
          delete this.projectPhasesInFlightByProject[pid]
        }
      })()

      return this.projectPhasesInFlightByProject[pid]
    },
    async fetchProjectLoad({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 5 * 60 * 1000
      const fetchedAt = this.projectLoadFetchedAtByProject[pid] || 0
      const hasFreshCache = !force && fetchedAt && Date.now() - fetchedAt < ttlMs
      if (hasFreshCache) return this.projectLoadByProject[pid] || null

      const inFlight = this.projectLoadInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.projectLoadInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'project_load', projectId: pid }),
          })
          const json = await res.json().catch(() => ({}))
          if (import.meta?.env?.DEV) {
            console.log('[PM API] project_load response', { projectId: pid, ok: res.ok, json })
          }
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch project load')
          }

          const data = json.data || {}

          // Keep existing per-slice caches in sync for the UI.
          const phases = Array.isArray(data.phases) ? data.phases : []
          this.setProjectPhases(
            pid,
            phases.map((p) => ({
              id: String(p?.id || ''),
              name: p?.name || '',
              department: p?.department || null,
              departmentId: p?.departmentId || null,
              status: this._normalizeStatusObject(p?.status, {
                fallbackKey: null,
                fallbackLabel: null,
              }),
              statusId: p?.status?.id ?? null,
              milestone: p?.milestone || null,
              milestoneId: p?.milestoneId || null,
              milestoneDesc: p?.milestoneDesc || null,
              serviceItem: p?.serviceItem || null,
              definedQty: p?.definedQty != null ? Number(p.definedQty) : null,
              rate: p?.rate != null ? Number(p.rate) : null,
              startDate: p?.startDate || null,
              endDate: p?.endDate || null,
              recognizedPct: p?.recognizedPct != null ? Number(p.recognizedPct) : 0,
              revPlansCount: p?.revPlansCount != null ? Number(p.revPlansCount) : 0,
              numOfPlans: p?.numOfPlans != null ? Number(p.numOfPlans) : null,
              numOfMissingPlans: p?.numOfMissingPlans != null ? Number(p.numOfMissingPlans) : null,
              desiredPlansPerPhase:
                p?.desiredPlansPerPhase != null ? Number(p.desiredPlansPerPhase) : null,
              totalActualQty: p?.totalActualQty != null ? Number(p.totalActualQty) : 0,
              totalForecastQty: p?.totalForecastQty != null ? Number(p.totalForecastQty) : 0,
            })),
          )

          const fin = data.financials || null
          if (fin) {
            this.projectFinancialsByProject[pid] = {
              projectId: pid,
              totals: {
                projectTotal: Number(fin?.totals?.projectTotal || 0),
                soTotal: Number(fin?.totals?.soTotal || 0),
                variance: Number(fin?.totals?.variance || 0),
              },
              milestoneSummary: Array.isArray(fin?.milestoneSummary)
                ? fin.milestoneSummary.map((row) => ({
                    key: row?.key != null ? String(row.key) : '',
                    itemId: row?.itemId != null ? String(row.itemId) : null,
                    label: row?.label || row?.memo || '—',
                    memo: row?.memo || '',
                    phaseTotal: Number(row?.phaseTotal || 0),
                    soTotal: Number(row?.soTotal || 0),
                    revenueAmount: Number(row?.revenueAmount || 0),
                    invoicedAmount: Number(row?.invoicedAmount || 0),
                    variance: Number(row?.variance || 0),
                  }))
                : [],
              fetchedAt: Date.now(),
            }
          }

          this.setProjectLoad(pid, {
            projectId: pid,
            monthSimulation:
              data?.monthSimulation && typeof data.monthSimulation === 'object'
                ? {
                    actual: data?.monthSimulation?.actual || null,
                    appSimulated: data?.monthSimulation?.appSimulated || null,
                    projectSimulated: data?.monthSimulation?.projectSimulated || null,
                    effective: data?.monthSimulation?.effective || null,
                    source: data?.monthSimulation?.source || 'current',
                  }
                : {
                    actual: null,
                    appSimulated: null,
                    projectSimulated: null,
                    effective: null,
                    source: 'current',
                  },
            status: this._normalizeProjectStatus(data),
            hasVariance: Boolean(data?.hasVariance),
            canCreatePhase: Boolean(data?.canCreatePhase),
            restrictExistingPhaseDetailsToRateQty: Boolean(
              data?.restrictExistingPhaseDetailsToRateQty,
            ),
            canCreatePlan: Boolean(data?.canCreatePlan),
            canActivate: Boolean(data?.canActivate),
            canPutOnHold: Boolean(data?.canPutOnHold),
            canMarkComplete: Boolean(data?.canMarkComplete),
            canClose: Boolean(data?.canClose),
            isCompleted: Boolean(data?.isCompleted),
            isClosed: Boolean(data?.isClosed),
            isFrozen: Boolean(data?.isFrozen),
            hasSalesOrder: Boolean(data?.hasSalesOrder),
            relatedRecords: (() => {
              const source =
                (data?.relatedRecords && typeof data.relatedRecords === 'object'
                  ? data.relatedRecords
                  : null) ||
                (data?.financials?.relatedRecords &&
                typeof data.financials.relatedRecords === 'object'
                  ? data.financials.relatedRecords
                  : null) ||
                {}
              const normalizeRows = (rows) =>
                (Array.isArray(rows) ? rows : []).map((row) => ({
                  id: row?.id != null ? String(row.id) : null,
                  tranId: row?.tranId || row?.tranid || '',
                  tranDate: row?.tranDate || row?.trandate || '',
                  isReversal: Boolean(row?.isReversal || row?.is_reversal),
                  isVoided: Boolean(row?.isVoided || row?.is_voided),
                  amount:
                    row?.amount != null && Number.isFinite(Number(row.amount))
                      ? Number(row.amount)
                      : null,
                  appliedAmount:
                    row?.appliedAmount != null && Number.isFinite(Number(row.appliedAmount))
                      ? Number(row.appliedAmount)
                      : null,
                }))
              return {
                salesOrders: normalizeRows(source?.salesOrders),
                invoices: normalizeRows(source?.invoices),
                purchaseOrders: normalizeRows(source?.purchaseOrders),
                vendorBills: normalizeRows(source?.vendorBills),
                inventoryAdjustments: normalizeRows(source?.inventoryAdjustments),
                creditMemos: normalizeRows(source?.creditMemos),
                journals: normalizeRows(source?.journals),
              }
            })(),
            completionCheck:
              data?.completionCheck && typeof data.completionCheck === 'object'
                ? {
                    phaseTotalQty: Number(data?.completionCheck?.phaseTotalQty || 0),
                    actualQtyCompleted: Number(data?.completionCheck?.actualQtyCompleted || 0),
                    qtyMatch: Boolean(data?.completionCheck?.qtyMatch),
                    contractValue: Number(data?.completionCheck?.contractValue || 0),
                    invoicedAmount: Number(data?.completionCheck?.invoicedAmount || 0),
                    amountMatch: Boolean(data?.completionCheck?.amountMatch),
                    grossInvoicedAmount: Number(data?.completionCheck?.grossInvoicedAmount || 0),
                    grossInvoicedAmountMatch: Boolean(
                      data?.completionCheck?.grossInvoicedAmountMatch,
                    ),
                    recognizedAmount: Number(data?.completionCheck?.recognizedAmount || 0),
                    recognizedPct: Number(data?.completionCheck?.recognizedPct || 0),
                    recognizedComplete: Boolean(data?.completionCheck?.recognizedComplete),
                    recognitionJournalId:
                      data?.completionCheck?.recognitionJournalId != null
                        ? String(data.completionCheck.recognitionJournalId)
                        : null,
                    recognitionJournalTranId:
                      data?.completionCheck?.recognitionJournalTranId || null,
                    recognitionJournalDate: data?.completionCheck?.recognitionJournalDate || null,
                  }
                : null,
            statusActions:
              data?.statusActions && typeof data.statusActions === 'object'
                ? {
                    activate: data.statusActions.activate || null,
                    onHold: data.statusActions.onHold || null,
                    complete: data.statusActions.complete || null,
                    close: data.statusActions.close || null,
                  }
                : null,
            numOfPlansToCreate: Number(data?.numOfPlansToCreate || 0),
            canEditRevPlan: Boolean(data?.canEditRevPlan),
            authz:
              data?.authz && typeof data.authz === 'object'
                ? {
                    projectId: data?.authz?.projectId ? String(data.authz.projectId) : pid,
                    capabilities: Array.isArray(data?.authz?.capabilities)
                      ? data.authz.capabilities.filter(Boolean).map(String)
                      : [],
                  }
                : { projectId: pid, capabilities: [] },
            revPlanBanner:
              data?.revPlanBanner && typeof data.revPlanBanner === 'object'
                ? {
                    code: data?.revPlanBanner?.code || null,
                    variant: data?.revPlanBanner?.variant || 'success',
                  }
                : { code: null, variant: 'success' },
            projectBanner:
              data?.projectBanner && typeof data.projectBanner === 'object'
                ? {
                    code: data?.projectBanner?.code || null,
                    variant: data?.projectBanner?.variant || 'info',
                  }
                : { code: null, variant: 'info' },
            planGeneration:
              data?.planGeneration && typeof data.planGeneration === 'object'
                ? {
                    allowed: Boolean(data?.planGeneration?.allowed),
                    message: data?.planGeneration?.message || null,
                    reasons: Array.isArray(data?.planGeneration?.reasons)
                      ? data.planGeneration.reasons.filter(Boolean).map(String)
                      : [],
                    notice:
                      data?.planGeneration?.notice && typeof data.planGeneration.notice === 'object'
                        ? {
                            show: Boolean(data?.planGeneration?.notice?.show),
                            key: data?.planGeneration?.notice?.key || null,
                            message: data?.planGeneration?.notice?.message || null,
                          }
                        : { show: false, key: null, message: null },
                    variance: data?.planGeneration?.variance ?? null,
                    status: this._normalizeProjectStatus(data?.planGeneration || {}),
                    numOfPlansToCreate: Number(data?.planGeneration?.numOfPlansToCreate || 0),
                    totalExistingPlans: Number(data?.planGeneration?.totalExistingPlans || 0),
                    totalMissingPlans: Number(data?.planGeneration?.totalMissingPlans || 0),
                  }
                : {
                    allowed: Boolean(data?.canCreatePlan),
                    message: null,
                    reasons: [],
                    notice: { show: false, key: null, message: null },
                    variance: null,
                    status: this._normalizeProjectStatus(data),
                    numOfPlansToCreate: Number(data?.numOfPlansToCreate || 0),
                    totalExistingPlans: 0,
                    totalMissingPlans: 0,
                  },
            revRecGeneration:
              data?.revRecGeneration && typeof data.revRecGeneration === 'object'
                ? {
                    canGenerateJournal: Boolean(data?.revRecGeneration?.canGenerateJournal),
                    reason: data?.revRecGeneration?.reason || null,
                    requiresForceMissingOpenConfirmation: Boolean(
                      data?.revRecGeneration?.requiresForceMissingOpenConfirmation,
                    ),
                    preview:
                      data?.revRecGeneration?.preview &&
                      typeof data.revRecGeneration.preview === 'object'
                        ? {
                            hasMissingMonths: Boolean(
                              data?.revRecGeneration?.preview?.hasMissingMonths,
                            ),
                            currentReady: Boolean(data?.revRecGeneration?.preview?.currentReady),
                            missingAllReady: Boolean(
                              data?.revRecGeneration?.preview?.missingAllReady,
                            ),
                            missingAnyNotReady: Boolean(
                              data?.revRecGeneration?.preview?.missingAnyNotReady,
                            ),
                            currentAlreadyGenerated: Boolean(
                              data?.revRecGeneration?.preview?.currentAlreadyGenerated,
                            ),
                            currentMonthKey:
                              data?.revRecGeneration?.preview?.currentMonthKey || null,
                            hasMissingCompletedJournals: Boolean(
                              data?.revRecGeneration?.preview?.hasMissingCompletedJournals,
                            ),
                            missingCompletedJournalMonthKeys: Array.isArray(
                              data?.revRecGeneration?.preview?.missingCompletedJournalMonthKeys,
                            )
                              ? data.revRecGeneration.preview.missingCompletedJournalMonthKeys
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                            missingCompletedJournalMonthLabels: Array.isArray(
                              data?.revRecGeneration?.preview?.missingCompletedJournalMonthLabels,
                            )
                              ? data.revRecGeneration.preview.missingCompletedJournalMonthLabels
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                          }
                        : null,
                    hasMissingCompletedJournals: Boolean(
                      data?.revRecGeneration?.hasMissingCompletedJournals,
                    ),
                    missingCompletedJournalMonthKeys: Array.isArray(
                      data?.revRecGeneration?.missingCompletedJournalMonthKeys,
                    )
                      ? data.revRecGeneration.missingCompletedJournalMonthKeys
                          .filter(Boolean)
                          .map(String)
                      : [],
                    missingCompletedJournalMonthLabels: Array.isArray(
                      data?.revRecGeneration?.missingCompletedJournalMonthLabels,
                    )
                      ? data.revRecGeneration.missingCompletedJournalMonthLabels
                          .filter(Boolean)
                          .map(String)
                      : [],
                    submitToFinanceAction:
                      data?.revRecGeneration?.submitToFinanceAction &&
                      typeof data.revRecGeneration.submitToFinanceAction === 'object'
                        ? {
                            visible: Boolean(data?.revRecGeneration?.submitToFinanceAction?.visible),
                            enabled: Boolean(data?.revRecGeneration?.submitToFinanceAction?.enabled),
                            reason: data?.revRecGeneration?.submitToFinanceAction?.reason || null,
                            targetMonthKeys: Array.isArray(
                              data?.revRecGeneration?.submitToFinanceAction?.targetMonthKeys,
                            )
                              ? data.revRecGeneration.submitToFinanceAction.targetMonthKeys
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                            targetMonthLabels: Array.isArray(
                              data?.revRecGeneration?.submitToFinanceAction?.targetMonthLabels,
                            )
                              ? data.revRecGeneration.submitToFinanceAction.targetMonthLabels
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                            targetsCurrentMonth: Boolean(
                              data?.revRecGeneration?.submitToFinanceAction?.targetsCurrentMonth,
                            ),
                          }
                        : {
                            visible: false,
                            enabled: false,
                            reason: null,
                            targetMonthKeys: [],
                            targetMonthLabels: [],
                            targetsCurrentMonth: false,
                          },
                    generateJournalAction:
                      data?.revRecGeneration?.generateJournalAction &&
                      typeof data.revRecGeneration.generateJournalAction === 'object'
                        ? {
                            visible: Boolean(data?.revRecGeneration?.generateJournalAction?.visible),
                            enabled: Boolean(data?.revRecGeneration?.generateJournalAction?.enabled),
                            reason: data?.revRecGeneration?.generateJournalAction?.reason || null,
                            targetMonthKeys: Array.isArray(
                              data?.revRecGeneration?.generateJournalAction?.targetMonthKeys,
                            )
                              ? data.revRecGeneration.generateJournalAction.targetMonthKeys
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                            targetMonthLabels: Array.isArray(
                              data?.revRecGeneration?.generateJournalAction?.targetMonthLabels,
                            )
                              ? data.revRecGeneration.generateJournalAction.targetMonthLabels
                                  .filter(Boolean)
                                  .map(String)
                              : [],
                            targetsCurrentMonth: Boolean(
                              data?.revRecGeneration?.generateJournalAction?.targetsCurrentMonth,
                            ),
                          }
                        : {
                            visible: false,
                            enabled: false,
                            reason: null,
                            targetMonthKeys: [],
                            targetMonthLabels: [],
                            targetsCurrentMonth: false,
                          },
                  }
                : {
                    canGenerateJournal: false,
                    reason: null,
                    requiresForceMissingOpenConfirmation: false,
                    preview: null,
                    hasMissingCompletedJournals: false,
                    missingCompletedJournalMonthKeys: [],
                    missingCompletedJournalMonthLabels: [],
                    submitToFinanceAction: {
                      visible: false,
                      enabled: false,
                      reason: null,
                      targetMonthKeys: [],
                      targetMonthLabels: [],
                      targetsCurrentMonth: false,
                    },
                    generateJournalAction: {
                      visible: false,
                      enabled: false,
                      reason: null,
                      targetMonthKeys: [],
                      targetMonthLabels: [],
                      targetsCurrentMonth: false,
                    },
                  },
          })
          this._debugAuthzLog('project_load', {
            projectId: pid,
            capabilities: this.projectLoadByProject?.[pid]?.authz?.capabilities || [],
          })

          return this.projectLoadByProject[pid] || null
        } finally {
          delete this.projectLoadInFlightByProject[pid]
        }
      })()

      return this.projectLoadInFlightByProject[pid]
    },
    async updateProjectMonthSimulation({ projectId, simulatedPeriod } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'project_month_simulation_upsert',
          projectId: pid,
          simulatedPeriod: String(simulatedPeriod || '').trim(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to update project month simulation')
      }

      if (json?.data && typeof json.data === 'object') {
        this.setProjectLoad(pid, json.data)
      }
      this.invalidateProjectRevPlansCache(pid)
      await Promise.all([
        this.fetchProjectLoad({ projectId: pid, force: true }).catch(() => {}),
        this.fetchProjectRevPlans({ projectId: pid, force: true }).catch(() => {}),
      ])
      return json?.data || null
    },
    async fetchProjectFinancials({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 5 * 60 * 1000

      const existing = this.projectFinancialsByProject[pid]
      const hasFreshCache = !force && existing?.fetchedAt && Date.now() - existing.fetchedAt < ttlMs
      if (hasFreshCache) return existing

      const inFlight = this.projectFinancialsInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.projectFinancialsInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'project_financials', projectId: pid }),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch project financials')
          }

          const data = json.data || {}
          const totals = data.totals || {}
          const milestoneSummary = Array.isArray(data.milestoneSummary) ? data.milestoneSummary : []

          const normalized = {
            projectId: pid,
            totals: {
              projectTotal: Number(totals.projectTotal || 0),
              soTotal: Number(totals.soTotal || 0),
              variance: Number(totals.variance || 0),
            },
            milestoneSummary: milestoneSummary.map((row) => ({
              key: row?.key != null ? String(row.key) : '',
              itemId: row?.itemId != null ? String(row.itemId) : null,
              label: row?.label || row?.memo || '—',
              memo: row?.memo || '',
              phaseTotal: Number(row?.phaseTotal || 0),
              soTotal: Number(row?.soTotal || 0),
              revenueAmount: Number(row?.revenueAmount || 0),
              invoicedAmount: Number(row?.invoicedAmount || 0),
              variance: Number(row?.variance || 0),
            })),
            fetchedAt: Date.now(),
          }

          this.projectFinancialsByProject[pid] = normalized
          return normalized
        } finally {
          delete this.projectFinancialsInFlightByProject[pid]
        }
      })()

      return this.projectFinancialsInFlightByProject[pid]
    },
    async generateRevPlans({ projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      const inFlight = this.generateRevPlansInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.generateRevPlansInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'generate_rev_plans', projectId: pid }),
          })
          const json = await res.json()
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to generate rev plans')
          }
          // Refresh backend-derived flags & counts after any mutation.
          await this.fetchProjectLoad({ projectId: pid, force: true })
          await this.fetchProjects({ force: true })
          return json.data || { projectId: pid }
        } finally {
          delete this.generateRevPlansInFlightByProject[pid]
        }
      })()

      return this.generateRevPlansInFlightByProject[pid]
    },
    async updateRevenuePlans({ projectId, confirmed, phasesData } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      if (confirmed !== true && confirmed !== false) {
        throw new Error('confirmed must be true/false')
      }

      const rows = Array.isArray(phasesData) ? phasesData : []
      if (!rows.length) throw new Error('phasesData must be a non-empty array')

      const inFlight = this.updateRevenuePlansInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.updateRevenuePlansInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'revplan_update',
              projectId: pid,
              confirmed,
              phasesData: rows,
            }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to update revenue plans')
          }

          await Promise.all([
            this.fetchProjectLoad({ projectId: pid, force: true }),
            this.fetchProjectFinancials({ projectId: pid, force: true }),
            this.fetchProjectRevPlans({ projectId: pid, force: true }),
            this.fetchProjects({ force: true }),
          ])

          return json.data || { projectId: pid }
        } finally {
          delete this.updateRevenuePlansInFlightByProject[pid]
        }
      })()

      return this.updateRevenuePlansInFlightByProject[pid]
    },
    async reopenActualRevenuePlans({ projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      const inFlight = this.reopenRevPlansInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.reopenRevPlansInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'revplan_reopen', projectId: pid }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to reopen revenue plans')
          }

          await Promise.all([
            this.fetchProjectLoad({ projectId: pid, force: true }),
            this.fetchProjectFinancials({ projectId: pid, force: true }),
            this.fetchProjectRevPlans({ projectId: pid, force: true }),
            this.fetchProjects({ force: true }),
          ])

          return json.data || { projectId: pid }
        } finally {
          delete this.reopenRevPlansInFlightByProject[pid]
        }
      })()

      return this.reopenRevPlansInFlightByProject[pid]
    },
    async fetchRevRecGenerationPreview({ projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rev_rec_generation_preview', projectId: pid }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to preview rev rec generation')
      }
      return json?.data || null
    },
    async fetchRevRecGenerationPreviews({ projectIds } = {}) {
      const ids = Array.isArray(projectIds)
        ? [...new Set(projectIds.map((value) => String(value || '').trim()).filter(Boolean))]
        : []
      if (!ids.length) throw new Error('projectIds is required')

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rev_rec_generation_previews', projectIds: ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to preview rev rec generation')
      }
      return {
        previews: Array.isArray(json?.data?.previews) ? json.data.previews : [],
        blocked: Array.isArray(json?.data?.blocked) ? json.data.blocked : [],
      }
    },
    async generateRevRecJournal({ projectId, mode = 'auto', forceMissingOpen = false } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      const inFlight = this.generateRevRecJournalInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.generateRevRecJournalInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_rev_rec_journal',
              projectId: pid,
              mode,
              forceMissingOpen: Boolean(forceMissingOpen),
            }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            const baseMessage = json?.error?.message || 'Failed to generate rev rec journal'
            const detailMessage = String(json?.error?.details?.message || '').trim()
            throw new Error(detailMessage ? `${baseMessage} ${detailMessage}` : baseMessage)
          }

          await Promise.all([
            this.fetchProjectLoad({ projectId: pid, force: true }),
            this.fetchProjectRevPlans({ projectId: pid, force: true }),
            this.fetchProjectFinancials({ projectId: pid, force: true }),
            this.fetchProjects({ force: true }),
          ])

          return json.data || { projectId: pid }
        } finally {
          delete this.generateRevRecJournalInFlightByProject[pid]
        }
      })()

      return this.generateRevRecJournalInFlightByProject[pid]
    },
    async generateRevRecJournals({ projectIds, mode = 'auto', forceMissingOpen = false } = {}) {
      const ids = Array.isArray(projectIds)
        ? [...new Set(projectIds.map((value) => String(value || '').trim()).filter(Boolean))]
        : []
      if (!ids.length) throw new Error('projectIds is required')

      if (this.generateRevRecJournalsInFlight) return this.generateRevRecJournalsInFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.generateRevRecJournalsInFlight = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_rev_rec_journals',
              projectIds: ids,
              mode,
              forceMissingOpen: Boolean(forceMissingOpen),
            }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            const baseMessage = json?.error?.message || 'Failed to generate rev rec journals'
            const blocked = Array.isArray(json?.error?.details?.blocked)
              ? json.error.details.blocked
              : []
            const firstBlockedMessage = String(blocked?.[0]?.message || '').trim()
            const firstBlockedProjectId = String(blocked?.[0]?.projectId || '').trim()
            const suffix = firstBlockedMessage
              ? ` First blocked project${firstBlockedProjectId ? ` (${firstBlockedProjectId})` : ''}: ${firstBlockedMessage}`
              : ''
            throw new Error(`${baseMessage}${suffix}`)
          }

          await Promise.all([
            this.fetchProjects({ force: true }),
            ...ids.map((pid) =>
              this.fetchProjectLoad({ projectId: pid, force: true }).catch(() => null),
            ),
          ])

          return json.data || { mode: 'sync', results: [] }
        } finally {
          this.generateRevRecJournalsInFlight = null
        }
      })()

      return this.generateRevRecJournalsInFlight
    },
    async activateProject({ projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)

      const inFlight = this.activateProjectInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.activateProjectInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'project_activate', projectId: pid }),
          })
          const json = await res.json().catch(() => ({}))
          if (import.meta?.env?.DEV) {
            console.log('[PM API] project_activate response', { projectId: pid, ok: res.ok, json })
          }
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to activate project')
          }

          await this.fetchProjectLoad({ projectId: pid, force: true })
          await this.fetchProjects({ force: true })
          return json.data || { projectId: pid }
        } finally {
          delete this.activateProjectInFlightByProject[pid]
        }
      })()

      return this.activateProjectInFlightByProject[pid]
    },
    async transitionProjectStatus({ projectId, transition } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const transitionKey = String(transition || '')
        .trim()
        .toLowerCase()
      if (!transitionKey) throw new Error('transition is required')

      const token = `${pid}:${transitionKey}`
      const inFlight = this.projectStatusTransitionInFlightByProject[token]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      this.projectStatusTransitionInFlightByProject[token] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'project_status_transition',
              projectId: pid,
              transition: transitionKey,
            }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to update project status')
          }

          await Promise.all([
            this.fetchProjectLoad({ projectId: pid, force: true }),
            this.fetchProjects({ force: true }),
          ])
          return json.data || { projectId: pid }
        } finally {
          delete this.projectStatusTransitionInFlightByProject[token]
        }
      })()

      return this.projectStatusTransitionInFlightByProject[token]
    },
    async upsertProject({ projectId = null, project } = {}) {
      const pid = projectId != null && String(projectId).trim() ? String(projectId) : ''
      const payload = project && typeof project === 'object' ? project : {}

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'project_upsert',
          projectId: pid || null,
          project: payload,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to update project')
      }

      const savedProjectId = json?.data?.projectId != null ? String(json.data.projectId) : pid
      if (!savedProjectId) throw new Error('Project was not saved')

      await this.fetchProjects({ force: true })
      if (pid) {
        await Promise.all([
          this.fetchProjectLoad({ projectId: pid, force: true }),
          this.fetchProjectRevPlans({ projectId: pid, force: true }).catch(() => {}),
        ])
      }

      return json.data || { projectId: savedProjectId }
    },
    async upsertPhase({ projectId, phase } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      if (!phase || typeof phase !== 'object') throw new Error('phase payload is required')

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const action = 'phase_upsert'

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, projectId: pid, phase }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || `${action} failed`)
      }

      // After implementation, backend should return updated project_load; until then, refresh state.
      await this.fetchProjectLoad({ projectId: pid, force: true })
      this.invalidateProjectRevPlansCache(pid)
      await this.fetchProjects({ force: true })
      return json.data
    },
    async fetchProjectRevPlans({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 5 * 60 * 1000

      const existingMonths = this.backendMonthsByProject[pid]
      const existingRows = this.revenueRowsByProject[pid]
      const existingMeta = this.projectRevPlansMetaByProject?.[pid] || null
      const hasFreshCache =
        !force &&
        Array.isArray(existingMonths) &&
        existingMonths.length > 0 &&
        Array.isArray(existingRows) &&
        Date.now() - (this.projectRevPlansFetchedAtByProject[pid] || 0) < ttlMs
      if (hasFreshCache) {
        const hasRevPlans =
          typeof existingMeta?.hasRevPlans === 'boolean'
            ? existingMeta.hasRevPlans
            : Boolean(existingRows?.length)
        const monthMismatch =
          typeof existingMeta?.monthMismatch === 'boolean' ? existingMeta.monthMismatch : false
        return {
          months: existingMonths,
          rows: existingRows,
          summary: this.revenueSummaryByProject[pid],
          hasRevPlans,
          monthMismatch,
          isPostJournalState: Boolean(existingMeta?.isPostJournalState),
          hasActualOpenOrReadyUpToCurrentMonth: Boolean(
            existingMeta?.hasActualOpenOrReadyUpToCurrentMonth,
          ),
          planStatusById:
            existingMeta?.planStatusById && typeof existingMeta.planStatusById === 'object'
              ? existingMeta.planStatusById
              : {},
          revPlanStatus: existingMeta?.revPlanStatus ?? null,
          revPlanStatusMonthKey: existingMeta?.revPlanStatusMonthKey ?? null,
          revPlanStatusConflict: Boolean(existingMeta?.revPlanStatusConflict),
          revPlanStatusConflictCount: Number(existingMeta?.revPlanStatusConflictCount || 0),
          revPlanStatusConflicts: Array.isArray(existingMeta?.revPlanStatusConflicts)
            ? existingMeta.revPlanStatusConflicts
            : [],
        }
      }
      if (!force && this.projectRevPlansInFlightByProject[pid])
        return this.projectRevPlansInFlightByProject[pid]

      this.projectRevPlansInFlightByProject[pid] = (async () => {
        this.ensureHandlerUrl()
        if (!this.handlerUrl) {
          throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
        }

        const res = await fetch(this.handlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'project_rev_plans', projectId: pid }),
        })
        const json = await res.json().catch(() => ({}))
        if (import.meta?.env?.DEV) {
          console.log('[PM API] project_rev_plans response', { projectId: pid, ok: res.ok, json })
        }
        if (!res.ok || !json?.success) {
          throw new Error(json?.error?.message || 'Failed to fetch project rev plans')
        }

        const data = json.data || {}
        const months = Array.isArray(data.months) ? data.months : []
        const rows = Array.isArray(data.rows) ? data.rows : []
        const summary = data.summary && typeof data.summary === 'object' ? data.summary : {}
        const recognizedByDepartment = Array.isArray(data?.recognizedByDepartment)
          ? data.recognizedByDepartment
          : []
        const recognizedByPhase = Array.isArray(data?.recognizedByPhase)
          ? data.recognizedByPhase
          : []
        const monthMismatch = Boolean(data?.monthMismatch)
        const hasRevPlans = Boolean(data?.hasRevPlans)
        const revPlanStatus = this._normalizeRevPlanStatus(data)
        const revPlanStatusMonthKey =
          data?.revPlanStatusMonthKey != null ? String(data.revPlanStatusMonthKey) : null
        const revPlanStatusConflict = Boolean(data?.revPlanStatusConflict)
        const revPlanStatusConflictCount = Number(data?.revPlanStatusConflictCount || 0)
        const revPlanStatusConflicts = Array.isArray(data?.revPlanStatusConflicts)
          ? data.revPlanStatusConflicts
          : []
        const isPostJournalState = Boolean(data?.isPostJournalState)
        const hasActualOpenOrReadyUpToCurrentMonth = Boolean(
          data?.hasActualOpenOrReadyUpToCurrentMonth,
        )
        const planStatusByIdRaw =
          data?.planStatusById && typeof data.planStatusById === 'object' ? data.planStatusById : {}
        const planStatusById = Object.fromEntries(
          Object.entries(planStatusByIdRaw).map(([planId, entry]) => {
            const statusObj =
              entry?.status && typeof entry.status === 'object' ? entry.status : null
            const normalizedStatus = statusObj
              ? {
                  ...statusObj,
                  label: this._formatTypedStatusLabel('revplan', statusObj.label || ''),
                }
              : null
            return [
              planId,
              {
                ...(entry || {}),
                ...(normalizedStatus ? { status: normalizedStatus } : {}),
              },
            ]
          }),
        )

        this.backendMonthsByProject[pid] = months
        this.setRevenueRows(pid, rows)
        this.revenueSummaryByProject[pid] = {
          totalAmount: Number(summary.totalAmount || 0),
          billedToDate: Number(summary.billedToDate || 0),
          recognizedToDate: Number(summary.recognizedToDate || 0),
          remaining: Number(summary.remaining || 0),
          subcontractorCost: Number(summary.subcontractorCost || 0),
          materialCost: Number(summary.materialCost || 0),
          recognizedByDepartment: recognizedByDepartment
            .map((row) => ({
              departmentId: row?.departmentId != null ? String(row.departmentId) : null,
              department: row?.department || 'Unassigned',
              recognizedToDate: Number(row?.recognizedToDate || 0),
            }))
            .sort((a, b) => String(a.department || '').localeCompare(String(b.department || ''))),
          recognizedByPhase: recognizedByPhase
            .map((row) => ({
              phaseId: row?.phaseId != null ? String(row.phaseId) : null,
              phase: row?.phase || 'Unassigned',
              recognizedToDate: Number(row?.recognizedToDate || 0),
            }))
            .sort((a, b) => String(a.phase || '').localeCompare(String(b.phase || ''))),
        }
        this.projectRevPlansMetaByProject[pid] = {
          projectId: pid,
          fetchedAt: Date.now(),
          hasRevPlans,
          monthMismatch,
          isPostJournalState,
          hasActualOpenOrReadyUpToCurrentMonth,
          planStatusById,
          revPlanStatus,
          revPlanStatusMonthKey,
          revPlanStatusConflict,
          revPlanStatusConflictCount,
          revPlanStatusConflicts,
        }
        this.projectRevPlansFetchedAtByProject[pid] = Date.now()

        const projectIndex = this.projects.findIndex((p) => String(p?.id || '') === pid)
        if (projectIndex !== -1) {
          this.projects[projectIndex] = {
            ...this.projects[projectIndex],
            monthMismatch,
            hasRevPlans,
            revPlanStatusConflict,
            revPlanStatusConflictCount,
            revPlanStatusConflicts,
            ...(revPlanStatus ? { revPlanStatus } : {}),
            ...(revPlanStatusMonthKey ? { revPlanStatusMonthKey } : {}),
          }
        }

        return {
          months,
          rows,
          summary: this.revenueSummaryByProject[pid],
          hasRevPlans,
          monthMismatch,
          isPostJournalState,
          hasActualOpenOrReadyUpToCurrentMonth,
          planStatusById,
          revPlanStatus,
          revPlanStatusMonthKey,
          revPlanStatusConflict,
          revPlanStatusConflictCount,
          revPlanStatusConflicts,
        }
      })()

      try {
        return await this.projectRevPlansInFlightByProject[pid]
      } finally {
        this.projectRevPlansInFlightByProject[pid] = null
      }
    },
    async upsertPhases({ projectId, phases } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const rows = Array.isArray(phases) ? phases : []
      if (!rows.length) return { projectId: pid, phases: [] }

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'phases_upsert', projectId: pid, phases: rows }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'phases_upsert failed')
      }

      const backendErrors = Array.isArray(json?.data?.errors) ? json.data.errors : []
      if (backendErrors.length) {
        const messages = backendErrors.map((entry, index) => {
          const phaseName = String(
            entry?.phase?.name || entry?.phase?.phaseName || entry?.phase?.milestoneDesc || '',
          ).trim()
          const prefix = phaseName ? `"${phaseName}"` : `Row ${index + 1}`
          return `${prefix}: ${entry?.message || 'Unknown error'}`
        })
        throw new Error(`Failed to save phase changes:\n${messages.join('\n')}`)
      }

      await this.fetchProjectLoad({ projectId: pid, force: true })
      this.invalidateProjectRevPlansCache(pid)
      await this.fetchProjects({ force: true })
      return json.data
    },
    async deletePhase({ projectId, phaseId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      if (!phaseId) throw new Error('phaseId is required')
      const pid = String(projectId)
      const phid = String(phaseId)

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set (ProjectPhase handler suitelet URL)')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'phase_delete', projectId: pid, phaseId: phid }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'phase_delete failed')
      }

      await this.fetchProjectLoad({ projectId: pid, force: true })
      this.invalidateProjectRevPlansCache(pid)
      await this.fetchProjects({ force: true })
      return json.data
    },

    // ── Document actions ──────────────────────────────────────────────────────

    _normalizeDoc(d) {
      return {
        id: String(d?.id || ''),
        name: d?.name || '',
        size: Number(d?.size || 0),
        mimeType: d?.mimeType || '',
        uploadedAt: d?.uploadedAt || '',
        uploadedByName: d?.uploadedByName || '',
        url: d?.url || '',
      }
    },

    async fetchProjectDocuments({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 5 * 60 * 1000
      const fetchedAt = this.documentsFetchedAtByProject[pid] || 0
      const hasFreshCache = !force && fetchedAt && Date.now() - fetchedAt < ttlMs
      if (hasFreshCache) return this.documentsByProject[pid] || {}

      const inFlight = this.documentsInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set')
      }

      this.documentsInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'project_documents_list', projectId: pid }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch project documents')
          }

          const data = json.data || {}
          const docs = Array.isArray(data.docs) ? data.docs.map(this._normalizeDoc) : []
          const result = {
            docs,
            canManage: Boolean(data.canManage),
          }
          this.documentsByProject[pid] = result
          this.documentsFetchedAtByProject[pid] = Date.now()
          return result
        } finally {
          delete this.documentsInFlightByProject[pid]
        }
      })()

      return this.documentsInFlightByProject[pid]
    },

    async uploadProjectDocument({ projectId, file } = {}) {
      if (!projectId) throw new Error('projectId is required')
      if (!file) throw new Error('file is required')
      const pid = String(projectId)

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set')
      }

      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl)
        }
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
        reader.readAsDataURL(file)
      })

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'project_document_upload',
          projectId: pid,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          fileContent,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || `Failed to upload "${file.name}"`)
      }

      // Invalidate cache so next fetch is fresh
      this.documentsFetchedAtByProject[pid] = 0
      return json.data || {}
    },

    async uploadProjectDocuments({
      projectId,
      files,
      existingCount = 0,
      uploadingIndexRef = null,
    } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const staged = Array.isArray(files) ? files.filter(Boolean) : []
      if (!staged.length) return { uploaded: 0, failed: 0 }

      const baseCount = Math.max(0, parseInt(String(existingCount || 0), 10) || 0)
      if (baseCount + staged.length > MAX_PROJECT_DOCUMENTS) {
        throw new Error(`Maximum of ${MAX_PROJECT_DOCUMENTS} documents allowed per project.`)
      }

      let failed = 0
      for (let i = 0; i < staged.length; i++) {
        if (uploadingIndexRef && typeof uploadingIndexRef === 'object') {
          uploadingIndexRef.value = i
        }
        try {
          await this.uploadProjectDocument({ projectId: pid, file: staged[i] })
        } catch {
          failed++
        }
      }

      if (uploadingIndexRef && typeof uploadingIndexRef === 'object') {
        uploadingIndexRef.value = -1
      }

      return { uploaded: staged.length - failed, failed }
    },

    async deleteProjectDocument({ projectId, fileId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      if (!fileId) throw new Error('fileId is required')
      const pid = String(projectId)

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'project_document_delete',
          projectId: pid,
          fileId: String(fileId),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to delete document')
      }

      // Remove from local cache
      const cached = this.documentsByProject[pid]
      if (cached?.docs) {
        this.documentsByProject[pid] = {
          ...cached,
          docs: cached.docs.filter((d) => String(d.id) !== String(fileId)),
        }
      }
      return json.data || {}
    },

    // ── User notes actions ─────────────────────────────────────────────────────

    _normalizeProjectNote(row) {
      return {
        id: String(row?.id || ''),
        createdAt: row?.createdAt || row?.notedate || '',
        authorId: row?.authorId != null ? String(row.authorId) : '',
        authorName: row?.authorName || row?.author || '',
        title: row?.title || '',
        content: row?.content || row?.note || '',
      }
    },

    async fetchProjectNotes({ force = false, projectId } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const ttlMs = 2 * 60 * 1000
      const fetchedAt = this.notesFetchedAtByProject[pid] || 0
      const hasFreshCache = !force && fetchedAt && Date.now() - fetchedAt < ttlMs
      if (hasFreshCache) return this.notesByProject[pid] || { notes: [] }

      const inFlight = this.notesInFlightByProject[pid]
      if (inFlight) return inFlight

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set')
      }

      this.notesInFlightByProject[pid] = (async () => {
        try {
          const res = await fetch(this.handlerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'project_notes_list', projectId: pid }),
          })
          const json = await res.json().catch(() => ({}))
          if (!res.ok || !json?.success) {
            throw new Error(json?.error?.message || 'Failed to fetch project notes')
          }

          const data = json.data || {}
          const notes = Array.isArray(data.notes) ? data.notes.map(this._normalizeProjectNote) : []
          const result = { projectId: pid, notes }
          this.notesByProject[pid] = result
          this.notesFetchedAtByProject[pid] = Date.now()
          return result
        } finally {
          delete this.notesInFlightByProject[pid]
        }
      })()

      return this.notesInFlightByProject[pid]
    },

    async createProjectNote({ projectId, title, content } = {}) {
      if (!projectId) throw new Error('projectId is required')
      const pid = String(projectId)
      const safeTitle = String(title || '').trim()
      const safeContent = String(content || '').trim()
      if (!safeTitle) throw new Error('Note title is required')
      if (!safeContent) throw new Error('Note content is required')

      this.ensureHandlerUrl()
      if (!this.handlerUrl) {
        throw new Error('projectsStore.handlerUrl is not set')
      }

      const res = await fetch(this.handlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'project_note_create',
          projectId: pid,
          title: safeTitle,
          content: safeContent,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || 'Failed to create note')
      }

      this.notesFetchedAtByProject[pid] = 0
      return json.data || {}
    },
  },
})
