import ExcelJS from 'exceljs'

const EXCLUDED_HEADERS = new Set(['notes', 'cumm act qty'])

function sanitizeFilename(filename) {
  const safeName = String(filename || '').trim() || 'table-export.xlsx'
  return safeName.toLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`
}

function shouldExcludeColumn(header, index) {
  if (index === 0) return true
  return EXCLUDED_HEADERS.has(String(header || '').trim().toLowerCase())
}

function applyPreferredColumnWidths(worksheet) {
  const headerRow = worksheet.getRow(1)
  if (!headerRow) return

  headerRow.eachCell((cell, colNumber) => {
    const label = String(cell.value ?? '')
      .trim()
      .toLowerCase()
    if (label === 'department') {
      worksheet.getColumn(colNumber).width = 24
      worksheet.getColumn(colNumber).eachCell({ includeEmpty: true }, (colCell) => {
        colCell.alignment = { ...(colCell.alignment || {}), wrapText: true, vertical: 'top' }
      })
    } else if (label === 'phase details') {
      worksheet.getColumn(colNumber).width = 48
      worksheet.getColumn(colNumber).eachCell({ includeEmpty: true }, (colCell) => {
        colCell.alignment = { ...(colCell.alignment || {}), wrapText: true, vertical: 'top' }
      })
    }
  })
}

function downloadWorkbookBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', sanitizeFilename(filename))
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function monthEditable({ row, month, canEditLines, isPostJournalState, planStatusById }) {
  if (!canEditLines) return false

  const type = String(month?.type || '')
    .trim()
    .toLowerCase()
  if (isPostJournalState && type === 'actual') return false
  if (Boolean(month?.isLockedForEdit)) return false

  const key = String(month?.key || '')
  if (!key) return false

  const ids = Array.isArray(row?.planIds?.[key]) ? row.planIds[key].filter(Boolean).map(String) : []
  if (!ids.length) return false

  return !ids.some((id) => Boolean(planStatusById?.[id]?.isLockedForEdit))
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseNumberLike(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return 0
  const num = Number(normalized)
  return Number.isFinite(num) ? num : NaN
}

function readCellText(cellValue) {
  if (cellValue == null) return ''
  if (typeof cellValue === 'object') {
    if (cellValue.text != null) return String(cellValue.text).trim()
    if (cellValue.result != null) return String(cellValue.result).trim()
  }
  return String(cellValue).trim()
}

function isMonthTypeLabel(value) {
  const key = normalizeKey(value)
  return key === 'current' || key === 'actual' || key === 'forecast'
}

function rowLooksLikeData({
  row,
  departmentCol,
  phaseCol,
  contingencyCol,
  monthColByKey,
  monthColumns,
}) {
  const department = departmentCol ? readCellText(row.getCell(departmentCol).value) : ''
  const phase = phaseCol ? readCellText(row.getCell(phaseCol).value) : ''
  if (department || phase) return true

  if (contingencyCol) {
    const contingencyValue = row.getCell(contingencyCol).value
    const parsedContingency = parseNumberLike(
      typeof contingencyValue === 'object' && contingencyValue?.result != null
        ? contingencyValue.result
        : contingencyValue,
    )
    if (Number.isFinite(parsedContingency) && String(readCellText(contingencyValue)).trim() !== '') {
      return true
    }
  }

  return (Array.isArray(monthColumns) ? monthColumns : []).some((month) => {
    const colIndex = monthColByKey.get(String(month?.key || ''))
    if (!colIndex) return false
    const cellValue = row.getCell(colIndex).value
    const parsed = parseNumberLike(
      typeof cellValue === 'object' && cellValue?.result != null ? cellValue.result : cellValue,
    )
    return Number.isFinite(parsed) && String(readCellText(cellValue)).trim() !== ''
  })
}

function buildRevPlanExportMatrix({ rows, monthColumns, canEditLines, isPostJournalState, planStatusById }) {
  const months = Array.isArray(monthColumns) ? monthColumns : []
  const dataRows = Array.isArray(rows) ? rows : []

  const fullHeaders = [
    '',
    'Department',
    'Phase details',
    'Qty',
    'Rate',
    'Total',
    'Notes',
    'Cumm Act Qty',
    'Contingency',
    ...months.map((month) => month?.label || ''),
  ]

  const fullSubHeaders = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ...months.map((month) => month?.statusLabel || ''),
  ]

  const includedIndexes = fullHeaders
    .map((header, idx) => ({ header, idx }))
    .filter(({ header, idx }) => !shouldExcludeColumn(header, idx))
    .map(({ idx }) => idx)

  const exportRows = dataRows.map((row) => {
    const fullValues = [
      '',
      String(row?.department || ''),
      String(row?.phase || ''),
      row?.qty ?? '',
      row?.rate ?? '',
      row?.total ?? '',
      String(row?.notes || ''),
      '',
      Number(row?.contingency || 0),
      ...months.map((month) => {
        const key = String(month?.key || '')
        return key ? Number(row?.months?.[key] || 0) : 0
      }),
    ]

    const fullLocked = [
      true,
      true,
      true,
      true,
      true,
      true,
      !canEditLines,
      true,
      !canEditLines,
      ...months.map((month) =>
        !monthEditable({
          row,
          month,
          canEditLines,
          isPostJournalState,
          planStatusById,
        }),
      ),
    ]

    return includedIndexes.map((idx) => ({ value: fullValues[idx], locked: Boolean(fullLocked[idx]) }))
  })

  const headerRows = [fullHeaders, fullSubHeaders].map((values) =>
    includedIndexes.map((idx) => ({ value: values[idx], locked: true })),
  )

  return [...headerRows, ...exportRows]
}

export async function exportRevPlanXlsx({
  filename = 'table-export.xlsx',
  rows = [],
  monthColumns = [],
  canEditLines = false,
  isPostJournalState = false,
  planStatusById = {},
} = {}) {
  const matrix = buildRevPlanExportMatrix({
    rows,
    monthColumns,
    canEditLines,
    isPostJournalState,
    planStatusById,
  })

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Table')

  matrix.forEach((row, rowIndex) => {
    const values = row.map((cell) => cell.value)
    worksheet.addRow(values)

    row.forEach((cell, colIndex) => {
      const xCell = worksheet.getCell(rowIndex + 1, colIndex + 1)
      xCell.protection = { locked: cell.locked }
      if (cell.locked) {
        xCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE5E7EB' },
        }
      }
    })
  })

  worksheet.views = [
    {
      state: 'frozen',
      xSplit: 2,
      ySplit: 2,
    },
  ]

  applyPreferredColumnWidths(worksheet)
  await worksheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: true,
    formatRows: true,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  })

  const buffer = await workbook.xlsx.writeBuffer()
  downloadWorkbookBuffer(buffer, filename)
}

export function createRevPlanExporter(configRef) {
  return () => exportRevPlanXlsx(configRef())
}

export async function parseRevPlanUploadXlsx({
  file,
  monthColumns = [],
  baseRows = [],
  canEditLines = false,
  isPostJournalState = false,
  planStatusById = {},
} = {}) {
  if (!file) throw new Error('XLSX file is required.')

  const workbook = new ExcelJS.Workbook()
  const arrayBuffer = await file.arrayBuffer()
  await workbook.xlsx.load(arrayBuffer)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('XLSX has no worksheet.')

  const headerValues = worksheet.getRow(1).values || []
  const subHeaderValues = worksheet.getRow(2).values || []
  const headerMap = new Map()
  const maxCols = Math.max(headerValues.length, subHeaderValues.length)

  for (let col = 1; col <= maxCols; col += 1) {
    const header = normalizeKey(readCellText(headerValues[col]))
    if (!header || headerMap.has(header)) continue
    headerMap.set(header, col)
  }

  const departmentCol = headerMap.get('department')
  const phaseCol = headerMap.get('phase details')
  const contingencyCol = headerMap.get('contingency')
  if (!departmentCol || !phaseCol) {
    throw new Error('Template is invalid. Expected "Department" and "Phase details" columns.')
  }

  const months = Array.isArray(monthColumns) ? monthColumns : []
  const monthColByKey = new Map()
  const missingMonthLabels = []
  months.forEach((month) => {
    const labelKey = normalizeKey(month?.label || '')
    if (!labelKey) return
    const colIndex = headerMap.get(labelKey)
    if (!colIndex) {
      missingMonthLabels.push(String(month?.label || ''))
      return
    }
    monthColByKey.set(String(month?.key || ''), colIndex)
  })
  if (missingMonthLabels.length) {
    throw new Error(`Template is missing month columns: ${missingMonthLabels.join(', ')}`)
  }

  const sourceRows = Array.isArray(baseRows) ? baseRows : []
  const baseByKey = new Map()
  const duplicateBaseKeys = new Set()
  sourceRows.forEach((row) => {
    const key = `${normalizeKey(row?.department)}|||${normalizeKey(row?.phase)}`
    if (!key || key === '|||') return
    if (baseByKey.has(key)) {
      duplicateBaseKeys.add(key)
      return
    }
    baseByKey.set(key, row)
  })

  const dataRows = []
  const rowErrors = []
  const monthStatusByKey = new Map(
    months.map((month) => [String(month?.key || ''), normalizeKey(month?.statusLabel || '')]),
  )
  const dataStartRow = rowLooksLikeData({
    row: worksheet.getRow(2),
    departmentCol,
    phaseCol,
    contingencyCol,
    monthColByKey,
    monthColumns: months,
  })
    ? 2
    : 3
  const uploadKeysByRowNumber = new Map()
  const matchedRowEntries = []

  for (let rowNumber = dataStartRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const department = readCellText(row.getCell(departmentCol).value)
    const phase = readCellText(row.getCell(phaseCol).value)
    const hasAnyMonthValue = months.some((month) => {
      const colIndex = monthColByKey.get(String(month?.key || ''))
      if (!colIndex) return false
      return String(readCellText(row.getCell(colIndex).value)).trim() !== ''
    })
    const contingencyRaw = contingencyCol ? readCellText(row.getCell(contingencyCol).value) : ''
    const hasContingencyValue = String(contingencyRaw || '').trim() !== ''
    if (!department && !phase && !hasAnyMonthValue && !hasContingencyValue) continue

    const errors = []
    const rowKey = `${normalizeKey(department)}|||${normalizeKey(phase)}`
    if (!department) errors.push('Department is required.')
    if (!phase) errors.push('Phase details is required.')
    if (duplicateBaseKeys.has(rowKey)) {
      errors.push('Phase mapping is ambiguous in project data.')
    }

    const base = baseByKey.get(rowKey)
    if (!base) continue

    uploadKeysByRowNumber.set(rowNumber, rowKey)
    matchedRowEntries.push({ rowNumber, rowKey })
    const baseContingency = Number(base?.contingency || 0)
    let contingencyValue = baseContingency
    if (contingencyCol) {
      const contingencyCellValue = row.getCell(contingencyCol).value
      const contingencyParsed = parseNumberLike(
        typeof contingencyCellValue === 'object' && contingencyCellValue?.result != null
          ? contingencyCellValue.result
          : contingencyCellValue,
      )
      if (!Number.isFinite(contingencyParsed) || contingencyParsed < 0) {
        errors.push('Contingency must be a number >= 0.')
      } else {
        contingencyValue = contingencyParsed
      }
    }
    if (!canEditLines && contingencyValue !== baseContingency) {
      errors.push('Contingency is locked and cannot be changed.')
    }

    const monthValues = {}
    months.forEach((month) => {
      const monthKey = String(month?.key || '')
      const colIndex = monthColByKey.get(monthKey)
      const cellValue = colIndex ? row.getCell(colIndex).value : ''
      const parsed = parseNumberLike(
        typeof cellValue === 'object' && cellValue?.result != null ? cellValue.result : cellValue,
      )
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push(`Month "${month?.label}" must be a number >= 0.`)
        monthValues[monthKey] = 0
        return
      }
      monthValues[monthKey] = parsed

      const sheetStatus = normalizeKey(readCellText(subHeaderValues[colIndex]))
      const expectedStatus = monthStatusByKey.get(monthKey) || ''
      // Only validate month-type labels. Older/newer exports may contain
      // rev-plan status labels (Open/Rev Rec Ready) in row 2.
      if (
        sheetStatus &&
        expectedStatus &&
        isMonthTypeLabel(sheetStatus) &&
        isMonthTypeLabel(expectedStatus) &&
        sheetStatus !== expectedStatus
      ) {
        errors.push(`Month status mismatch for "${month?.label}".`)
      }

      if (base) {
        const isEditable = monthEditable({
          row: base,
          month,
          canEditLines,
          isPostJournalState,
          planStatusById,
        })
        const baseQty = Number(base?.months?.[monthKey] || 0)
        if (!isEditable && parsed !== baseQty) {
          errors.push(`"${month?.label}" is locked and cannot be changed.`)
        }
        if (isEditable) {
          const idList = Array.isArray(base?.planIds?.[monthKey])
            ? base.planIds[monthKey].filter(Boolean).map(String)
            : []
          if (idList.length !== 1) {
            errors.push(`Unable to resolve revenue plan id for "${month?.label}".`)
          }
        }
      }
    })

    const preview = {
      ...(base || {}),
      department: department || base?.department || '',
      phase: phase || base?.phase || '',
      months: {
        ...(base?.months || {}),
        ...monthValues,
      },
      contingency: contingencyValue,
      uploadErrors: errors,
      _uploadRowNumber: rowNumber,
    }
    dataRows.push(preview)

    if (errors.length) {
      rowErrors.push({
        rowNumber,
        department,
        phase,
        errors,
      })
    }
  }

  const duplicateUploadKeys = new Set()
  const uploadRowCounts = new Map()
  matchedRowEntries.forEach(({ rowKey }) => {
    const count = Number(uploadRowCounts.get(rowKey) || 0) + 1
    uploadRowCounts.set(rowKey, count)
    if (count > 1) duplicateUploadKeys.add(rowKey)
  })

  if (duplicateUploadKeys.size) {
    dataRows.forEach((row) => {
      const rowKey = uploadKeysByRowNumber.get(row._uploadRowNumber)
      if (!rowKey || !duplicateUploadKeys.has(rowKey)) return
      if (!Array.isArray(row.uploadErrors)) row.uploadErrors = []
      if (!row.uploadErrors.includes('Duplicate phase row in upload.')) {
        row.uploadErrors.push('Duplicate phase row in upload.')
      }
    })

    dataRows
      .filter((row) => {
        const rowKey = uploadKeysByRowNumber.get(row._uploadRowNumber)
        return rowKey && duplicateUploadKeys.has(rowKey)
      })
      .forEach((row) => {
        const existing = rowErrors.find((entry) => entry.rowNumber === row._uploadRowNumber)
        if (existing) {
          if (!existing.errors.includes('Duplicate phase row in upload.')) {
            existing.errors.push('Duplicate phase row in upload.')
          }
          return
        }
        rowErrors.push({
          rowNumber: row._uploadRowNumber,
          department: row.department,
          phase: row.phase,
          errors: ['Duplicate phase row in upload.'],
        })
      })
  }

  const validPayload = dataRows
    .filter((row) => !Array.isArray(row.uploadErrors) || !row.uploadErrors.length)
    .map((row) => {
      const phaseId = String(row?.phaseId || '')
      const plans = months
        .filter((month) =>
          monthEditable({
            row,
            month,
            canEditLines,
            isPostJournalState,
            planStatusById,
          }),
        )
        .map((month) => {
          const key = String(month?.key || '')
          const idList = Array.isArray(row?.planIds?.[key])
            ? row.planIds[key].filter(Boolean).map(String)
            : []
          return {
            planId: idList[0],
            quantity: Number(row?.months?.[key] || 0),
          }
        })

      return {
        phaseId,
        plans,
        note: String(row?.notes || ''),
        contingency: Number(row?.contingency || 0),
      }
    })

  return {
    previewRows: dataRows,
    rowErrors,
    missingPhaseRows: [],
    payload: validPayload,
    hasErrors: Boolean(rowErrors.length),
  }
}
