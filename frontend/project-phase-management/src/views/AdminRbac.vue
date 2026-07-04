<script setup>
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useTopbarStore } from '@/stores/topbar'
import { useToastStore } from '@/stores/toast'
import { useProjectsStore } from '@/stores/projects'
import ActionBtn from '@/components/ActionBtn.vue'
import Select from 'primevue/select'

const topbar = useTopbarStore()
const toast = useToastStore()
const projectsStore = useProjectsStore()

const loading = ref(false)
const saving = ref(false)
const draft = ref(null)
const savedBaseline = ref('')

const snapshot = computed(() => projectsStore.rbacConfig || null)
const roles = computed(() =>
  Array.isArray(snapshot.value?.roles) ? snapshot.value.roles : [],
)
const rolesError = computed(() => snapshot.value?.rolesError || null)
const sortedRoles = computed(() =>
  [...roles.value].sort((a, b) => a.name.localeCompare(b.name)),
)
const capabilitiesCatalog = computed(() =>
  Array.isArray(snapshot.value?.capabilitiesCatalog) ? snapshot.value.capabilitiesCatalog : [],
)
const effectiveConfig = computed(() => snapshot.value?.effective || null)
const defaultsConfig = computed(() => snapshot.value?.defaults || null)
const staticRoleGroups = [
  { key: 'admin', label: 'Administrator Roles' },
  { key: 'salesManager', label: 'Sales Manager Roles' },
  { key: 'finance', label: 'Finance Roles' },
]
const capabilityTemplates = [
  { key: 'operational', label: 'Operational' },
  { key: 'salesManager', label: 'Sales Manager' },
  { key: 'finance', label: 'Finance' },
]

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}))
}

function normalizeDraftConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const rawOverrides =
    source?.roleCapabilityOverrides && typeof source.roleCapabilityOverrides === 'object'
      ? source.roleCapabilityOverrides
      : {}
  const overrides = Object.keys(rawOverrides)
    .map((roleScriptId) => ({
      roleScriptId: String(roleScriptId || '').trim(),
      capabilities: Array.isArray(rawOverrides[roleScriptId])
        ? rawOverrides[roleScriptId].map(String)
        : [],
    }))
    .filter((row) => row.roleScriptId)
    .sort((a, b) => a.roleScriptId.localeCompare(b.roleScriptId))

  return {
    roleGroups: {
      admin: Array.isArray(source?.roleGroups?.admin) ? source.roleGroups.admin.map(String) : [],
      salesManager: Array.isArray(source?.roleGroups?.salesManager)
        ? source.roleGroups.salesManager.map(String)
        : [],
      finance: Array.isArray(source?.roleGroups?.finance)
        ? source.roleGroups.finance.map(String)
        : [],
    },
    staticCapabilities: {
      operational: Array.isArray(source?.staticCapabilities?.operational)
        ? source.staticCapabilities.operational.map(String)
        : [],
      salesManager: Array.isArray(source?.staticCapabilities?.salesManager)
        ? source.staticCapabilities.salesManager.map(String)
        : [],
      finance: Array.isArray(source?.staticCapabilities?.finance)
        ? source.staticCapabilities.finance.map(String)
        : [],
    },
    overrides,
  }
}

function serializeDraft(config) {
  return JSON.stringify(config || {})
}

function buildPayloadFromDraft() {
  const source = draft.value || {}
  const roleCapabilityOverrides = {}
  ;(Array.isArray(source?.overrides) ? source.overrides : []).forEach((row) => {
    const roleScriptId = String(row?.roleScriptId || '').trim()
    if (!roleScriptId) return
    const capabilities = Array.isArray(row?.capabilities)
      ? row.capabilities.map(String).filter(Boolean)
      : []
    if (!capabilities.length) return
    roleCapabilityOverrides[roleScriptId] = capabilities
  })
  return {
    roleGroups: cloneConfig(source.roleGroups || {}),
    staticCapabilities: cloneConfig(source.staticCapabilities || {}),
    roleCapabilityOverrides,
  }
}

