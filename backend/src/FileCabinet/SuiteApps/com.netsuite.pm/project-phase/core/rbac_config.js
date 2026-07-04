/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/file', 'N/record', 'N/search', './helper'], (
  file,
  record,
  search,
  helper,
) => {
  const { getAllResults, toId } = helper;

  const CONFIG_FOLDER_NAME = 'PM Config';
  const CONFIG_FILE_NAME = 'pm_project_phase_rbac.json';

  let cachedFolderId = '';
  let cachedFileId = '';
  let cachedStoredConfig;

  function clearCache() {
    cachedFolderId = '';
    cachedFileId = '';
    cachedStoredConfig = undefined;
  }

  function findFolderId() {
    if (cachedFolderId) return cachedFolderId;
    try {
      const suiteSearch = search.create({
        type: 'folder',
        filters: [['name', 'is', CONFIG_FOLDER_NAME]],
        columns: [search.createColumn({ name: 'internalid' })],
      });
      const first = getAllResults(suiteSearch)?.[0] || null;
      const found = first ? toId(first.getValue({ name: 'internalid' })) : '';
      if (found) cachedFolderId = found;
    } catch (_e) {
      cachedFolderId = '';
    }
    return cachedFolderId;
  }

  function getOrCreateFolderId() {
    const found = findFolderId();
    if (found) return found;
    const folder = record.create({ type: record.Type.FOLDER });
    folder.setValue({ fieldId: 'name', value: CONFIG_FOLDER_NAME });
    cachedFolderId = String(folder.save());
    return cachedFolderId;
  }

  function findConfigFileId() {
    if (cachedFileId) return cachedFileId;
    try {
      const filters = [['name', 'is', CONFIG_FILE_NAME]];
      const folderId = findFolderId();
      if (folderId) {
        filters.push('AND', ['folder', 'anyof', folderId]);
      }
      const suiteSearch = search.create({
        type: 'file',
        filters,
        columns: [search.createColumn({ name: 'internalid' })],
      });
      const first = getAllResults(suiteSearch)?.[0] || null;
      const found = first ? toId(first.getValue({ name: 'internalid' })) : '';
      if (found) cachedFileId = found;
    } catch (_e) {
      cachedFileId = '';
    }
    return cachedFileId;
  }

  function loadStoredConfig() {
    if (cachedStoredConfig !== undefined) return cachedStoredConfig;
    const fileId = findConfigFileId();
    if (!fileId) {
      cachedStoredConfig = null;
      return cachedStoredConfig;
    }
    try {
      const loaded = file.load({ id: fileId });
      const contents = String(loaded.getContents() || '').trim();
      cachedStoredConfig = contents ? JSON.parse(contents) : null;
    } catch (_e) {
      cachedStoredConfig = null;
    }
    return cachedStoredConfig;
  }

  function saveStoredConfig(config) {
    const folderId = getOrCreateFolderId();
    const contents = JSON.stringify(config || {}, null, 2);
    const existingFileId = findConfigFileId();
    if (existingFileId) {
      const loaded = file.load({ id: existingFileId });
      loaded.folder = Number(folderId);
      loaded.contents = contents;
      const savedId = String(loaded.save());
      cachedFileId = savedId;
      cachedStoredConfig = config || {};
      return savedId;
    }

    const created = file.create({
      name: CONFIG_FILE_NAME,
      fileType: file.Type.PLAINTEXT,
      contents,
      folder: Number(folderId),
      isOnline: false,
    });
    const savedId = String(created.save());
    cachedFileId = savedId;
    cachedStoredConfig = config || {};
    return savedId;
  }

  return {
    CONFIG_FOLDER_NAME,
    CONFIG_FILE_NAME,
    clearCache,
    loadStoredConfig,
    saveStoredConfig,
  };
});
