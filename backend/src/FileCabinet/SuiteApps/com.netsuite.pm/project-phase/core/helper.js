/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  let cachedCompanyTimeZone = undefined;

  function getCompanyTimeZone(config) {
    if (cachedCompanyTimeZone !== undefined) return cachedCompanyTimeZone;
    if (!config || typeof config.load !== "function") {
      cachedCompanyTimeZone = null;
      return cachedCompanyTimeZone;
    }
    try {
      const company = config.load({ type: config.Type.COMPANY_INFORMATION });
      cachedCompanyTimeZone = company.getValue({ fieldId: "timezone" }) || null;
    } catch (e) {
      cachedCompanyTimeZone = null;
    }
    return cachedCompanyTimeZone;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function toId(value) {
    if (value == null) return "";
    const text = String(value).trim();
    return text || "";
  }

  function normalizeLower(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function normalizeText(value) {
    return value == null ? "" : String(value).trim();
  }

  function normalizeIdOrNull(value) {
    const raw = normalizeText(value);
    return raw || null;
  }

  function normalizeNumberOrNull(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function getLastHierarchyPart(value) {
    if (!value) return null;
    return String(value).split(":").pop().trim();
  }

  function getAllResults(suiteSearch) {
    const results = [];
    const paged = suiteSearch.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      page.data.forEach((res) => results.push(res));
    });
    return results;
  }

  function safeSetValue(rec, fieldId, value) {
    try {
      rec.setValue({ fieldId, value: value == null ? null : value });
    } catch (e) {
      // ignore missing fields / validation differences between accounts
    }
  }

  function normalizeSalesOrderLabel(value) {
    if (!value) return value;
    return String(value)
      .replace(/^Sales Order\s*#\s*/i, "")
      .trim();
  }

  function parseDateAny(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    const raw = String(value).trim();
    if (!raw) return null;

    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      let day = a;
      let month = b;
      if (a <= 12 && b > 12) {
        day = b;
        month = a;
      }
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateForSQL(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function monthsBetweenInclusive(startDate, endDate) {
    const s = parseDateAny(startDate);
    const e = parseDateAny(endDate);
    if (!s || !e) return 0;
    const diff =
      (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (diff < 0) return 0;
    return diff + 1;
  }

  function getYearMonthInTimeZone(date, timeZone) {
    const d = date instanceof Date ? date : new Date();
    if (!timeZone) return { year: d.getFullYear(), month: d.getMonth() + 1 };
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(d);
      const year = parseInt(
        parts.find((p) => p.type === "year")?.value || "",
        10,
      );
      const month = parseInt(
        parts.find((p) => p.type === "month")?.value || "",
        10,
      );
      if (Number.isFinite(year) && Number.isFinite(month))
        return { year, month };
    } catch (e) {
      // fall back
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function monthKey(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
    return `${String(y)}-${String(m).padStart(2, "0")}`;
  }

  function monthKeyNumberFromKey(key) {
    const raw = String(key || "");
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (month < 1 || month > 12) return null;
    return year * 100 + month;
  }

  function monthToNumber(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const asNum = parseInt(raw, 10);
    if (!isNaN(asNum) && asNum >= 1 && asNum <= 12) return asNum;

    const key = raw.slice(0, 3).toLowerCase();
    const map = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    return map[key] ?? null;
  }

  function monthLabel(year, month) {
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const idx = Number(month) - 1;
    const name = idx >= 0 && idx < names.length ? names[idx] : String(month);
    return `${name} ${String(year)}`;
  }

  function iterateMonthsInclusive(startDate, endDate) {
    const s = parseDateAny(startDate);
    const e = parseDateAny(endDate);
    if (!s || !e) return [];

    const start = new Date(s.getFullYear(), s.getMonth(), 1);
    const end = new Date(e.getFullYear(), e.getMonth(), 1);
    const out = [];

    if (start.getTime() > end.getTime()) return out;

    const cur = new Date(start);
    while (cur.getTime() <= end.getTime()) {
      out.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  function chunkArray(arr, size) {
    const out = [];
    const rows = Array.isArray(arr) ? arr : [];
    const n = Math.max(1, Number(size) || 0);
    for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
    return out;
  }

  function mapIdName(res, idField = "internalid", nameField = "name") {
    return {
      id: res.getValue({ name: idField }),
      name: res.getValue({ name: nameField }),
    };
  }

  function toNumericIdList(ids) {
    const safe = (Array.isArray(ids) ? ids : [])
      .map((v) => String(v ?? "").trim())
      .map((v) => (v.match(/^\d+$/) ? v : ""))
      .filter(Boolean);
    return safe.length ? safe.join(",") : "";
  }

  function runSuiteQLMapped(queryText, queryMod, mapper) {
    try {
      const sql = String(queryText || "").trim();
      if (!sql) return [];
      const rows = runSuiteQLMax({ query: sql }, queryMod) || [];
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const values = r && Array.isArray(r.values) ? r.values : [];
        out.push(mapper(values, r));
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function runSuiteQLMax(queryObj, query) {
    let nextResults = true;
    let startRow = 1;
    let endRow = 5000;
    const maxRows = 5000;
    const limit = 500000;
    let result = [];

    do {
      if (endRow <= limit) {
        let queryByRows = `SELECT * FROM
                (
                    SELECT *, ROWNUM AS RN FROM
                    (
                        ${queryObj.query}
                    )
                )
            WHERE
            ( RN BETWEEN ${startRow} AND ${endRow} )`;

        let resultSet = [];
        try {
          resultSet = query.runSuiteQL({
            //10 units
            query: queryByRows,
          });
        } catch (e) {
          try {
            log.error({ title: "runSuiteQLMax", details: e });
          } catch (_e) {
            // ignore
          }
        }

        let queryResult = resultSet.results;
        if (queryResult.length) {
          result = result.concat(queryResult);

          if (queryResult.length < maxRows) {
            nextResults = false;
          } else {
            startRow = endRow + 1;
            endRow += 5000;
          }
        } else {
          nextResults = false;
        }
      } else {
        nextResults = false;
      }
    } while (nextResults);

    return result;
  }

  return {
    chunkArray,
    formatDateForSQL,
    getAllResults,
    getCompanyTimeZone,
    getLastHierarchyPart,
    getYearMonthInTimeZone,
    iterateMonthsInclusive,
    mapIdName,
    monthKey,
    monthKeyNumberFromKey,
    monthLabel,
    monthToNumber,
    monthsBetweenInclusive,
    normalizeSalesOrderLabel,
    normalizeText,
    normalizeIdOrNull,
    normalizeNumberOrNull,
    normalizeLower,
    parseDateAny,
    safeSetValue,
    toNumber,
    toId,
    toNumericIdList,
    runSuiteQLMax,
    runSuiteQLMapped,
  };
});