function loadDraftFromSnapshot() {
  const config = effectiveConfig.value || defaultsConfig.value || {}
  const normalized = normalizeDraftConfig(config)
  draft.value = normalized
  savedBaseline.value = serializeDraft(normalized)
}

const isDirty = computed(() => serializeDraft(draft.value) !== savedBaseline.value)
const overrideCount = computed(() => Number(draft.value?.overrides?.length || 0))
const managedCapabilityCount = computed(() => capabilitiesCatalog.value.length)



function addRoleToGroup(groupKey) {
  if (!draft.value?.roleGroups?.[groupKey]) return
  draft.value.roleGroups[groupKey].push('')
}

function removeRoleFromGroup(groupKey, index) {
  if (!draft.value?.roleGroups?.[groupKey]) return
  draft.value.roleGroups[groupKey].splice(index, 1)
}

function addOverride() {
  if (!draft.value) return
  draft.value.overrides.push({ roleScriptId: '', capabilities: [] })
}

function removeOverride(index) {
  if (!draft.value) return
  draft.value.overrides.splice(index, 1)
}

function toggleCapability(list, capability) {
  const key = String(capability || '').trim()
  if (!key) return
  const idx = list.indexOf(key)
  if (idx === -1) list.push(key)
  else list.splice(idx, 1)
}

function resetToSaved() {
  loadDraftFromSnapshot()
}

