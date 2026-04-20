import { SimplePool, nip19 } from "nostr-tools";
import { createClient } from '@supabase/supabase-js';
import { CacheManager } from "../cache/cacheManager.js";

const cache = new CacheManager();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✓ Supabase connected for archival');
} else {
  console.warn('⚠ SUPABASE_URL or SUPABASE_KEY not set - building from relays only (no archival)');
}

export function resolveIdentity(input, fallbackRelays) {
  if (input.startsWith("npub")) {
    const decoded = nip19.decode(input);
    if (decoded.type !== "npub") {
      throw new Error("Invalid npub input");
    }
    return { npub: input, pubkey: decoded.data, relays: fallbackRelays };
  }

  if (input.startsWith("nprofile")) {
    const decoded = nip19.decode(input);
    if (decoded.type !== "nprofile") {
      throw new Error("Invalid nprofile input");
    }
    const data = decoded.data;
    const npub = nip19.npubEncode(data.pubkey);
    return { npub, pubkey: data.pubkey, relays: data.relays?.length ? data.relays : fallbackRelays };
  }

  throw new Error("Input must be npub or nprofile");
}

export async function fetchProfileMetadata(pool, relays, pubkey) {
  const cacheKey = `profile-${pubkey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Using cached profile for ${pubkey}`);
    return cached;
  }

  console.log(`Fetching profile for ${pubkey}...`);
  const filter = { kinds: [0], authors: [pubkey], limit: 10 };
  const events = await pool.querySync(relays, filter);
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest || !latest.content) {
    return {};
  }

  try {
    const metadata = JSON.parse(latest.content);
    cache.set(cacheKey, metadata);
    return metadata;
  } catch {
    return {};
  }
}

function collectDeletedIds(events) {
  const deleted = new Set();
  for (const event of events) {
    if (event.kind !== 5) continue;
    for (const tag of event.tags) {
      if (tag[0] === "e" && tag[1]) {
        deleted.add(tag[1]);
      }
    }
  }
  return deleted;
}

/**
 * Determines if we should INCLUDE this post in the blog
 * @param {Object} event - Nostr event
 * @param {string} myPubkey - Your pubkey (hex)
 * @returns {boolean} - true if we should include it
 */
function shouldIncludePost(event, myPubkey) {
  // Always include kind 30023 (long-form articles)
  if (event.kind === 30023) return true;

  // For kind 1 (notes), apply filtering logic
  const eTags = event.tags.filter(tag => tag[0] === 'e');
  const pTags = event.tags.filter(tag => tag[0] === 'p');

  // Always include if no event references (original post)
  if (eTags.length === 0) return true;

  // Check if it's a reply to others
  const mentionsOthers = pTags.some(tag => tag[1] !== myPubkey);
  const isReplyToOthers = eTags.length > 0 && mentionsOthers;

  if (!isReplyToOthers) {
    // It's a self-thread or reply to own post - include it
    return true;
  }

  // It's a reply to someone else - check length
  // Include if content is substantial (300+ chars)
  return event.content.length >= 300;
}

/**
 * Get most recent post date from Supabase document table
 */
async function getLastArchivedDate() {
  if (!supabase) return 0;

  try {
    const { data, error } = await supabase
      .from('document')
      .select('datepublished')
      .in('sourcetype', ['nostr_article', 'nostr_note'])
      .order('datepublished', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching last archived date:', error);
      return 0;
    }

    if (data && data.length > 0 && data[0].datepublished) {
      const timestamp = Math.floor(new Date(data[0].datepublished).getTime() / 1000);
      console.log(`Last archived post: ${data[0].datepublished} (${timestamp})`);
      return timestamp;
    }

    return 0;
  } catch (err) {
    console.error('Failed to get last archived date:', err);
    return 0;
  }
}

/**
 * Insert new posts into nostr_posts table
 */
async function archivePostsToSupabase(events, pubkey) {
  if (!supabase) {
    console.log('Skipping archival - no Supabase connection');
    return;
  }

  const filtered = events.filter(e => shouldIncludePost(e, pubkey));

  if (filtered.length === 0) {
    console.log('No new posts to archive');
    return;
  }

  const posts = filtered.map(event => ({
    event_id: event.id,
    pubkey: event.pubkey,
    created_at: new Date(event.created_at * 1000).toISOString(),
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    sig: event.sig
  }));

  try {
    // Use upsert to avoid duplicates
    const { data, error } = await supabase
      .from('nostr_posts')
      .upsert(posts, {
        onConflict: 'event_id',
        ignoreDuplicates: true
      });

    if (error) {
      console.error('Error archiving posts:', error);
    } else {
      console.log(`✓ Archived ${filtered.length} posts to Supabase`);
    }
  } catch (err) {
    console.error('Failed to archive posts:', err);
  }
}

/**
 * Fetch all posts from nostr_posts table
 */
async function fetchArchivedPosts(pubkey) {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('nostr_posts')
      .select('*')
      .eq('pubkey', pubkey)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) {
      console.error('Error fetching archived posts:', error);
      return [];
    }

    // Convert back to Nostr event format
    const events = (data || []).map(row => ({
      id: row.event_id,
      pubkey: row.pubkey,
      created_at: Math.floor(new Date(row.created_at).getTime() / 1000),
      kind: row.kind,
      content: row.content,
      tags: row.tags,
      sig: row.sig
    }));

    console.log(`✓ Fetched ${events.length} posts from Supabase archive`);
    return events;
  } catch (err) {
    console.error('Failed to fetch archived posts:', err);
    return [];
  }
}

