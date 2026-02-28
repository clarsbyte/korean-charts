/* eslint-disable @typescript-eslint/no-require-imports */
const cheerio = require("cheerio");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function getHtml(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...extraHeaders,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

async function scrapeYouTubeVideo(songTitle, artist = "") {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY environment variable is not set");
  }

  const query = [artist, songTitle, "official music video"].filter(Boolean).join(" ");

  // 1. Search for videos
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("maxResults", "10");
  searchUrl.searchParams.set("key", apiKey);

  const searchResponse = await fetch(searchUrl.toString(), { cache: "no-store" });
  if (!searchResponse.ok) {
    const body = await searchResponse.text();
    throw new Error(`YouTube API search failed: ${searchResponse.status} — ${body}`);
  }

  const searchData = await searchResponse.json();
  const items = Array.isArray(searchData?.items) ? searchData.items : [];

  if (!items.length) {
    throw new Error("No YouTube videos found");
  }

  // 2. Fetch view counts in one batched call (costs only 1 unit total)
  const videoIds = items.map((item) => item.id?.videoId).filter(Boolean);
  const statsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  statsUrl.searchParams.set("part", "statistics");
  statsUrl.searchParams.set("id", videoIds.join(","));
  statsUrl.searchParams.set("key", apiKey);

  const statsResponse = await fetch(statsUrl.toString(), { cache: "no-store" });
  const statsData = statsResponse.ok ? await statsResponse.json() : null;

  const statsMap = {};
  for (const video of (statsData?.items ?? [])) {
    statsMap[video.id] = video.statistics;
  }

  // 3. Build candidates (API already returns results in relevance order)
  const candidates = items
    .map((item) => {
      const videoId = String(item.id?.videoId || "").trim();
      const title = decodeHtml(String(item.snippet?.title || "").trim());
      const channel = decodeHtml(String(item.snippet?.channelTitle || "").trim());
      const stats = statsMap[videoId] || {};
      const views = Number.parseInt(stats.viewCount || "0", 10) || 0;
      const viewText = views ? `${views.toLocaleString("en-US")} views` : "";

      if (!videoId || !title) return null;
      return { videoId, title, channel, views, viewText };
    })
    .filter(Boolean);

  if (!candidates.length) {
    throw new Error("No valid YouTube MV candidate found");
  }

  console.log(`[YouTube API] Query: ${query}`);
  candidates.forEach((c, i) => {
    console.log(`[YouTube API] #${i + 1}: ${c.title} | ${c.channel} | ${c.viewText} | https://www.youtube.com/watch?v=${c.videoId}`);
  });

  // API relevance ordering is reliable; only skip if the top result is clearly audio/lyrics only
  const best = candidates.find((c) => !/\b(audio|lyric|lyrics)\b/i.test(c.title)) ?? candidates[0];

  return {
    query,
    title: best.title,
    channel: best.channel,
    views: best.views,
    viewText: best.viewText,
    videoId: best.videoId,
    url: `https://www.youtube.com/watch?v=${best.videoId}`,
    candidates: candidates.map((c) => ({
      title: c.title,
      channel: c.channel,
      views: c.views,
      viewText: c.viewText,
      url: `https://www.youtube.com/watch?v=${c.videoId}`,
    })),
  };
}

async function scrapeBugs() {
  const html = await getHtml("https://music.bugs.co.kr/chart");
  const $ = cheerio.load(html);
  const results = [];

  $("a.btnActions").each((i, elem) => {
    const songTitle = ($(elem).attr("track_title") || "").trim();
    const artist = ($(elem).attr("artist_disp_nm") || "").trim();
    const artistId = ($(elem).attr("artist_id") || "").trim() || null;
    const album = ($(elem).closest("tr").find("a.album").attr("title") || "").trim();

    if (songTitle) {
      results.push({
        rank: String(i + 1),
        songTitle,
        artist,
        album,
        songId: null,
        artistId,
      });
    }
  });

  return results;
}

async function scrapeMelon() {
  const html = await getHtml("https://www.melon.com/chart/");
  const $ = cheerio.load(html);
  const results = [];

  $("tr.lst50, tr.lst100").each((_, row) => {
    const rank = $(row).find(".rank").first().text().trim();
    const songTitle = $(row).find(".rank01 a").text().trim();
    const artist = $(row).find(".rank02 a").first().text().trim();
    const album = $(row).find(".rank03 a").text().trim();
    const songId = ($(row).attr("data-song-no") || "").trim() || null;

    if (rank && songTitle) {
      results.push({ rank, songTitle, artist, album, songId, artistId: null });
    }
  });

  return results;
}