async function loadConfig({ force = false } = {}) {
  loading.value = true
  try {
    await projectsStore.fetchRbacConfig({ force })
    loadDraftFromSnapshot()
  } catch (error) {
    toast.show({
      message: error?.message || 'Failed to load RBAC configuration.',
      variant: 'error',
      durationMs: 10000,
    })
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  if (!draft.value || !isDirty.value) return
  saving.value = true
  try {
    await projectsStore.saveRbacConfig({ config: buildPayloadFromDraft() })
    loadDraftFromSnapshot()
    toast.show({ message: 'RBAC configuration saved.', variant: 'success' })
  } catch (error) {
    toast.show({
      message: error?.message || 'Failed to save RBAC configuration.',
      variant: 'error',
      durationMs: 10000,
    })
  } finally {
    saving.value = false
  }
}

watchEffect(() => {
  topbar.setTopbar({
    title: 'RBAC Admin',
    subtitle: 'Manage role groups, capability templates, and role overrides.',
    actions:
      draft.value
        ? [
            {
              key: 'reset',
              label: 'Reset',
              variant: 'ghost',
              loading: saving.value,
              onClick: resetToSaved,
            },
            {
              key: 'reload',
              label: 'Reload',
              variant: 'ghost',
              loading: loading.value,
              onClick: () => loadConfig({ force: true }),
            },
            {
              key: 'save',
              label: 'Save RBAC',
              variant: 'primary',
              loading: saving.value,
              onClick: saveConfig,
            },
          ]
        : [],
  })
})

onMounted(() => {
  loadConfig({ force: true })
})
</script>

<template>
  <section class="rbac-page">
    <!-- Stats row -->
    <div class="rbac-stats">
      <div class="rbac-stat">
        <i class="mdi mdi-shield-check-outline rbac-stat__icon"></i>
        <div class="rbac-stat__body">
          <div class="rbac-stat__value">{{ managedCapabilityCount }}</div>
          <div class="rbac-stat__label">Capabilities</div>
        </div>
      </div>
      <div class="rbac-stat">
        <i class="mdi mdi-account-key-outline rbac-stat__icon"></i>
        <div class="rbac-stat__body">
          <div class="rbac-stat__value">{{ overrideCount }}</div>
          <div class="rbac-stat__label">Role Overrides</div>
        </div>
      </div>
      <div class="rbac-stat">
        <i class="mdi mdi-account-group-outline rbac-stat__icon"></i>
        <div class="rbac-stat__body">
          <div class="rbac-stat__value">{{ roles.length }}</div>
          <div class="rbac-stat__label">NetSuite Roles Found</div>
        </div>
      </div>
    </div>

    <!-- Loading skeletons -->
    <template v-if="loading && !draft">
      <div class="rbac-skel-grid">
        <div class="sk rbac-sk-card"></div>
        <div class="sk rbac-sk-card"></div>
      </div>
      <div class="sk rbac-sk-card rbac-sk-card--wide"></div>
    </template>

    <template v-else-if="draft">
      <!-- Dirty indicator bar -->
      <div v-if="isDirty" class="rbac-dirty-bar">
        <span class="rbac-dirty-dot"></span>
        You have unsaved changes
        <ActionBtn
          label="Reset"
          variant="ghost"
          :disabled="saving"
          :onClick="resetToSaved"
          class="rbac-dirty-bar__btn"
        />
      </div>

      <!-- Role Groups + Capability Templates -->
      <div class="rbac-grid">
        <article class="rbac-card">
          <div class="rbac-card__head">
            <h2 class="rbac-card__title">Role Groups</h2>
            <p class="rbac-card__sub">
              Classify users as admin, sales manager, or finance by their NetSuite role script ID.
            </p>
            <div v-if="rolesError" class="rbac-roles-error">
              <i class="mdi mdi-alert-circle-outline"></i>
              <span>Could not load NetSuite roles: {{ rolesError }} — enter script IDs manually.</span>
            </div>
          </div>

          <div v-for="group in staticRoleGroups" :key="group.key" class="rbac-section">
            <div class="rbac-section__head">
              <span class="rbac-section__label">{{ group.label }}</span>
              <span class="rbac-pill">{{ draft.roleGroups[group.key].length }}</span>
              <button class="rbac-link" type="button" @click="addRoleToGroup(group.key)">
                <i class="mdi mdi-plus"></i> Add role
              </button>
            </div>

            <div v-if="!draft.roleGroups[group.key].length" class="rbac-inline-empty">
              No roles assigned
            </div>

            <div
              v-for="(roleScriptId, index) in draft.roleGroups[group.key]"
              :key="`${group.key}-${index}`"
              class="rbac-role-row"
            >
              <div class="rbac-role-row__field">
                <Select
                  v-if="sortedRoles.length"
                  v-model="draft.roleGroups[group.key][index]"
                  :options="sortedRoles"
                  option-label="name"
                  option-value="scriptId"
                  placeholder="Select a role…"
                  filter
                  class="form-ctrl"
                />
                <input
                  v-else
                  v-model="draft.roleGroups[group.key][index]"
                  type="text"
                  placeholder="Role script ID…"
                  class="rbac-input form-ctrl"
                />
                <div v-if="!sortedRoles.length && roleScriptId" class="rbac-hint">{{ roleScriptId }}</div>
              </div>
              <button
                class="rbac-remove-btn"
                type="button"
                title="Remove"
                @click="removeRoleFromGroup(group.key, index)"
              >
                <i class="mdi mdi-close"></i>
              </button>
            </div>
          </div>
        </article>

        <article class="rbac-card">
          <div class="rbac-card__head">
            <h2 class="rbac-card__title">Capability Templates</h2>
            <p class="rbac-card__sub">
              Capability sets applied to operational, sales manager, and finance users by default.
            </p>
          </div>

          <div v-for="template in capabilityTemplates" :key="template.key" class="rbac-section">
            <div class="rbac-section__head">
              <span class="rbac-section__label">{{ template.label }}</span>
              <span class="rbac-pill">
                {{ draft.staticCapabilities[template.key].length }}/{{ capabilitiesCatalog.length }}
              </span>
            </div>
            <div class="rbac-cap-grid">
              <label
                v-for="capability in capabilitiesCatalog"
                :key="`${template.key}-${capability}`"
                class="rbac-cap"
                :class="{ 'rbac-cap--on': draft.staticCapabilities[template.key].includes(capability) }"
              >
                <input
                  type="checkbox"
                  class="rbac-cap__native"
                  :checked="draft.staticCapabilities[template.key].includes(capability)"
                  @change="toggleCapability(draft.staticCapabilities[template.key], capability)"
                />
                <i
                  class="mdi rbac-cap__check"
                  :class="
                    draft.staticCapabilities[template.key].includes(capability)
                      ? 'mdi-check-circle'
                      : 'mdi-circle-outline'
                  "
                ></i>
                <span class="rbac-cap__label">{{ capability }}</span>
              </label>
            </div>
          </div>

          <div class="rbac-info-note">
            <i class="mdi mdi-information-outline"></i>
            Administrator users always receive the full capability catalog.
          </div>
        </article>
      </div>

      <!-- Role-Specific Overrides -->
      <article class="rbac-card">
        <div class="rbac-card__head rbac-card__head--row">
          <div>
            <h2 class="rbac-card__title">Role-Specific Overrides</h2>
            <p class="rbac-card__sub">
              Explicit capability grants for specific NetSuite role script IDs.
            </p>
          </div>
          <ActionBtn label="Add override" mdiIcon="mdi-plus" :onClick="addOverride" />
        </div>

        <div v-if="!draft.overrides.length" class="rbac-empty">
          <i class="mdi mdi-lock-open-outline rbac-empty__icon"></i>
          <span>No overrides defined</span>
        </div>

        <div
          v-for="(override, index) in draft.overrides"
          :key="`override-${index}`"
          class="rbac-override"
        >
          <div class="rbac-override__head">
            <div class="rbac-override__field">
              <label class="rbac-field-label">Role</label>
              <Select
                v-if="sortedRoles.length"
                v-model="override.roleScriptId"
                :options="sortedRoles"
                option-label="name"
                option-value="scriptId"
                placeholder="Select a role…"
                filter
                class="form-ctrl"
              />
              <input
                v-else
                v-model="override.roleScriptId"
                type="text"
                placeholder="Role script ID…"
                class="rbac-input form-ctrl"
              />
              <div v-if="!sortedRoles.length && override.roleScriptId" class="rbac-hint">{{ override.roleScriptId }}</div>
            </div>
            <ActionBtn
              label="Remove"
              variant="ghost"
              mdiIcon="mdi-delete-outline"
              :onClick="() => removeOverride(index)"
            />
          </div>
          <div class="rbac-cap-grid">
            <label
              v-for="capability in capabilitiesCatalog"
              :key="`${index}-${capability}`"
              class="rbac-cap"
              :class="{ 'rbac-cap--on': override.capabilities.includes(capability) }"
            >
              <input
                type="checkbox"
                class="rbac-cap__native"
                :checked="override.capabilities.includes(capability)"
                @change="toggleCapability(override.capabilities, capability)"
              />
              <i
                class="mdi rbac-cap__check"
                :class="
                  override.capabilities.includes(capability)
                    ? 'mdi-check-circle'
                    : 'mdi-circle-outline'
                "
              ></i>
              <span class="rbac-cap__label">{{ capability }}</span>
            </label>
          </div>
        </div>
      </article>

      <!-- Runtime Notes -->
      <div class="rbac-info-card">
        <i class="mdi mdi-information-outline rbac-info-card__icon"></i>
        <p class="rbac-info-card__text">
          Role-group mappings and overrides are managed here. The backend still applies name-based
          fallbacks for role names containing <code>admin</code>, <code>finance</code>,
          <code>accounting manager</code>, or <code>accounting director</code>.
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rbac-page {
  display: grid;
  gap: 16px;
  padding-bottom: 32px;
}

/* ── Stats ── */
.rbac-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.rbac-stat {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-1);
  border-radius: 10px;
  padding: 8px 14px;
}

