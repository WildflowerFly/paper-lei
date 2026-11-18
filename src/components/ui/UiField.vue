<script setup lang="ts">
import { useId } from 'vue'

defineOptions({ inheritAttrs: false })
defineProps<{ label: string; error?: string }>()
const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <div class="ui-field">
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      v-bind="$attrs"
      v-model="model"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${id}-error` : undefined"
    />
    <span v-if="error" :id="`${id}-error`" class="ui-field-error" role="alert">{{ error }}</span>
  </div>
</template>
