<script>
  // Cards for the current user's projects; selecting one shows
  // ProjectDetail.svelte inline. Selection mirrors up to DashboardRoom via
  // `onProjectSelected` to keep the URL in sync (`?project=<id>`).
  import { apiFetch } from "../../lib/api-client";
  import PopupShell from "./PopupShell.svelte";
  import NewProjectModal from "../NewProjectModal.svelte";
  import ProjectDetail from "./ProjectDetail.svelte";

  let { projects, onClose, initialProjectId = null, onProjectSelected } = $props();

  let items = $state(projects.map((p) => ({ ...p })));
  let selectedId = $state(initialProjectId);

  // `projects` is a one-time SSR snapshot, possibly stale if an upvote
  // happened via Gallery earlier in the session — re-fetch on mount while
  // still rendering the prop immediately rather than a blank state.
  apiFetch("/projects")
    .then((res) => (res.ok ? res.json() : null))
    .then((fresh) => {
      if (fresh) items = fresh;
    })
    .catch(() => {});

  function select(id) {
    selectedId = id;
    onProjectSelected?.(id);
  }

  function onCreated(project) {
    // POST /projects doesn't return upvoteCount — seeded so the card never renders "undefined upvotes".
    items = [{ ...project, upvoteCount: 0 }, ...items];
    select(project.id);
  }

  function onUpdated(updated) {
    items = items.map((p) => (p.id === updated.id ? { ...p, ...updated } : p));
  }

  function onDeleted(id) {
    items = items.filter((p) => p.id !== id);
    select(null);
  }

  let selected = $derived(items.find((p) => p.id === selectedId) ?? null);

  const FILTERS = [
    { value: "all", label: "All" },
    { value: "draft", label: "Drafts" },
    { value: "submitted", label: "Submitted" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ];
  let statusFilter = $state("all");
  let visibleItems = $derived(statusFilter === "all" ? items : items.filter((p) => p.status === statusFilter));
  const countFor = (value) => (value === "all" ? items.length : items.filter((p) => p.status === value).length);

  function statusColor(status) {
    switch (status) {
      case "approved":
        return "bg-app-mint";
      case "submitted":
        return "bg-app-lavender";
      case "rejected":
        return "bg-app-orange";
      default:
        return "bg-white"; // "draft"
    }
  }

  function statusLabel(status) {
    return status
      .split("_")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");
  }
</script>

<PopupShell
  title="Projects"
  subtitle={selected ? "" : "All of your projects! When you finsh one, make sure to submit it for review!"}
  maxWidth="max-w-4xl"
  onClose={() => (selected ? select(null) : onClose())}
>
  {#snippet children()}
    {#if selected}
      <ProjectDetail project={selected} {onUpdated} {onDeleted} />
    {:else}
      <div class="flex min-h-[60vh] flex-col">
        <div class="mb-4">
          <NewProjectModal {onCreated} />
        </div>

        {#if items.length === 0}
          <p class="text-black/60">You haven't started a project yet. Click "New project" to get going.</p>
        {:else}
          <div class="mb-4 flex flex-wrap gap-2">
            {#each FILTERS as opt (opt.value)}
              <button
                type="button"
                onclick={() => (statusFilter = opt.value)}
                class={`cursor-pointer rounded-none border-2 border-[#5c4429]/40 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-all ${statusFilter === opt.value ? "bg-[#5c4429] text-white" : "bg-white hover:bg-[#5c4429]/10"}`}
              >
                {opt.label} ({countFor(opt.value)})
              </button>
            {/each}
          </div>
          {#if visibleItems.length === 0}
            <p class="text-black/60">No {statusFilter} projects.</p>
          {/if}
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {#each visibleItems as project (project.id)}
              <div class="group relative flex min-h-[300px] flex-col overflow-hidden rounded-lg border-2 border-[#3d2718] bg-[#2b1d14] text-[#f0e2c9] transition-all hover:-translate-y-1 hover:border-[#f0e2c9]/50">
                <button
                  type="button"
                  onclick={() => select(project.id)}
                  aria-label={`View ${project.name}`}
                  data-no-hover-scale
                  class="absolute inset-0 z-0 cursor-pointer"
                ></button>
                <div class="pointer-events-none relative z-[1] flex flex-1 flex-col">
                  <div class="relative">
                    {#if project.photoUrl}
                      <img src={project.photoUrl} alt="" class="h-40 w-full object-cover" />
                    {:else}
                      <div class="grid h-40 w-full place-items-center bg-[#3d2718] text-xs font-bold uppercase tracking-wide text-[#f0e2c9]/40">
                        No photo yet
                      </div>
                    {/if}
                    <span class={`absolute left-2 top-2 rounded-full border border-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-black ${statusColor(project.status)}`}>
                      {statusLabel(project.status)}
                    </span>
                    <span class="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">
                      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 fill-none stroke-current" stroke-width="2.5"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                      {project.viewCount ?? 0}
                    </span>
                  </div>
                  <div class="flex flex-1 flex-col gap-2 p-4">
                    <h3 class="text-lg font-bold">{project.name}</h3>
                    <p class="line-clamp-3 flex-1 text-sm text-[#f0e2c9]/70">{project.description}</p>
                    <div class="mt-1 flex items-center gap-1.5 text-sm font-bold text-[#f0e2c9]/80">
                      <span>&#9650;</span>
                      <span>{project.upvoteCount ?? 0} upvote{(project.upvoteCount ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}
</PopupShell>
