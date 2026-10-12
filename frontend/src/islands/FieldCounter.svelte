<script>
  // `min X` only shows while under the minimum; `current/max` always shows.
  let { value, min = 0, max } = $props();
  const len = $derived(value.length);
</script>

<div class="mt-1 flex items-center justify-end gap-2 text-xs font-normal text-black/40">
  {#if len < min}
    <span class="text-app-orange">min {min}</span>
  {/if}
  <span>{len}/{max}</span>
</div>
