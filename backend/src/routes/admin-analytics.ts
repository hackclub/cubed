// Read-only admin metrics. One combined payload (the page needs all of it up
// front and this is admin-only, low traffic). Everything is UTC and every
// query is a parameterized sql template — no string-built SQL.

import { desc, eq, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders, shopItems, users } from "../db/schema.js";

export const ANALYTICS_RANGES = [7, 30, 60, 90, 180] as const;

type Row = Record<string, any>;
const run = async (query: SQL): Promise<Row[]> => (await db.execute(query)) as unknown as Row[];
const one = async (query: SQL): Promise<Row> => (await run(query))[0] ?? {};
const num = (v: unknown) => Number(v ?? 0) || 0;

// Every UTC day in the range, oldest first, zero-filled.
function dayKeys(days: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return keys;
}

function fill(keys: string[], rows: Row[]) {
  const map = new Map(rows.map((r) => [String(r.d), num(r.c)]));
  return keys.map((date) => ({ date, count: map.get(date) ?? 0 }));
}

export async function buildAnalytics(days: number) {
  const keys = dayKeys(days);
  const sinceDay = keys[0];
  const since = `${sinceDay}T00:00:00.000Z`;
  const S = sql`${since}::timestamptz`;
  const SD = sql`${sinceDay}::date`;

  const [
    userRow,
    activeNow,
    activeToday,
    activeRange,
    dauRows,
    trackingRow,
    funnelRow,
    signupRows,
    onboardedRows,
    submittedRows,
    orderDayRows,
    sourceRows,
    reviewRow,
    attemptRows,
    hoursRow,
    bucketRow,
    projectStatusRows,
    projectsCreated,
    economyRow,
    holderRows,
    orderRow,
    engagementRow,
    visibleRow,
    topProjectRows,
    topShopItems,
    heardAboutAllRows,
    heardAboutResponses,
  ] = await Promise.all([
    one(sql`
      select
        count(*)::int as total,
        count(*) filter (where onboarded_at is not null)::int as onboarded,
        count(*) filter (where onboarded_at is null)::int as stuck,
        count(*) filter (where created_at >= ${S})::int as signups_range,
        count(*) filter (where onboarded_at >= ${S})::int as onboarded_range,
        (percentile_cont(0.5) within group (order by extract(epoch from (onboarded_at - created_at)))
          filter (where onboarded_at is not null))::float as median_onboard_seconds,
        count(*) filter (where ysws_status = 'verified_eligible')::int as verified,
        count(*) filter (where ysws_status is null or ysws_status in ('needs_submission', 'pending', 'not_found'))::int as unverified,
        count(*) filter (where ysws_status in ('rejected', 'verified_but_over_18'))::int as not_eligible,
        count(*) filter (where hackatime_banned)::int as hackatime_banned,
        count(*) filter (where is_banned)::int as team_banned,
        count(*) filter (where is_admin)::int as admins,
        count(*) filter (where age_declared_at is not null)::int as age_declared
      from users`),
    one(sql`select count(*)::int as c from users where last_seen_at > now() - interval '10 minutes'`),
    one(sql`select count(*)::int as c from user_activity where day = (now() at time zone 'utc')::date`),
    one(sql`select count(distinct user_id)::int as c from user_activity where day >= ${SD}`),
    run(sql`select to_char(day, 'YYYY-MM-DD') as d, count(*)::int as c from user_activity where day >= ${SD} group by day`),
    one(sql`select to_char(min(day), 'YYYY-MM-DD') as first_day from user_activity`),
    // Each step is "has ever done X", measured over all users (steps aren't strictly nested).
    one(sql`
      select
        count(*)::int as signed_up,
        count(*) filter (where onboarded_at is not null)::int as onboarded,
        count(*) filter (where ysws_status = 'verified_eligible')::int as verified,
        count(*) filter (where exists (select 1 from projects p where p.user_id = users.id))::int as started,
        count(*) filter (where exists (select 1 from projects p where p.user_id = users.id and p.hackatime_user_id is not null))::int as hackatime,
        count(*) filter (where exists (
          select 1 from submissions s join projects p on p.id = s.project_id where p.user_id = users.id))::int as submitted,
        count(*) filter (where exists (
          select 1 from submissions s join projects p on p.id = s.project_id
          where p.user_id = users.id and s.status = 'accepted'))::int as approved,
        count(*) filter (where exists (select 1 from orders o where o.user_id = users.id and o.status <> 'refunded'))::int as purchased
      from users`),
    run(sql`select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as d, count(*)::int as c from users where created_at >= ${S} group by 1`),
    run(sql`select to_char(onboarded_at at time zone 'utc', 'YYYY-MM-DD') as d, count(*)::int as c from users where onboarded_at >= ${S} group by 1`),
    run(sql`select to_char(submitted_at at time zone 'utc', 'YYYY-MM-DD') as d, count(*)::int as c from submissions where submitted_at >= ${S} group by 1`),
    run(sql`select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as d, count(*)::int as c from orders where created_at >= ${S} and status <> 'refunded' group by 1`),
    run(sql`select heard_about_source::text as source, count(*)::int as count from users where heard_about_source is not null and created_at >= ${S} group by 1`),
    one(sql`
      select
        count(*) filter (where status <> 'pending' and synced_at >= ${S})::int as decided,
        count(*) filter (where status = 'accepted' and synced_at >= ${S})::int as approved,
        count(*) filter (where status = 'changes_requested' and synced_at >= ${S})::int as changes_requested,
        count(*) filter (where status = 'rejected' and synced_at >= ${S})::int as rejected,
        (avg(extract(epoch from (synced_at - submitted_at))) filter (where status <> 'pending' and synced_at >= ${S}))::float as avg_decision_seconds,
        coalesce(sum(approved_hours) filter (where status = 'accepted' and synced_at >= ${S}), 0)::float as approved_hours_range,
        count(*) filter (where submitted_at >= ${S})::int as submitted_range,
        count(*) filter (where status = 'pending')::int as pending_now,
        (extract(epoch from (now() - min(submitted_at) filter (where status = 'pending'))))::float as oldest_pending_seconds,
        count(*) filter (where status = 'accepted')::int as approved_all,
        count(*) filter (where status = 'rejected')::int as rejected_all,
        count(*) filter (where status = 'changes_requested')::int as changes_all,
        coalesce(sum(approved_hours) filter (where status = 'accepted'), 0)::float as approved_hours_all
      from submissions`),
    run(sql`select n::int as attempts, count(*)::int as count from (select count(*) as n from submissions group by project_id) t group by n order by n`),
    one(sql`
      select
        coalesce(sum(p.hackatime_seconds) filter (where exists (
          select 1 from submissions s where s.project_id = p.id and s.status = 'pending')), 0)::float as in_review_seconds,
        coalesce(sum(p.hackatime_seconds) filter (where exists (
          select 1 from submissions s where s.project_id = p.id and s.submitted_at >= ${S})), 0)::float as submitted_range_seconds,
        coalesce(sum(p.hackatime_seconds) filter (where p.status in ('submitted', 'approved')), 0)::float as on_submitted_seconds,
        (avg(p.hackatime_seconds) filter (where exists (select 1 from submissions s where s.project_id = p.id)))::float as avg_submitted_seconds
      from projects p`),
    // Builders (onboarded users) by total approved hours.
    one(sql`
      select
        count(*) filter (where h = 0)::int as none,
        count(*) filter (where h > 0 and h < 5)::int as under_5,
        count(*) filter (where h >= 5 and h < 10)::int as from_5_to_10,
        count(*) filter (where h >= 10 and h < 25)::int as from_10_to_25,
        count(*) filter (where h >= 25)::int as over_25
      from (
        select u.id, coalesce(sum(s.approved_hours) filter (where s.status = 'accepted'), 0) as h
        from users u
        left join projects p on p.user_id = u.id
        left join submissions s on s.project_id = p.id
        where u.onboarded_at is not null
        group by u.id
      ) t`),
    run(sql`select status::text as status, count(*)::int as count from projects group by status`),
    one(sql`select count(*)::int as c from projects where created_at >= ${S}`),
    one(sql`
      select
        coalesce(sum(amount) filter (where type = 'earned'), 0)::int as earned_all,
        (coalesce(sum(amount) filter (where type = 'spent'), 0) - coalesce(sum(amount) filter (where type = 'adjustment'), 0))::int as spent_all,
        coalesce(sum(amount) filter (where type = 'earned' and created_at >= ${S}), 0)::int as earned_range,
        (coalesce(sum(amount) filter (where type = 'spent' and created_at >= ${S}), 0) - coalesce(sum(amount) filter (where type = 'adjustment' and created_at >= ${S}), 0))::int as spent_range,
        (select coalesce(sum(moles_balance), 0)::int from users) as outstanding
      from transactions`),
    run(sql`select nickname, moles_balance as balance from users where moles_balance > 0 order by moles_balance desc, created_at limit 5`),
    one(sql`
      select
        count(*)::int as total_orders,
        coalesce(sum(quantity), 0)::int as total_units,
        count(*) filter (where created_at >= ${S})::int as orders_range,
        count(distinct user_id)::int as buyers
      from orders
      where status <> 'refunded'`),
    one(sql`
      select
        (select count(*)::int from project_upvotes) as upvotes_all,
        (select count(*)::int from project_upvotes where created_at >= ${S}) as upvotes_range,
        (select coalesce(sum(view_count), 0)::int from projects) as views_all,
        (select count(*)::int from projects where hidden) as hidden`),
    one(sql`
      select count(*)::int as c
      from projects p join users u on u.id = p.user_id
      where p.status in ('draft', 'submitted', 'approved') and not p.hidden
        and u.ysws_status = 'verified_eligible' and not u.is_banned and not u.hackatime_banned`),
    run(sql`
      select p.name, u.nickname, p.status::text as status, p.view_count as views,
        (select count(*)::int from project_upvotes pu where pu.project_id = p.id) as upvotes
      from projects p join users u on u.id = p.user_id
      where p.status in ('draft', 'submitted', 'approved') and not p.hidden
        and u.ysws_status = 'verified_eligible' and not u.is_banned and not u.hackatime_banned
      order by upvotes desc, p.view_count desc, p.created_at
      limit 5`),
    db
      .select({
        name: shopItems.name,
        unitsSold: sql<number>`coalesce(sum(${orders.quantity}), 0)::int`,
        molesSpent: sql<number>`coalesce(sum(${orders.pricePaid}), 0)::int`,
      })
      .from(orders)
      .innerJoin(shopItems, eq(orders.shopItemId, shopItems.id))
      .where(ne(orders.status, "refunded"))
      .groupBy(shopItems.id, shopItems.name)
      .orderBy(desc(sql`sum(${orders.quantity})`))
      .limit(5),
    db
      .select({ source: users.heardAboutSource, count: sql<number>`count(*)::int` })
      .from(users)
      .where(isNotNull(users.heardAboutSource))
      .groupBy(users.heardAboutSource),
    // Free-text answers, capped at the 50 most recent to keep the payload bounded.
    db
      .select({
        nickname: users.nickname,
        source: users.heardAboutSource,
        detail: users.heardAboutDetail,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(isNotNull(users.heardAboutDetail))
      .orderBy(desc(users.createdAt))
      .limit(50),
  ]);

  const dau = fill(keys, dauRows);
  const dauSum = dau.reduce((sum, d) => sum + d.count, 0);

  const decidedAll = num(reviewRow.approved_all) + num(reviewRow.rejected_all);
  const approvedHoursAll = num(reviewRow.approved_hours_all);

  const funnelSteps = [
    { key: "signed_up", label: "Signed up", count: num(funnelRow.signed_up) },
    { key: "onboarded", label: "Onboarded", count: num(funnelRow.onboarded) },
    { key: "verified", label: "ID verified", count: num(funnelRow.verified) },
    { key: "hackatime", label: "Linked Hackatime to a project", count: num(funnelRow.hackatime) },
    { key: "started", label: "Started a project", count: num(funnelRow.started) },
    { key: "submitted", label: "Submitted a project", count: num(funnelRow.submitted) },
    { key: "approved", label: "Got a project approved", count: num(funnelRow.approved) },
    { key: "purchased", label: "Bought something", count: num(funnelRow.purchased) },
  ];
  const signedUp = funnelSteps[0].count;

  return {
    range: { days, since: sinceDay, activityTrackingSince: trackingRow.first_day ?? null },
    activity: {
      activeNow: num(activeNow.c),
      activeToday: num(activeToday.c),
      activeInRange: num(activeRange.c),
      avgDau: Math.round((dauSum / days) * 10) / 10,
      totalUsers: num(userRow.total),
      dauPerDay: dau,
    },
    onboarding: {
      totalUsers: num(userRow.total),
      onboardedCount: num(userRow.onboarded),
      stuck: num(userRow.stuck),
      signupsInRange: num(userRow.signups_range),
      onboardedInRange: num(userRow.onboarded_range),
      medianOnboardSeconds: userRow.median_onboard_seconds === null ? null : num(userRow.median_onboard_seconds),
      signupsPerDay: fill(keys, signupRows),
      onboardedPerDay: fill(keys, onboardedRows),
      sourcesInRange: sourceRows.map((r) => ({ source: r.source as string, count: num(r.count) })),
    },
    funnel: funnelSteps.map((step, i) => ({
      ...step,
      pctOfSignups: signedUp > 0 ? Math.round((step.count / signedUp) * 1000) / 10 : 0,
      pctOfPrevious: i === 0 ? null : funnelSteps[i - 1].count > 0 ? Math.round((step.count / funnelSteps[i - 1].count) * 1000) / 10 : null,
    })),
    verification: {
      verified: num(userRow.verified),
      unverified: num(userRow.unverified),
      notEligible: num(userRow.not_eligible),
      hackatimeBanned: num(userRow.hackatime_banned),
      teamBanned: num(userRow.team_banned),
      admins: num(userRow.admins),
      ageDeclared: num(userRow.age_declared),
    },
    projects: {
      byStatus: projectStatusRows.map((r) => ({ status: r.status as string, count: num(r.count) })),
      createdInRange: num(projectsCreated.c),
      attempts: attemptRows.map((r) => ({ attempts: num(r.attempts), count: num(r.count) })),
      builderBuckets: {
        none: num(bucketRow.none),
        under5: num(bucketRow.under_5),
        from5to10: num(bucketRow.from_5_to_10),
        from10to25: num(bucketRow.from_10_to_25),
        over25: num(bucketRow.over_25),
      },
      submittedPerDay: fill(keys, submittedRows),
    },
    hours: {
      inReviewSeconds: num(hoursRow.in_review_seconds),
      submittedInRangeSeconds: num(hoursRow.submitted_range_seconds),
      onSubmittedProjectsSeconds: num(hoursRow.on_submitted_seconds),
      avgPerSubmittedProjectSeconds: hoursRow.avg_submitted_seconds === null ? null : num(hoursRow.avg_submitted_seconds),
      approvedInRange: num(reviewRow.approved_hours_range),
      approvedAllTime: approvedHoursAll,
    },
    review: {
      // In range = decided within the range; allTime* feed the overall approval rate.
      submittedInRange: num(reviewRow.submitted_range),
      decidedInRange: num(reviewRow.decided),
      approvedInRange: num(reviewRow.approved),
      changesRequestedInRange: num(reviewRow.changes_requested),
      rejectedInRange: num(reviewRow.rejected),
      avgDecisionSeconds: reviewRow.avg_decision_seconds === null ? null : num(reviewRow.avg_decision_seconds),
      pendingNow: num(reviewRow.pending_now),
      oldestPendingSeconds: reviewRow.oldest_pending_seconds === null ? null : num(reviewRow.oldest_pending_seconds),
      approved: num(reviewRow.approved_all),
      rejected: num(reviewRow.rejected_all),
      changesRequested: num(reviewRow.changes_all),
      approvalRate: decidedAll > 0 ? Math.round((num(reviewRow.approved_all) / decidedAll) * 100) : null,
      avgApprovedHours: num(reviewRow.approved_all) > 0 ? approvedHoursAll / num(reviewRow.approved_all) : 0,
    },
    economy: {
      earnedAllTime: num(economyRow.earned_all),
      spentAllTime: num(economyRow.spent_all),
      earnedInRange: num(economyRow.earned_range),
      spentInRange: num(economyRow.spent_range),
      outstanding: num(economyRow.outstanding),
      avgMolesPerApprovedHour: approvedHoursAll > 0 ? Math.round((num(economyRow.earned_all) / approvedHoursAll) * 10) / 10 : null,
      totalOrders: num(orderRow.total_orders),
      totalUnits: num(orderRow.total_units),
      ordersInRange: num(orderRow.orders_range),
      buyers: num(orderRow.buyers),
      ordersPerDay: fill(keys, orderDayRows),
      topHolders: holderRows.map((r) => ({ nickname: (r.nickname as string | null) ?? "?", balance: num(r.balance) })),
      topShopItems,
    },
    engagement: {
      upvotesAllTime: num(engagementRow.upvotes_all),
      upvotesInRange: num(engagementRow.upvotes_range),
      viewsAllTime: num(engagementRow.views_all),
      hiddenProjects: num(engagementRow.hidden),
      visibleInGallery: num(visibleRow.c),
      topProjects: topProjectRows.map((r) => ({
        name: r.name as string,
        nickname: (r.nickname as string | null) ?? "?",
        status: r.status as string,
        upvotes: num(r.upvotes),
        views: num(r.views),
      })),
    },
    heardAbout: heardAboutAllRows,
    heardAboutResponses,
  };
}
