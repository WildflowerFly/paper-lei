<script setup lang="ts">
defineProps<{ toast?: string; error?: string }>()
</script>

<template>
  <div role="status" aria-live="polite">
    <div v-if="toast" class="ui-toast">{{ toast }}</div>
  </div>
  <div role="alert">
    <div v-if="error" class="ui-error">
      <span class="ui-error-symbol" aria-hidden="true">!</span><span>{{ error }}</span
      ><slot name="recovery" />
    </div>
  </div>
</template>