.rbac-stat__icon {
  font-size: 18px;
  color: var(--text);
  opacity: 0.6;
}

.rbac-stat__value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.rbac-stat__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: var(--text);
  opacity: 0.7;
  margin-top: 1px;
}

/* ── Skeletons ── */
.rbac-skel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.rbac-sk-card {
  height: 320px;
  border-radius: 14px;
}

.rbac-sk-card--wide {
  height: 200px;
  border-radius: 14px;
}

/* ── Dirty bar ── */
.rbac-dirty-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid var(--accent-border);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-h);
}

.rbac-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.rbac-dirty-bar__btn {
  margin-left: auto;
}

/* ── Cards ── */
.rbac-card {
  border: 1px solid var(--border-strong);
  background: var(--surface-1);
  border-radius: 14px;
  padding: 20px;
}

.rbac-card__head {
  margin-bottom: 16px;
}

.rbac-card__head--row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.rbac-card__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
}

.rbac-card__sub {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
}

/* ── Grid ── */
.rbac-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 16px;
  align-items: start;
}

/* ── Sections within cards ── */
.rbac-section + .rbac-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-strong);
}

.rbac-section__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.rbac-section__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h);
  flex: 1;
}

.rbac-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  font-size: 10px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.rbac-link {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  transition: opacity 0.14s;
}

