/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/search", "N/record", "N/log"], (search, record, log) => {
  const USER_NOTE_TYPE_ID = "7";
  const NOTE_DIRECTION_GENERAL = 1;
  const PROJECT_RECORD_SCRIPT_ID = "customrecord_pm_projects";
  const PROJECT_RECORD_TYPE_FALLBACK_ID = 338;

  let cachedProjectRecordTypeId = "";

  function toSafeString(value) {
    return value == null ? "" : String(value).trim();
  }

  function getProjectRecordTypeId() {
    if (cachedProjectRecordTypeId) return cachedProjectRecordTypeId;
    try {
      const suiteSearch = search.create({
        type: search.Type.CUSTOM_RECORD_TYPE,
        filters: [["scriptid", "is", PROJECT_RECORD_SCRIPT_ID]],
        columns: [search.createColumn({ name: "internalid" })],
      });
      const first = suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
      const id = toSafeString(first?.getValue({ name: "internalid" }));
      if (id) {
        cachedProjectRecordTypeId = id;
        return id;
      }
    } catch (e) {
      // fallback below
    }
    cachedProjectRecordTypeId = String(PROJECT_RECORD_TYPE_FALLBACK_ID);
    return cachedProjectRecordTypeId;
  }

  function listProjectNotes({ projectId } = {}) {
    const pid = toSafeString(projectId);
    if (!pid) return { projectId: "", notes: [] };

    const columns = [
      search.createColumn({
        name: "notedate",
        join: "userNotes",
        sort: search.Sort.DESC,
      }),
      search.createColumn({ name: "author", join: "userNotes" }),
      search.createColumn({ name: "title", join: "userNotes" }),
      search.createColumn({ name: "note", join: "userNotes" }),
      search.createColumn({ name: "internalid", join: "userNotes" }),
    ];

    const suiteSearch = search.create({
      type: PROJECT_RECORD_SCRIPT_ID,
      filters: [
        ["internalid", "anyof", pid],
        "AND",
        ["usernotes.notetype", "anyof", USER_NOTE_TYPE_ID],
      ],
      columns,
    });

    const rows = suiteSearch.run().getRange({ start: 0, end: 1000 }) || [];
    const notes = rows
      .map((res) => ({
        id: toSafeString(res.getValue({ name: "internalid", join: "userNotes" })),
        createdAt: toSafeString(res.getValue({ name: "notedate", join: "userNotes" })),
        authorId: toSafeString(res.getValue({ name: "author", join: "userNotes" })),
        authorName: toSafeString(res.getText({ name: "author", join: "userNotes" })),
        title: toSafeString(res.getValue({ name: "title", join: "userNotes" })),
        content: toSafeString(res.getValue({ name: "note", join: "userNotes" })),
      }))
      .filter((row) => row.id);

    return { projectId: pid, notes };
  }

  function createProjectNote({ projectId, title, content } = {}) {
    const pid = toSafeString(projectId);
    const safeTitle = toSafeString(title);
    const safeContent = toSafeString(content);
    if (!pid) {
      return {
        success: false,
        statusCode: 400,
        code: "BAD_REQUEST",
        error: "projectId is required.",
      };
    }
    if (!safeTitle) {
      return {
        success: false,
        statusCode: 400,
        code: "BAD_REQUEST",
        error: "title is required.",
      };
    }
    if (!safeContent) {
      return {
        success: false,
        statusCode: 400,
        code: "BAD_REQUEST",
        error: "content is required.",
      };
    }

    try {
      const note = record.create({ type: record.Type.NOTE });
      note.setValue({ fieldId: "title", value: safeTitle.slice(0, 300) });
      note.setValue({ fieldId: "notetype", value: Number(USER_NOTE_TYPE_ID) });
      note.setValue({ fieldId: "direction", value: NOTE_DIRECTION_GENERAL });
      note.setValue({ fieldId: "note", value: safeContent });
      note.setValue({
        fieldId: "recordtype",
        value: Number(getProjectRecordTypeId()),
      });
      note.setValue({ fieldId: "record", value: Number(pid) });
      const noteId = note.save({ enableSourcing: false, ignoreMandatoryFields: false });

      return {
        success: true,
        projectId: pid,
        noteId: toSafeString(noteId),
      };
    } catch (e) {
      log.error({
        title: "CREATE_PROJECT_NOTE_FAILED",
        details: {
          projectId: pid,
          title: safeTitle,
          message: e?.message || String(e),
        },
      });
      return {
        success: false,
        statusCode: 500,
        code: "PROJECT_NOTE_CREATE_FAILED",
        error: e?.message || "Failed to create project note.",
      };
    }
  }

  return {
    listProjectNotes,
    createProjectNote,
  };
});