async function scrapeFlo() {
  const response = await fetch("https://www.music-flo.com/api/chartnchannel/v1/chart/track/1", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://www.music-flo.com/",
      Origin: "https://www.music-flo.com",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`FLO request failed: ${response.status}`);
  }

  const payload = await response.json();
  const trackList = payload?.data?.trackList;

  if (!Array.isArray(trackList)) {
    throw new Error("Unexpected FLO response format");
  }

  return trackList
    .map((track, index) => {
      const rank = String(index + 1);
      const songTitle = String(track?.name ?? "").trim();
      const album = String(track?.album?.title ?? "").trim();
      const artist =
        String(track?.representationArtist?.name ?? "").trim() ||
        (Array.isArray(track?.artistList)
          ? track.artistList
              .map((entry) => String(entry?.name ?? "").trim())
              .filter(Boolean)
              .join(", ")
          : "");
      const songId = track?.id ? String(track.id) : null;

      if (!songTitle) {
        return null;
      }

      return {
        rank,
        songTitle,
        artist,
        album,
        songId,
        artistId: null,
      };
    })
    .filter(Boolean);
}

async function scrapeGenie() {
  const html = await getHtml("https://www.genie.co.kr/chart/top200");
  const $ = cheerio.load(html);
  const results = [];

  $("tr.list").each((_, row) => {
    const rank = $(row).find("td.number").contents().first().text().trim();
    const songTitle = $(row).find("td.info a.title").text().trim();
    const artist = $(row).find("td.info a.artist").text().trim();
    const album = $(row).find("td.info a.albumtitle").text().trim();
    const songId = ($(row).attr("songid") || "").trim() || null;

    if (rank && songTitle) {
      results.push({ rank, songTitle, artist, album, songId, artistId: null });
    }
  });

  return results;
}

async function scrapeNaver() {
  const response = await fetch(
    "https://apis.naver.com/vibeWeb/musicapiweb/vibe/v1/chart/track/total?start=1&display=100",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://vibe.naver.com/",
        Origin: "https://vibe.naver.com",
        Accept: "application/xml, text/xml, */*",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Naver request failed: ${response.status}`);
  }

  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const results = [];

  $("tracks > track").each((_, el) => {
    const rank = $(el).find("rank > currentRank").text().trim();
    const songTitle = $(el).find("trackTitle").text().trim();
    const artist = $(el).find("artists > artist").first().find("artistName").text().trim();
    const album = $(el).find("album > albumTitle").text().trim();
    const songId = $(el).find("trackId").text().trim() || null;
    const artistId =
      $(el).find("artists > artist").first().find("artistId").text().trim() || null;

    if (rank && songTitle) {
      results.push({ rank, songTitle, artist, album, songId, artistId });
    }
  });

  return results;
}

async function scrapeHanteo() {
  const response = await fetch(
    "https://api.hanteochart.io/v4/ranking/list/ALBUM/REAL/BASIC?limit=100&lang=KO",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.hanteochart.com/",
        Origin: "https://www.hanteochart.com",
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Hanteo request failed: ${response.status}`);
  }

  const data = await response.json();
  const list = data?.resultData?.list;

  if (!Array.isArray(list)) {
    throw new Error("Unexpected Hanteo response format");
  }

  return list
    .map((item) => {
      const rank = String(item?.rank ?? "").trim();
      const album = String(item?.targetName ?? "").trim();
      const artist = String(item?.detail?.artistGlobalName ?? "").trim();

      if (!rank || !album) {
        return null;
      }

      return {
        rank,
        songTitle: album,
        artist,
        album: "",
        songId: null,
        artistId: null,
      };
    })
    .filter(Boolean);
}

async function runScraper(source, scraper) {
  try {
    const items = await scraper();
    return { source, items, count: items.length, error: null };
  } catch (error) {
    return {
      source,
      items: [],
      count: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function getChartsData() {
  const sources = await Promise.all([
    runScraper("bugs", scrapeBugs),
    runScraper("melon", scrapeMelon),
    runScraper("flo", scrapeFlo),
    runScraper("genie", scrapeGenie),
    runScraper("naver", scrapeNaver),
    runScraper("hanteo", scrapeHanteo),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    sources,
  };
}

module.exports = {
  scrapeBugs,
  scrapeMelon,
  scrapeFlo,
  scrapeGenie,
  scrapeNaver,
  scrapeHanteo,
  scrapeYouTubeVideo,
  getChartsData,
};


