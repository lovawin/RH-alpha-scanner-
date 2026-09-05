import fetch from "node-fetch";

/**
 * X/Twitter mention counts.
 *
 * This requires a paid X API key (basic tier is ~$200/mo as of writing).
 * Without X_BEARER_TOKEN set, this returns null and the dashboard shows
 * "not configured" — it does NOT invent numbers.
 *
 * Treat social as the WEAKEST signal here. Mention count is the single
 * easiest thing to fake: bot swarms, bought engagement, and coordinated
 * shill campaigns all produce exactly the spike you'd read as organic
 * interest. It is deliberately NOT part of the composite score — it's
 * display-only context. Do not let it override a bad contract score.
 */

const BEARER = process.env.X_BEARER_TOKEN;

export async function getMentions(query) {
  if (!BEARER) {
    return { count: null, configured: false, detail: "X_BEARER_TOKEN not set" };
  }

  try {
    const url =
      "https://api.twitter.com/2/tweets/counts/recent?granularity=hour&query=" +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` } });
    if (!res.ok) {
      return { count: null, configured: true, detail: `X API ${res.status}` };
    }
    const json = await res.json();
    const total = (json.data || []).reduce((sum, b) => sum + (b.tweet_count || 0), 0);
    const accounts = json.meta?.total_tweet_count ?? null;

    return {
      count: total,
      configured: true,
      detail: `${total} posts in last 24h`,
      // A very high post count from a very short window is a shill-campaign
      // shape, not organic interest. Surface it, don't score it.
      suspicious: total > 500,
      accounts,
    };
  } catch (e) {
    return { count: null, configured: true, detail: `lookup failed: ${e.message}` };
  }
}

/** Build a reasonable search query for a token. */
export function queryFor(symbol, address) {
  return `(${address} OR "$${symbol}") -is:retweet`;
}