.rbac-link:hover {
  opacity: 0.75;
}

.rbac-inline-empty {
  font-size: 12px;
  color: var(--text);
  opacity: 0.6;
  padding: 4px 0;
}

/* ── Role row inputs ── */
.rbac-role-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.rbac-role-row + .rbac-role-row {
  margin-top: 8px;
}

.rbac-role-row__field {
  flex: 1;
  min-width: 0;
}

.rbac-input {
  width: 100%;
  height: 36px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text-h);
  padding: 0 10px;
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.14s;
}

.rbac-input:focus {
  outline: none;
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
}

.rbac-hint {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rbac-remove-btn {
  flex-shrink: 0;
  margin-top: 4px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.14s,
    border-color 0.14s,
    color 0.14s;
}

.rbac-remove-btn:hover {
  background: color-mix(in srgb, var(--red, #d62828) 10%, transparent);
  border-color: color-mix(in srgb, var(--red, #d62828) 40%, transparent);
  color: var(--red, #d62828);
}

.rbac-remove-btn .mdi {
  font-size: 14px;
}

/* ── Capability toggles ── */
.rbac-cap-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.rbac-cap {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  cursor: pointer;
  user-select: none;
  transition:
    background 0.14s,
    border-color 0.14s;
  min-height: 32px;
}

.rbac-cap:hover {
  background: var(--surface-3);
}

.rbac-cap--on {
  background: var(--accent-bg);
  border-color: var(--accent-border);
}

.rbac-cap__native {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.rbac-cap__check {
  font-size: 14px;
  flex-shrink: 0;
  color: var(--text);
  opacity: 0.4;
  transition:
    color 0.14s,
    opacity 0.14s;
}

.rbac-cap--on .rbac-cap__check {
  color: var(--accent);
  opacity: 1;
}

.rbac-cap__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-h);
  line-height: 1.3;
}

/* ── Info note (inside card) ── */
.rbac-info-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-strong);
  font-size: 12px;
  color: var(--text);
}

.rbac-info-note .mdi {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}

/* ── Overrides ── */
.rbac-override {
  padding: 14px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
}

.rbac-override + .rbac-override {
  margin-top: 10px;
}

.rbac-override__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.rbac-override__field {
  flex: 1;
  min-width: 0;
}

.rbac-field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

/* ── Empty state ── */
.rbac-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  color: var(--text);
  font-size: 13px;
  opacity: 0.7;
}

.rbac-empty__icon {
  font-size: 18px;
}

/* ── Info card (runtime notes) ── */
.rbac-info-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
}

.rbac-info-card__icon {
  font-size: 16px;
  color: var(--text);
  opacity: 0.6;
  margin-top: 1px;
  flex-shrink: 0;
}

.rbac-info-card__text {
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  margin: 0;
}

/* ── Roles error notice ── */
.rbac-roles-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--red, #d62828) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red, #d62828) 30%, transparent);
  font-size: 12px;
  color: var(--red, #d62828);
  line-height: 1.5;
}

.rbac-roles-error .mdi {
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}

@media (max-width: 1080px) {
  .rbac-grid,
  .rbac-skel-grid {
    grid-template-columns: 1fr;
  }

  .rbac-cap-grid {
    grid-template-columns: 1fr;
  }
}


</style>
