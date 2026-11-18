<script setup lang="ts">
withDefaults(
  defineProps<{ variant?: 'primary' | 'secondary' | 'danger'; type?: 'button' | 'submit' }>(),
  {
    variant: 'secondary',
    type: 'button',
  },
)
</script>

<template>
  <button class="ui-button" :type="type" :data-variant="variant"><slot /></button>
</template>
