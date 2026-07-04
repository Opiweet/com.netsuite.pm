/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/record',
  'N/file',
  '../core/helper',
  '../core/user_types',
  '../core/project_meta',
], (search, record, file, helper, user_types, project_meta) => {
  const { getAllResults, toId } = helper;
  const { getProjectPermissionMeta } = project_meta;

  const PROJECT_RECORD_TYPE = 'customrecord_pm_projects';
  const PROJECT_MANAGER_FIELD = 'custrecord_pm_project_manager';
  const DOCS_FOLDER_NAME = 'PM Project Documents';
  const MAX_PROJECT_DOCS = 3;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  // Temporary bypass: allow all users to manage project documents.
  const BYPASS_PROJECT_DOCS_PERMISSION = true;

  const ACCEPTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain',
  ]);

  const MIME_BY_EXT = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
  };

  const FILE_TYPE_BY_EXT = {
    pdf: file.Type.PDF,
    doc: file.Type.WORD,
    docx: file.Type.WORD,
    xls: file.Type.EXCEL,
    xlsx: file.Type.EXCEL,
    png: file.Type.PNGIMAGE,
    jpg: file.Type.JPGIMAGE,
    jpeg: file.Type.JPGIMAGE,
    txt: file.Type.PLAINTEXT,
  };

  let cachedDocsFolderId = null;

  function getNameExtension(name) {
    const base = String(name || '').trim();
    const idx = base.lastIndexOf('.');
    if (idx < 0) return '';
    return base.slice(idx + 1).toLowerCase();
  }

  function formatUploadedAt(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    })
      .format(d)
      .replace(',', '');
  }

  function normalizeFileSize(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const raw = String(value).trim();
    const n = Number(raw);
    if (Number.isFinite(n)) return n;

    const m = raw.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!m) return 0;
    const unit = String(m[2] || '').toUpperCase();
    const base = Number(m[1] || 0);
    if (!Number.isFinite(base)) return 0;
    if (unit === 'GB') return Math.round(base * 1024 * 1024 * 1024);
    if (unit === 'MB') return Math.round(base * 1024 * 1024);
    if (unit === 'KB') return Math.round(base * 1024);
    return Math.round(base);
  }

  function mimeTypeFromName(name) {
    const ext = getNameExtension(name);
    return MIME_BY_EXT[ext] || 'application/octet-stream';
  }

  function normalizeMimeType(mimeType, fileName) {
    const raw = String(mimeType || '')
      .trim()
      .toLowerCase();
    if (raw) return raw;
    return mimeTypeFromName(fileName);
  }

  function resolveFileType(mimeType, fileName) {
    const ext = getNameExtension(fileName);
    if (FILE_TYPE_BY_EXT[ext]) return FILE_TYPE_BY_EXT[ext];

    if (mimeType === 'application/pdf') return file.Type.PDF;
    if (
      mimeType === 'application/msword' ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return file.Type.WORD;
    }
    if (
      mimeType === 'application/vnd.ms-excel' ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return file.Type.EXCEL;
    }
    if (mimeType === 'image/png') return file.Type.PNGIMAGE;
    if (mimeType === 'image/jpeg') return file.Type.JPGIMAGE;
    if (mimeType === 'text/plain') return file.Type.PLAINTEXT;
    return null;
  }

  function getCurrentUserContext() {
    const types = user_types.getUserTypes() || {};
    const userId = toId(types.userId);
    const roleId = toId(types.roleId);
    const isAdmin = Boolean(types.isAdmin);
    return { userId, roleId, isAdmin };
  }

  function canCurrentUserManageProject(projectId) {
    const user = getCurrentUserContext();
    const projectMeta = getProjectPermissionMeta(projectId);

    if (BYPASS_PROJECT_DOCS_PERMISSION) {
      return {
        canManage: true,
        ...user,
        ...projectMeta,
      };
    }

    const canManage =
      user.isAdmin ||
      (user.userId && projectMeta.projectManagerId
        ? String(user.userId) === String(projectMeta.projectManagerId)
        : false) ||
      (user.userId && projectMeta.createdById
        ? String(user.userId) === String(projectMeta.createdById)
        : false);

    return {
      canManage: Boolean(canManage),
      ...user,
      ...projectMeta,
    };
  }

  function buildFileSearchByAttachedTo(projectId) {
    return search.create({
      type: 'file',
      filters: [['attachedto', 'anyof', String(projectId)]],
      columns: [
        search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
        search.createColumn({ name: 'name' }),
        search.createColumn({ name: 'documentsize' }),
        search.createColumn({ name: 'created' }),
        search.createColumn({ name: 'owner' }),
        search.createColumn({ name: 'url' }),
      ],
    });
  }

  function buildProjectJoinFileSearch(projectId) {
    return search.create({
      type: PROJECT_RECORD_TYPE,
      filters: [['internalid', 'anyof', String(projectId)]],
      columns: [
        search.createColumn({ name: 'internalid', join: 'file' }),
        search.createColumn({ name: 'name', join: 'file' }),
        search.createColumn({ name: 'documentsize', join: 'file' }),
        search.createColumn({ name: 'created', join: 'file' }),
        search.createColumn({ name: 'owner', join: 'file' }),
        search.createColumn({ name: 'url', join: 'file' }),
      ],
    });
  }

  function getAttachedFileRows(projectId) {
    const pid = toId(projectId);
    if (!pid) return [];

    let rows = [];

    try {
      const suiteSearch = buildFileSearchByAttachedTo(pid);
      rows = getAllResults(suiteSearch).map((res) => ({
        id: toId(res.getValue({ name: 'internalid' })),
        name: res.getValue({ name: 'name' }) || '',
        size: res.getValue({ name: 'documentsize' }) || 0,
        created: res.getValue({ name: 'created' }) || '',
        ownerName: res.getText({ name: 'owner' }) || '',
        url: res.getValue({ name: 'url' }) || '',
      }));
    } catch (_e) {
      rows = [];
    }

    if (!rows.length) {
      try {
        const suiteSearch = buildProjectJoinFileSearch(pid);
        rows = getAllResults(suiteSearch).map((res) => ({
          id: toId(res.getValue({ name: 'internalid', join: 'file' })),
          name: res.getValue({ name: 'name', join: 'file' }) || '',
          size: res.getValue({ name: 'documentsize', join: 'file' }) || 0,
          created: res.getValue({ name: 'created', join: 'file' }) || '',
          ownerName: res.getText({ name: 'owner', join: 'file' }) || '',
          url: res.getValue({ name: 'url', join: 'file' }) || '',
        }));
      } catch (_e) {
        rows = [];
      }
    }

    const dedup = {};
    rows.forEach((row) => {
      if (!row?.id) return;
      dedup[String(row.id)] = row;
    });
    return Object.keys(dedup).map((id) => dedup[id]);
  }

  function buildDocPayload(row) {
    const id = toId(row?.id);
    if (!id) return null;

    let loaded = null;
    try {
      loaded = file.load({ id });
    } catch (_e) {
      loaded = null;
    }

    const name = String(loaded?.name || row?.name || '');
    const size =
      loaded?.size != null
        ? Number(loaded.size) || 0
        : normalizeFileSize(row?.size || 0);
    const url = String(loaded?.url || row?.url || '');
    const uploadedAt = formatUploadedAt(row?.created || '');
    const uploadedByName = String(row?.ownerName || '');
    const mimeType = normalizeMimeType('', name);

    return {
      id: String(id),
      name,
      size,
      mimeType,
      uploadedAt,
      uploadedByName,
      base64: '',
      url,
    };
  }

  function listProjectDocuments({ projectId } = {}) {
    const pid = toId(projectId);
    if (!pid) {
      return {
        canManage: false,
        docs: [],
      };
    }

    const access = canCurrentUserManageProject(pid);
    const docs = getAttachedFileRows(pid).map(buildDocPayload).filter(Boolean);

    return {
      canManage: Boolean(access.canManage),
      docs,
    };
  }

  function sanitizeFileName(name) {
    const raw = String(name || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop();
    return String(raw || '').trim() || 'document';
  }

  function getOrCreateDocsFolderId() {
    if (cachedDocsFolderId) return cachedDocsFolderId;

    try {
      const suiteSearch = search.create({
        type: 'folder',
        filters: [['name', 'is', DOCS_FOLDER_NAME]],
        columns: [search.createColumn({ name: 'internalid' })],
      });
      const first = getAllResults(suiteSearch)?.[0] || null;
      const found = first ? toId(first.getValue({ name: 'internalid' })) : '';
      if (found) {
        cachedDocsFolderId = found;
        return cachedDocsFolderId;
      }
    } catch (_e) {
      // fallback to create
    }

    const folder = record.create({ type: record.Type.FOLDER });
    folder.setValue({ fieldId: 'name', value: DOCS_FOLDER_NAME });
    cachedDocsFolderId = String(folder.save());
    return cachedDocsFolderId;
  }

  function ensureUploadAllowed({ projectId, mimeType, fileSize }) {
    const access = canCurrentUserManageProject(projectId);
    if (!access.canManage) {
      return {
        ok: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        message:
          'You do not have permission to upload documents for this project.',
      };
    }

    if (!ACCEPTED_MIME_TYPES.has(String(mimeType || '').toLowerCase())) {
      return {
        ok: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message:
          'Unsupported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT.',
      };
    }

    const size = Number(fileSize || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return {
        ok: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Invalid file size.',
      };
    }
    if (size > MAX_FILE_BYTES) {
      return {
        ok: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'File exceeds the maximum allowed size of 2 MB.',
      };
    }

    const existing = listProjectDocuments({ projectId }).docs || [];
    if (existing.length >= MAX_PROJECT_DOCS) {
      return {
        ok: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Maximum of 3 documents allowed per project.',
      };
    }

    return { ok: true };
  }

  function uploadProjectDocument({
    projectId,
    fileName,
    mimeType,
    fileSize,
    fileContent,
  } = {}) {
    const pid = toId(projectId);
    if (!pid) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        error: 'projectId is required.',
      };
    }
    const content = String(fileContent || '').trim();
    if (!content) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        error: 'fileContent is required.',
      };
    }

    const safeName = sanitizeFileName(fileName);
    const normalizedMimeType = normalizeMimeType(mimeType, safeName);
    const validation = ensureUploadAllowed({
      projectId: pid,
      mimeType: normalizedMimeType,
      fileSize,
    });
    if (!validation.ok) {
      return {
        success: false,
        statusCode: validation.statusCode || 400,
        code: validation.code || 'BAD_REQUEST',
        error: validation.message || 'Upload validation failed.',
      };
    }

    const nsFileType = resolveFileType(normalizedMimeType, safeName);
    if (!nsFileType) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        error:
          'Could not map this file type to a NetSuite file type. Please use a supported extension.',
      };
    }

    try {
      const folderId = getOrCreateDocsFolderId();
      const rec = file.create({
        name: safeName,
        fileType: nsFileType,
        contents: content,
        encoding: file.Encoding.BASE_64,
        folder: Number(folderId),
        isOnline: false,
      });
      const fileId = String(rec.save());

      record.attach({
        record: { type: 'file', id: fileId },
        to: { type: PROJECT_RECORD_TYPE, id: pid },
      });

      const uploaded =
        listProjectDocuments({ projectId: pid }).docs.find(
          (d) => String(d.id) === String(fileId),
        ) || null;

      return {
        success: true,
        fileId,
        name: uploaded?.name || safeName,
        size: uploaded?.size || Number(fileSize || 0),
        mimeType: uploaded?.mimeType || normalizedMimeType,
        uploadedAt: uploaded?.uploadedAt || '',
        uploadedByName: uploaded?.uploadedByName || '',
        base64: '',
        url: uploaded?.url || '',
      };
    } catch (e) {
      return {
        success: false,
        statusCode: 500,
        code: e?.name || 'UPLOAD_FAILED',
        error: e?.message || 'Failed to upload document.',
      };
    }
  }

  function deleteProjectDocument({ projectId, fileId } = {}) {
    const pid = toId(projectId);
    const fid = toId(fileId);
    if (!pid || !fid) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        error: 'projectId and fileId are required.',
      };
    }

    const access = canCurrentUserManageProject(pid);
    if (!access.canManage) {
      return {
        success: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        error: 'You do not have permission to delete this document.',
      };
    }

    const attachedIds = new Set(
      (listProjectDocuments({ projectId: pid }).docs || [])
        .map((d) => toId(d?.id))
        .filter(Boolean),
    );
    if (!attachedIds.has(fid)) {
      return {
        success: false,
        statusCode: 404,
        code: 'NOT_FOUND',
        error: 'Document is not attached to this project.',
      };
    }

    try {
      record.detach({
        record: { type: 'file', id: fid },
        from: { type: PROJECT_RECORD_TYPE, id: pid },
      });
    } catch (_e) {
      // Continue with delete attempt; detached state may already be clean.
    }

    try {
      file.delete({ id: fid });
    } catch (e) {
      return {
        success: false,
        statusCode: 500,
        code: e?.name || 'DELETE_FAILED',
        error: e?.message || 'Failed to delete document.',
      };
    }

    return { success: true };
  }

  return {
    listProjectDocuments,
    uploadProjectDocument,
    deleteProjectDocument,
  };
});
