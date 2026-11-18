<script setup lang="ts">
import { onMounted, useId, useTemplateRef, watch } from 'vue'

defineProps<{ title: string }>()
const open = defineModel<boolean>({ required: true })
const dialog = useTemplateRef('dialog')
const titleId = useId()
let opener: HTMLElement | null = null

function syncDialog() {
  const element = dialog.value
  if (!element) return
  if (open.value && !element.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
  } else if (!open.value && element.open) {
    element.close()
  }
}

function onClose() {
  if (dialog.value?.open) return
  open.value = false
  opener?.focus()
  opener = null
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.checkVisibility({ visibilityProperty: true }),
  )
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) {
    event.preventDefault()
    return
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
}

onMounted(syncDialog)
watch(open, syncDialog, { flush: 'post' })
</script>

<template>
  <dialog
    ref="dialog"
    class="ui-dialog"
    :aria-labelledby="titleId"
    @close="onClose"
    @keydown="trapFocus"
  >
    <h2 :id="titleId">{{ title }}</h2>
    <slot />
    <footer v-if="$slots.actions"><slot name="actions" /></footer>
  </dialog>
</template>
