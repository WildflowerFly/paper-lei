<script setup lang="ts">
import { computed, ref, useId } from 'vue'

defineProps<{ text: string }>()
const id = useId()
const hovered = ref(false)
const focused = ref(false)
const dismissed = ref(false)
const visible = computed(() => (hovered.value || focused.value) && !dismissed.value)

function showOnHover() {
  hovered.value = true
  dismissed.value = false
}

function showOnFocus() {
  focused.value = true
  dismissed.value = false
}
</script>

<template>
  <span
    class="ui-tooltip"
    @pointerenter="showOnHover"
    @pointerleave="hovered = false"
    @focusin="showOnFocus"
    @focusout="focused = false"
    @keydown.esc="dismissed = true"
  >
    <slot :described-by="id" />
    <span v-show="visible" :id="id" class="ui-tooltip-content" role="tooltip">{{ text }}</span>
  </span>
</template>
