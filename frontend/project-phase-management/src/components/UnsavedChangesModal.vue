<script setup>
import { computed } from 'vue'
import AppModal from '@/components/AppModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: 'Unsaved changes' },
  subtitle: { type: String, default: '' },
  icon: { type: [String, Object, Function], default: 'content-save-alert-outline' },
  variant: { type: String, default: 'warning' },

  secondaryLabel: { type: String, default: 'Continue editing' },
  secondaryVariant: { type: String, default: 'ghost' },
  secondaryDisabled: { type: Boolean, default: false },
  onSecondary: { type: Function, default: null },

  tertiaryLabel: { type: String, default: '' },
  tertiaryVariant: { type: String, default: 'ghost' },
  tertiaryDisabled: { type: Boolean, default: false },
  onTertiary: { type: Function, default: null },

  primaryLabel: { type: String, default: '' },
  primaryVariant: { type: String, default: 'primary' },
  primaryDisabled: { type: Boolean, default: false },
  onPrimary: { type: Function, default: null },

  onClose: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue'])

const actions = computed(() => {
  const out = []
  if (props.secondaryLabel) {
    out.push({
      label: props.secondaryLabel,
      variant: props.secondaryVariant,
      disabled: props.secondaryDisabled,
      onClick: () => props.onSecondary?.(),
    })
  }
  if (props.tertiaryLabel) {
    out.push({
      label: props.tertiaryLabel,
      variant: props.tertiaryVariant,
      disabled: props.tertiaryDisabled,
      onClick: () => props.onTertiary?.(),
    })
  }
  if (props.primaryLabel) {
    out.push({
      label: props.primaryLabel,
      variant: props.primaryVariant,
      disabled: props.primaryDisabled,
      onClick: () => props.onPrimary?.(),
    })
  }
  return out
})

function handleUpdateModelValue(next) {
  emit('update:modelValue', Boolean(next))
  if (!next) props.onClose?.()
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    :icon="icon"
    :variant="variant"
    :actions="actions"
    @update:model-value="handleUpdateModelValue"
  />
</template>
