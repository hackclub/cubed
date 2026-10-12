<script>
  // Every asset in Images/dashboard/ is a full 2560×1440 layer with
  // everything except one object made transparent (pixel-scanned to
  // confirm), so positions below are plain percentages of that shared
  // space. Root is `h-screen w-screen overflow-hidden`; the "stage" div
  // uses `aspect-[W/H] min-h-full min-w-full` to cover it like
  // `background-size: cover`, cropping symmetrically at any viewport ratio.
  // DashboardHud is a sibling of the stage div, not a child — parallax
  // transforms only apply inside the stage, so the HUD never moves.
  // Astro wraps an imported image as `{src, width, height, format}`, not a
  // plain URL — every usage below reads `.src` explicitly.
  import bgImg from "../../Images/dashboard/bg.png";
  // Most layers use a pre-cropped "-icon" file rather than the full
  // transparent canvas — sizing the full canvas down into a small bbox
  // stretches it (object-fit defaults to `fill`), squishing the object.
  // staircase/left-desk/right-desk are the exception: "extended"
  // full-canvas versions with extra artwork drawn past the object's old
  // edge, so parallax reveals real content instead of empty canvas — they
  // render like bg.png (no bbox positioning via `box()`).
  import stageIconImg from "../../Images/dashboard/stage-icon.png";
  import poduimIconImg from "../../Images/dashboard/poduim-icon.png";
  import staircaseIconImg from "../../Images/dashboard/staircase-icon.png";
  import leftDeskIconImg from "../../Images/dashboard/left-desk-icon.png";
  import rightDeskIconImg from "../../Images/dashboard/right-desk-icon.png";
  import blackboardIconImg from "../../Images/dashboard/blackboard-icon.png";
  import galleryIconImg from "../../Images/dashboard/gallery-icon.png";
  import shopIconImg from "../../Images/dashboard/shop-icon.png";

  const bg = bgImg.src;
  const stage = stageIconImg.src;
  const poduim = poduimIconImg.src;
  const staircase = staircaseIconImg.src;
  const leftDesk = leftDeskIconImg.src;
  const rightDesk = rightDeskIconImg.src;
  const blackboardIcon = blackboardIconImg.src;
  const galleryIcon = galleryIconImg.src;
  const shopIcon = shopIconImg.src;

  import { setContext } from "svelte";
  import { apiFetch } from "../../lib/api-client";
  import { ID_VERIFIED_CONTEXT } from "../../lib/verification";
  import VerificationBanner from "./VerificationBanner.svelte";
  import DashboardHud from "./DashboardHud.svelte";
  import GalleryPopup from "./GalleryPopup.svelte";
  import ProfilePopup from "./ProfilePopup.svelte";
  import ShopPopup from "./ShopPopup.svelte";
  import ProjectsPopup from "./ProjectsPopup.svelte";
  import NewsPopup from "./NewsPopup.svelte";

  let {
    user,
    galleryProjects,
    galleryHasMore = false,
    ownProjects,
    shopItems,
    shopOrders,
    announcements,
    initialTransactions,
    failedParts = [],
  } = $props();

  // Kept as local reactive state (seeded from the prop) so a nickname edit
  // saved inside ProfilePopup shows up live in the HUD without a full page
  // reload.
  let displayUser = $state({ ...user });
  // Read by the popups to explain (instead of failing) submit/buy/upvote for
  // people who haven't finished ID verification. Static: the banner's
  // "I've verified" button reloads the page once the backend confirms.
  setContext(ID_VERIFIED_CONTEXT, user.idVerified !== false);

  // Selected gallery/own-project detail mirrors into the URL as
  // `?gallery=<id>` or `?project=<id>` (mutually exclusive), so it's
  // shareable/bookmarkable without a real navigation. `?userId=<id>` is a
  // third, gallery-only mode ("view all of this user's projects") that can
  // combine with `?gallery=<id>` (a project selected from within that view).
  const initialParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialGalleryId = initialParams?.get("gallery") ?? null;
  const initialProjectId = initialParams?.get("project") ?? null;
  const initialViewUserId = initialParams?.get("userId") ?? null;

  // Local reactive copy of `announcements`, so toggling one item updates
  // the HUD's unread badge instantly rather than waiting on the round trip.
  let announcementsState = $state(announcements.map((a) => ({ ...a })));

  let unreadCount = $derived(announcementsState.filter((a) => !a.isRead).length);

  async function toggleAnnouncementRead(id) {
    const target = announcementsState.find((a) => a.id === id);
    if (!target) return;
    const optimistic = !target.isRead;
    target.isRead = optimistic;
    try {
      const res = await apiFetch(`/announcements/${id}/read`, { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      const body = await res.json();
      target.isRead = body.isRead;
    } catch {
      // Roll back the optimistic flip — it never actually persisted.
      target.isRead = !optimistic;
    }
  }

  // Auto-opens News once if anything's unread and no gallery/project deep
  // link claims the popup slot. Not reactive (initial SSR snapshot only) —
  // opening News no longer marks anything read, so this can fire again on
  // a later visit, which is expected.
  const initialUnread = announcements.some((a) => !a.isRead);

  /** @type {'gallery' | 'profile' | 'shop' | 'projects' | 'news' | null} */
  let activePopup = $state(
    initialGalleryId || initialViewUserId ? "gallery" : initialProjectId ? "projects" : initialUnread ? "news" : null,
  );
  let galleryDetailId = $state(initialGalleryId);
  let galleryViewUserId = $state(initialViewUserId);
  let ownProjectDetailId = $state(initialProjectId);

  function open(popup) {
    activePopup = popup;
  }
  function close() {
    activePopup = null;
    galleryDetailId = null;
    galleryViewUserId = null;
    ownProjectDetailId = null;
  }

  function syncUrl() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (activePopup === "gallery" && galleryViewUserId) params.set("userId", galleryViewUserId);
    if (activePopup === "gallery" && galleryDetailId) params.set("gallery", galleryDetailId);
    if (activePopup === "projects" && ownProjectDetailId) params.set("project", ownProjectDetailId);
    const qs = params.toString();
    // replaceState, not pushState — selecting a project shouldn't pile up history entries.
    history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  }

  $effect(() => {
    // Reading these here (not just calling syncUrl()) is what makes Svelte track them.
    activePopup;
    galleryDetailId;
    galleryViewUserId;
    ownProjectDetailId;
    syncUrl();
  });

  // Models the mouse as the viewer's eye looking into the room, so content
  // shifts OPPOSITE the mouse (real motion-parallax direction). Nearer
  // things shift MORE: FOREGROUND (desks/staircase) has a bigger factor
  // than BASE (background/hotspots/stage). Foreground props already sit
  // close to the bottom edge and get cropped there, so `foreground` in
  // parallax() damps harder whenever the resulting `y` pushes them further
  // down. `duration-500` on every parallaxed element gives the lag/smoothing.
  let mouseX = $state(0);
  let mouseY = $state(0);

  function onMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }
  function onMouseLeave() {
    mouseX = 0;
    mouseY = 0;
  }

  function parallax(factor, foreground = false) {
    const x = -mouseX * factor;
    let y = -mouseY * factor;
    if (foreground && y > 0) y *= 0.35;
    return `transform: translate(${x.toFixed(2)}px, ${y.toFixed(2)}px);`;
  }

  // Full-canvas layers sized to exactly cover the stage box had zero
  // slack — any parallax translate pushed an edge past the stage boundary,
  // exposing raw page background. Paired with the oversized `w-[110%]
  // h-[110%]` FULL_BLEED below (recentered via this transform's -50%/-50%)
  // so there's spare image in every direction. nudgeXPct/nudgeYPct (same
  // -50%-centered space) shift one layer's drawn object without a second asset.
  function parallaxFull(factor, { foreground = false, nudgeXPct = 0, nudgeYPct = 0 } = {}) {
    const x = -mouseX * factor;
    let y = -mouseY * factor;
    if (foreground && y > 0) y *= 0.35;
    return `transform: translate(calc(-50% + ${nudgeXPct}% + ${x.toFixed(2)}px), calc(-50% + ${nudgeYPct}% + ${y.toFixed(2)}px));`;
  }
  // `max-w-none` overrides Tailwind preflight's `img { max-width: 100% }`,
  // which would otherwise silently clamp the 110% width back to 100% —
  // nothing errors, the layer just quietly stops being oversized.
  const FULL_BLEED = "absolute left-1/2 top-1/2 h-[110%] w-[110%] max-w-none";

  // Kept close together on purpose — a small gap reads as depth, a big one as disconnected scenes.
  const BASE = 14;
  const FOREGROUND = 18;

  // Cover-fit (crop, centered) on laptop+ widths — the scene fills the
  // whole screen edge-to-edge. Below "laptop" (matches Tailwind's `lg`
  // breakpoint, 1024px — the mobile fallback further below already handles
  // <768 separately), contain-fit (shrink the whole scene to fit, nothing
  // cropped) is used instead. Purely width-based, not aspect-ratio-based —
  // a laptop-width window that's just tallish (a 16:10 screen, or a plain
  // non-maximized window) should still fill edge-to-edge, not shrink, even
  // though its ratio is well under the canvas's own ~1.78. Both modes are
  // centered — contain used to anchor to the bottom instead, reversed on
  // explicit request.
  //
  // Cover-mode's horizontal crop is capped at MAX_CROP_PER_SIDE, though,
  // rather than left uncapped: the two support poles baked into bg.png
  // (pixel-scanned to ~17.3%/~80.8% of canvas width) mark where the
  // forward wall ends and the side walls (where Gallery/Shop live) begin,
  // and Gallery/Shop are a fixed size — uncapped cover-mode crop on a
  // "large but not very wide" window eats far enough into a side wall that
  // a fixed-size icon would spill across its pole into forward-wall
  // territory. Capping the crop keeps that from ever happening, at the
  // cost of the scene under-filling the screen vertically (visible sky
  // above/below) on the windows narrow enough to hit the cap — a
  // deliberate trade against cropping bg.png's width that far.
  const CANVAS_W = 2560;
  const CANVAS_H = 1440;
  const LAPTOP_MIN_WIDTH = 1024;
  const CANVAS_RATIO = CANVAS_W / CANVAS_H;
  const MAX_CROP_PER_SIDE = 7;

  let vw = $state(1440);
  let vh = $state(900);

  let containMode = $derived(vw < LAPTOP_MIN_WIDTH);

  let stageStyle = $derived.by(() => {
    let scale;
    if (containMode) {
      scale = Math.min(vw / CANVAS_W, vh / CANVAS_H);
    } else {
      const coverScale = Math.max(vw / CANVAS_W, vh / CANVAS_H);
      // Inverse of the crop-per-side formula below, solved for the scale
      // that caps it at MAX_CROP_PER_SIDE.
      const capScale = vw / (CANVAS_W * (1 - MAX_CROP_PER_SIDE / 50));
      scale = Math.min(coverScale, capScale);
    }
    const w = CANVAS_W * scale;
    const h = CANVAS_H * scale;
    return `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:${w}px; height:${h}px;`;
  });

  // Non-bg layers are scaled down individually via `box()`, not a single
  // `transform: scale()` on a shared wrapper — a shared-center scale drags
  // every child toward that center, detaching floor props from the floor.
  // `box()` shrinks each object's own box around a center, or around its
  // bottom edge (`anchorY: "bottom"`) for floor props, so they shrink
  // upward instead of lifting off the ground.
  const OBJECT_SCALE = 0.8;

  // Actual crop-per-side once the cap above is applied — derived straight
  // from stageStyle's own scale so the two can never disagree, rather than
  // recomputed from the ratio independently.
  let cropPerSide = $derived.by(() => {
    if (containMode) return 0;
    const ratio = vw / vh;
    if (ratio >= CANVAS_RATIO) return 0;
    return Math.min(MAX_CROP_PER_SIDE, 50 * (1 - ratio / CANVAS_RATIO));
  });

  function box(left, top, width, height, { anchorX = "center", anchorY = "center" } = {}) {
    const w = width * OBJECT_SCALE;
    const h = height * OBJECT_SCALE;
    let l;
    if (anchorX === "left" || anchorX === "right") {
      // Slides in from whichever edge cropPerSide threatens — near or far —
      // just enough to keep the whole box inside the visible window,
      // preferring its native position whenever the (now-capped) crop is
      // mild enough to allow it. Capping the crop above is what guarantees
      // this never has to slide far enough to reach either support pole.
      const native = anchorX === "left" ? left : left + width - w;
      l = Math.min(Math.max(native, cropPerSide), 100 - cropPerSide - w);
    } else {
      l = left + (width - w) / 2;
    }
    const t = anchorY === "bottom" ? top + (height - h) : top + (height - h) / 2;
    return `left:${l.toFixed(2)}%; top:${t.toFixed(2)}%; width:${w.toFixed(2)}%; height:${h.toFixed(2)}%;`;
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="relative h-screen w-screen overflow-hidden bg-[#c7e9ff]"
  role="presentation"
  onmousemove={onMouseMove}
  onmouseleave={onMouseLeave}
>
  <!-- Desktop/tablet scene — hidden below md: -->
  <div class="hidden md:block" style={stageStyle}>
    <img
      src={bg}
      alt=""
      class={`${FULL_BLEED} pointer-events-none transition-transform duration-500 ease-out`}
      style={parallaxFull(BASE)}
      draggable="false"
      loading="lazy"
      decoding="async"
    />

    <!-- Projects (blackboard) -->
    <button
      type="button"
      onclick={() => open("projects")}
      aria-label="Projects"
      class="group absolute cursor-pointer transition-transform duration-500 ease-out"
      style={`${box(30.31, 32.78, 39.57, 25.56)} ${parallax(BASE)}`}
    >
      <img
        src={blackboardIcon}
        alt=""
        class="h-full w-full transition-transform duration-200 ease-out group-hover:scale-[1.02] group-focus-visible:scale-[1.02]"
        draggable="false"
      loading="lazy"
      decoding="async"
      />
      <span
        class="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-[#6b4a2b] bg-[#f0e2c9] px-4 py-2 text-base font-bold text-[#4a3220] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        Projects
      </span>
    </button>

    <!-- Gallery (trophy case) — lives on the left SIDE wall, kept clear of the
         forward-wall pole by MAX_CROP_PER_SIDE capping how far cover-mode's
         crop can slide it inward (see box() and stageStyle above). -->
    <button
      type="button"
      onclick={() => open("gallery")}
      aria-label="Gallery"
      class="group absolute cursor-pointer transition-transform duration-500 ease-out"
      style={`${box(0.82, 36.94, 10.31, 31.39, { anchorX: "left" })} ${parallax(BASE)}`}
    >
      <img
        src={galleryIcon}
        alt=""
        class="h-full w-full transition-transform duration-200 ease-out group-hover:scale-[1.02] group-focus-visible:scale-[1.02]"
        draggable="false"
      loading="lazy"
      decoding="async"
      />
      <span
        class="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-[#6b4a2b] bg-[#f0e2c9] px-4 py-2 text-base font-bold text-[#4a3220] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        Gallery
      </span>
    </button>

    <!-- Shop (storage shelf) — mirrors Gallery on the right SIDE wall. Its LEFT
         edge is the one nearest its pole (the shelf tapers away to the right,
         touching nothing), so that's the anchored edge. -->
    <button
      type="button"
      onclick={() => open("shop")}
      aria-label="Shop"
      class="group absolute cursor-pointer transition-transform duration-500 ease-out"
      style={`${box(83.36, 47.64, 13.63, 39.93, { anchorX: "left" })} ${parallax(BASE)}`}
    >
      <img
        src={shopIcon}
        alt=""
        class="h-full w-full transition-transform duration-200 ease-out group-hover:scale-[1.02] group-focus-visible:scale-[1.02]"
        draggable="false"
      loading="lazy"
      decoding="async"
      />
      <span
        class="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-[#6b4a2b] bg-[#f0e2c9] px-4 py-2 text-base font-bold text-[#4a3220] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        Shop
      </span>
    </button>

    <!-- Anchored to its own bottom edge so it shrinks without lifting off the ground. -->
    <img
      src={stage}
      alt=""
      class="absolute pointer-events-none transition-transform duration-500 ease-out"
      style={`${box(34.61, 65.28, 30.16, 16.6, { anchorY: "bottom" })} ${parallax(BASE)}`}
      draggable="false"
      loading="lazy"
      decoding="async"
    />

    <!-- Anchored to its own base (bottom), which rests on the stage. -->
    <img
      src={poduim}
      alt=""
      class="absolute pointer-events-none transition-transform duration-500 ease-out"
      style={`${box(50.08, 65.63, 2.81, 7.99, { anchorY: "bottom" })} ${parallax(BASE)}`}
      draggable="false"
      loading="lazy"
      decoding="async"
    />

    <!-- DOM order controls paint order where they overlap — leftDesk and
         rightDesk both go before staircase, so staircase paints over both. -->
    <img
      src={leftDesk}
      alt=""
      class={`${FULL_BLEED} pointer-events-none transition-transform duration-500 ease-out`}
      style={parallaxFull(FOREGROUND, { foreground: true })}
      draggable="false"
      loading="lazy"
      decoding="async"
    />
    <!-- Nudged via nudgeXPct/nudgeYPct from its default registered spot. -->
    <img
      src={rightDesk}
      alt=""
      class={`${FULL_BLEED} pointer-events-none transition-transform duration-500 ease-out`}
      style={parallaxFull(FOREGROUND, { foreground: true, nudgeXPct: 4, nudgeYPct: 2.5 })}
      draggable="false"
      loading="lazy"
      decoding="async"
    />
    <img
      src={staircase}
      alt=""
      class={`${FULL_BLEED} pointer-events-none transition-transform duration-500 ease-out`}
      style={parallaxFull(FOREGROUND, { foreground: true })}
      draggable="false"
      loading="lazy"
      decoding="async"
    />
  </div>

  <!-- Mobile — compact fallback, shown below md:. Icons get an explicit
       fixed box (h-16 w-16) with object-contain, not a height-only
       constraint — blackboard-icon.png is a wide banner but gallery/shop-
       icon.png are tall portraits, so a shared height alone squeezed those
       two down to an unreadable ~20px-wide sliver. object-contain needs an
       explicit width+height to size against, not just a max-h-full/
       max-w-full pair — percentage max-height on a non-stretched flex/grid
       item has no definite size to resolve against, so it silently doesn't
       clamp and the tall portraits overflowed their box instead. -->
  <div class="flex h-full flex-col items-center justify-center gap-4 bg-[#c7e9ff] px-[5vw] md:hidden">
    <button
      type="button"
      onclick={() => open("projects")}
      class="flex w-full max-w-xs items-center gap-4 rounded-2xl border-2 border-black/10 bg-white px-4 py-3 text-left shadow-sm active:bg-black/5"
    >
      <img src={blackboardIcon} alt="" class="h-16 w-16 shrink-0 object-contain" draggable="false" />
      <span class="text-lg font-bold">Projects</span>
    </button>
    <button
      type="button"
      onclick={() => open("gallery")}
      class="flex w-full max-w-xs items-center gap-4 rounded-2xl border-2 border-black/10 bg-white px-4 py-3 text-left shadow-sm active:bg-black/5"
    >
      <img src={galleryIcon} alt="" class="h-16 w-16 shrink-0 object-contain" draggable="false" />
      <span class="text-lg font-bold">Gallery</span>
    </button>
    <button
      type="button"
      onclick={() => open("shop")}
      class="flex w-full max-w-xs items-center gap-4 rounded-2xl border-2 border-black/10 bg-white px-4 py-3 text-left shadow-sm active:bg-black/5"
    >
      <img src={shopIcon} alt="" class="h-16 w-16 shrink-0 object-contain" draggable="false" />
      <span class="text-lg font-bold">Shop</span>
    </button>
  </div>

  {#if user.idVerified === false}
    <VerificationBanner />
  {/if}

  {#if failedParts.length > 0}
    <div
      class="fixed left-1/2 top-16 z-40 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-none border-[4px] border-[#5c4429] bg-[#f0e2c9] p-3 text-sm shadow-lg"
      role="alert"
    >
      <p class="font-bold text-[#4a3220]">
        We couldn't load {failedParts.join(", ")}. What you see may be incomplete.
      </p>
      <button
        type="button"
        onclick={() => window.location.reload()}
        class="mt-2 cursor-pointer rounded-none border-2 border-[#5c4429] bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide hover:bg-black/5"
      >
        Try again
      </button>
    </div>
  {/if}

  <DashboardHud user={displayUser} {unreadCount} onOpenProfile={() => open("profile")} onOpenNews={() => open("news")} />
</div>

{#if activePopup === "gallery"}
  <GalleryPopup
    projects={galleryProjects}
    hasMore={galleryHasMore}
    onClose={close}
    initialProjectId={galleryDetailId}
    onProjectSelected={(id) => (galleryDetailId = id)}
    isAdmin={displayUser.isAdmin}
    initialViewUserId={galleryViewUserId}
    onViewUserChanged={(id) => (galleryViewUserId = id)}
  />
{:else if activePopup === "profile"}
  <ProfilePopup
    user={displayUser}
    {initialTransactions}
    onNicknameSaved={(n) => (displayUser = { ...displayUser, nickname: n })}
    onClose={close}
  />
{:else if activePopup === "shop"}
  <ShopPopup items={shopItems} orders={shopOrders} user={displayUser} onClose={close} />
{:else if activePopup === "projects"}
  <ProjectsPopup
    projects={ownProjects}
    onClose={close}
    initialProjectId={ownProjectDetailId}
    onProjectSelected={(id) => (ownProjectDetailId = id)}
  />
{:else if activePopup === "news"}
  <NewsPopup announcements={announcementsState} onToggleRead={toggleAnnouncementRead} onClose={close} />
{/if}