export async function fetchArticles(pool, config, pubkey) {
  const relays = config.relays;

  if (supabase) {
    // SUPABASE ARCHIVAL MODE
    console.log('=== Supabase Archival Mode ===');

    // 1. Get last archived date from document table
    const since = await getLastArchivedDate();
    console.log(`Fetching posts since: ${since > 0 ? new Date(since * 1000).toISOString() : 'beginning of time'}`);

    // 2. Fetch only NEW posts from relays
    const filters = [];
    const baseFilter = {
      authors: [pubkey],
      kinds: [30023],
      since: config.fetch.since || since,
      until: config.fetch.until
    };
    filters.push(baseFilter);

    if (config.fetch.include_kind1) {
      filters.push({
        authors: [pubkey],
        kinds: [1],
        since: config.fetch.since || since,
        until: config.fetch.until
      });
    }

    const deletionFilter = {
      authors: [pubkey],
      kinds: [5],
      since: config.fetch.since || since,
      until: config.fetch.until
    };

    const [events, deletions] = await Promise.all([
      Promise.all(filters.map(f => pool.querySync(relays, f))).then(results => results.flat()),
      pool.querySync(relays, deletionFilter)
    ]);

    console.log(`Fetched ${events.length} new events from relays`);

    // 3. Archive new posts to Supabase
    await archivePostsToSupabase(events, pubkey);

    // 4. Fetch ALL posts from Supabase archive (includes old + new)
    const allPosts = await fetchArchivedPosts(pubkey);

    // 5. Apply deletion filter
    const deletedIds = collectDeletedIds(deletions);
    const deduped = new Map();
    for (const event of allPosts) {
      if (!event.content || !event.content.trim()) continue;
      if (deletedIds.has(event.id)) continue;
      if (!shouldIncludePost(event, pubkey)) continue;
      if (!deduped.has(event.id)) {
        deduped.set(event.id, event);
      }
    }

    const result = Array.from(deduped.values());
    console.log(`Final result: ${result.length} posts (after filtering)`);
    return result;

  } else {
    // LEGACY MODE (no Supabase)
    console.log('=== Legacy Mode (no archival) ===');
    const cacheKey = `articles-${pubkey}-${JSON.stringify(config.fetch)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`Using cached articles for ${pubkey}`);
      return cached;
    }

    console.log(`Fetching articles for ${pubkey}...`);
    const filters = [];

    const baseFilter = {
      authors: [pubkey],
      kinds: [30023],
      since: config.fetch.since,
      until: config.fetch.until
    };
    filters.push(baseFilter);

    if (config.fetch.include_kind1) {
      filters.push({ authors: [pubkey], kinds: [1], since: config.fetch.since, until: config.fetch.until });
    }

    const deletionFilter = {
      authors: [pubkey],
      kinds: [5],
      since: config.fetch.since,
      until: config.fetch.until
    };

    const [events, deletions] = await Promise.all([
      Promise.all(filters.map(f => pool.querySync(relays, f))).then(results => results.flat()),
      pool.querySync(relays, deletionFilter)
    ]);

    const deletedIds = collectDeletedIds(deletions);
    const deduped = new Map();

    let totalEvents = 0;
    let filteredOut = 0;

    for (const event of events) {
      totalEvents++;

      if (!event.content || !event.content.trim()) continue;
      if (deletedIds.has(event.id)) continue;

      if (!shouldIncludePost(event, pubkey)) {
        filteredOut++;
        continue;
      }

      if (!deduped.has(event.id)) {
        deduped.set(event.id, event);
      }
    }

    console.log(`Filtering results: ${totalEvents} total events, ${filteredOut} filtered out, ${deduped.size} included`);

    const result = Array.from(deduped.values());
    cache.set(cacheKey, result);
    return result;
  }
}

export async function fetchComments(pool, relays, articleEventIds) {
  if (articleEventIds.length === 0) return new Map();

  const filter = {
    kinds: [1],
    "#e": articleEventIds
  };

  const events = await pool.querySync(relays, filter);
  const commentsByArticle = new Map();

  for (const event of events) {
    const replyToTag = event.tags.find(tag => tag[0] === "e" && articleEventIds.includes(tag[1]));
    if (replyToTag) {
      const articleId = replyToTag[1];
      if (!commentsByArticle.has(articleId)) {
        commentsByArticle.set(articleId, []);
      }
      commentsByArticle.get(articleId).push(event);
    }
  }

  const authorPubkeys = [...new Set(events.map(e => e.pubkey))];
  const profiles = new Map();

  if (authorPubkeys.length > 0) {
    const profileFilter = {
      kinds: [0],
      authors: authorPubkeys
    };
    const profileEvents = await pool.querySync(relays, profileFilter);

    for (const event of profileEvents) {
      try {
        const metadata = JSON.parse(event.content);
        profiles.set(event.pubkey, metadata);
      } catch {
        // Ignore invalid profiles
      }
    }
  }

  const result = new Map();
  for (const [articleId, events] of commentsByArticle.entries()) {
    const comments = events
      .sort((a, b) => a.created_at - b.created_at)
      .map(event => {
        const profile = profiles.get(event.pubkey);
        return {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          author_name: profile?.display_name || profile?.name,
          author_picture: profile?.picture
        };
      });
    result.set(articleId, comments);
  }

  return result;
}
