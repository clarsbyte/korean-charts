"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// --- Types ---

type ChartItem = {
  rank: string;
  songTitle: string;
  artist: string;
  album: string;
  songId: string | null;
  artistId: string | null;
};

type ChartSource = {
  source: string;
  items: ChartItem[];
  count: number;
  error: string | null;
};

type ChartsResponse = {
  generatedAt: string;
  sources: ChartSource[];
  error?: string;
};

type MatchResult = {
  totalOutOf50: number;
  normalizedOutOf100: number;
  digitalScore: number;
  albumScore: number;
  digitalMatches: Array<{
    source: string;
    item: ChartItem | null;
    normalized: number;
    weighted: number;
  }>;
  hanteoMatch: {
    item: ChartItem | null;
    normalized: number;
    weighted: number;
  };
};

type Candidate = {
  label: string;
  songTitle: string;
  artist: string;
};

type YouTubeLookup = {
  videoId?: string;
  title: string;
  channel: string;
  viewText: string;
  views: number;
  url: string;
  candidates?: Array<{
    title: string;
    channel: string;
    viewText: string;
    views: number;
    url: string;
  }>;
  error?: string;
};

// --- Constants ---

const DIGITAL_SOURCES = ["bugs", "melon", "flo", "genie", "naver"];
const STAGE_SIZE = 5;

// --- Helpers ---

function extractVideoId(url: string): string | null {
  try {
    return new URL(url).searchParams.get("v");
  } catch {
    return null;
  }
}

function makeKey(c: Candidate): string {
  return `${normalizeText(c.songTitle)}::${normalizeText(c.artist)}`;
}

function emptyMatchResult(): MatchResult {
  return {
    totalOutOf50: 0,
    normalizedOutOf100: 0,
    digitalScore: 0,
    albumScore: 0,
    digitalMatches: DIGITAL_SOURCES.map((source) => ({
      source,
      item: null,
      normalized: 0,
      weighted: 0,
    })),
    hanteoMatch: { item: null, normalized: 0, weighted: 0 },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/feat\.?|featuring|with|prod\.?/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalAlbumName(value: string): string {
  const noBracket = value.replace(/\(.*?\)|\[.*?\]/g, " ");
  const preVersion = noBracket
    .replace(/,\s*[^,]*\b(ver|version)\b.*$/iu, " ")
    .replace(/,\s*[^,]*$/u, " ");
  return normalizeText(preVersion)
    .replace(/\b(ver|version|mini|digipack|poster|kit|limited|special)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokenRegex(value: string): RegExp | null {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  if (!tokens.length) return null;
  return new RegExp(
    tokens.map((token) => `(?=.*\\b${escapeRegExp(token)}\\b)`).join("") + ".*",
    "i",
  );
}

function isSongMatch(item: ChartItem, songTitle: string, artist: string): boolean {
  const titleRegex = toTokenRegex(songTitle);
  const artistRegex = toTokenRegex(artist);
  const itemTitle = item.songTitle || "";
  const itemArtist = item.artist || "";
  const titleMatches = titleRegex
    ? titleRegex.test(itemTitle) || toTokenRegex(itemTitle)?.test(songTitle) === true
    : false;
  const artistMatches = artistRegex
    ? artistRegex.test(itemArtist) || toTokenRegex(itemArtist)?.test(artist) === true
    : true;
  return titleMatches && artistMatches;
}

function isHanteoMatch(
  item: ChartItem,
  songTitle: string,
  artist: string,
  albumHints: string[] = [],
): boolean {
  const artistRegex = toTokenRegex(artist);
  const songRegex = toTokenRegex(songTitle);
  const canonicalSong = canonicalAlbumName(songTitle);
  const canonicalItem = canonicalAlbumName(item.songTitle || "");
  const canonicalSongRegex = canonicalSong ? toTokenRegex(canonicalSong) : null;
  const canonicalHints = [
    ...new Set(albumHints.map((entry) => canonicalAlbumName(entry)).filter(Boolean)),
  ];
  const byArtist = artistRegex ? artistRegex.test(item.artist || "") : false;
  const byAlbum = songRegex
    ? songRegex.test(item.songTitle || "") || songRegex.test(item.album || "")
    : false;
  const byCanonicalAlbum = canonicalSongRegex
    ? canonicalSongRegex.test(canonicalItem) ||
      (canonicalItem ? toTokenRegex(canonicalItem)?.test(canonicalSong) === true : false)
    : false;
  const byAlbumHints = canonicalHints.some((hint) => {
    const hintRegex = toTokenRegex(hint);
    if (!hintRegex) return false;
    return (
      hintRegex.test(canonicalItem) ||
      (canonicalItem ? toTokenRegex(canonicalItem)?.test(hint) === true : false)
    );
  });
  return (byAlbumHints || byAlbum || byCanonicalAlbum) && (artistRegex ? byArtist : true);
}

function toNormalizedRank(rank: string, totalItems: number): number {
  const numeric = Number.parseInt(rank, 10);
  if (!Number.isFinite(numeric) || numeric < 1 || totalItems < 1) return 0;
  const clampedRank = Math.min(numeric, totalItems);
  return (totalItems - clampedRank + 1) / totalItems;
}

function scoreSong(charts: ChartSource[], songTitle: string, artist: string): MatchResult {
  const digitalMatches = DIGITAL_SOURCES.map((sourceName) => {
    const source = charts.find((entry) => entry.source === sourceName);
    if (!source || source.error || !source.items.length)
      return { source: sourceName, item: null, normalized: 0, weighted: 0 };
    const found = source.items.find((item) => isSongMatch(item, songTitle, artist)) ?? null;
    const normalized = found ? toNormalizedRank(found.rank, source.items.length) : 0;
    return { source: sourceName, item: found, normalized, weighted: normalized * (40 / DIGITAL_SOURCES.length) };
  });
  const albumHints = digitalMatches
    .map((entry) => entry.item?.album || "")
    .filter((entry) => entry.trim().length > 0);
  const hanteoSource = charts.find((entry) => entry.source === "hanteo");
  let hanteoItem: ChartItem | null = null;
  let hanteoNormalized = 0;
  if (hanteoSource && !hanteoSource.error && hanteoSource.items.length) {
    const hanteoMatches = hanteoSource.items.filter((item) =>
      isHanteoMatch(item, songTitle, artist, albumHints),
    );
    if (hanteoMatches.length) {
      hanteoItem = hanteoMatches[0];
      hanteoNormalized = Math.max(
        ...hanteoMatches.map((item) => toNormalizedRank(item.rank, hanteoSource.items.length)),
      );
    }
  }
  const digitalScore = digitalMatches.reduce((sum, entry) => sum + entry.weighted, 0);
  const albumScore = hanteoNormalized * 10;
  const totalOutOf50 = digitalScore + albumScore;
  return {
    totalOutOf50,
    normalizedOutOf100: totalOutOf50 * 2,
    digitalScore,
    albumScore,
    digitalMatches,
    hanteoMatch: { item: hanteoItem, normalized: hanteoNormalized, weighted: albumScore },
  };
}

function buildAllChartCandidates(charts: ChartSource[]): Candidate[] {
  const firstDigital = charts.find((source) => source.source === DIGITAL_SOURCES[0]);
  if (!firstDigital || firstDigital.error) return [];
  const unique = new Map<string, Candidate>();
  for (const base of firstDigital.items) {
    const appearsEverywhere = DIGITAL_SOURCES.every((sourceName) => {
      const source = charts.find((entry) => entry.source === sourceName);
      if (!source || source.error) return false;
      return source.items.some((item) => isSongMatch(item, base.songTitle, base.artist));
    });
    if (!appearsEverywhere) continue;
    const key = `${normalizeText(base.songTitle)}::${normalizeText(base.artist)}`;
    if (!unique.has(key)) {
      unique.set(key, {
        label: `${base.songTitle} - ${base.artist || "Unknown Artist"}`,
        songTitle: base.songTitle,
        artist: base.artist,
      });
    }
  }
  return [...unique.values()];
}

function inferArtistFromCharts(charts: ChartSource[], songTitle: string): string {
  const counts = new Map<string, number>();
  for (const sourceName of DIGITAL_SOURCES) {
    const source = charts.find((entry) => entry.source === sourceName);
    if (!source || source.error) continue;
    const match = source.items.find((item) => isSongMatch(item, songTitle, ""));
    const artist = (match?.artist || "").trim();
    if (!artist) continue;
    counts.set(artist, (counts.get(artist) || 0) + 1);
  }
  let bestArtist = "";
  let bestCount = 0;
  for (const [artist, count] of counts.entries()) {
    if (count > bestCount) { bestArtist = artist; bestCount = count; }
  }
  return bestArtist;
}

// --- Component ---

export default function SimulatorPage() {
  const [data, setData] = useState<ChartsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageSlots, setStageSlots] = useState<(Candidate | null)[]>(Array(STAGE_SIZE).fill(null));
  const [youtubeByKey, setYoutubeByKey] = useState<Record<string, YouTubeLookup>>({});
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [dragSrc, setDragSrc] = useState<
    { from: "pool"; candidate: Candidate } | { from: "stage"; slotIndex: number } | null
  >(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/fetching", { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        setData((await response.json()) as ChartsResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chart data");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const candidates = useMemo(() => {
    if (!data?.sources) return [];
    return buildAllChartCandidates(data.sources);
  }, [data?.sources]);

  useEffect(() => {
    const active = stageSlots.filter((s): s is Candidate => s !== null);
    if (!active.length) return;
    let cancelled = false;
    const load = async () => {
      await Promise.all(
        active.map(async (slot) => {
          const inferredArtist =
            slot.artist.trim() ||
            (data?.sources ? inferArtistFromCharts(data.sources, slot.songTitle) : "");
          const key = `${normalizeText(slot.songTitle)}::${normalizeText(inferredArtist || slot.artist)}`;
          if (youtubeByKey[key]) return;
          try {
            const response = await fetch(
              `/api/youtube?song=${encodeURIComponent(slot.songTitle)}&artist=${encodeURIComponent(inferredArtist)}`,
              { cache: "no-store" },
            );
            const payload = (await response.json()) as YouTubeLookup;
            if (cancelled) return;
            setYoutubeByKey((prev) => ({
              ...prev,
              [key]: response.ok ? payload : { ...payload, views: 0 },
            }));
          } catch {
            if (cancelled) return;
            setYoutubeByKey((prev) => ({
              ...prev,
              [key]: { title: "", channel: "", viewText: "", views: 0, url: "", error: "YouTube lookup failed" },
            }));
          }
        }),
      );
    };
    load();
    return () => { cancelled = true; };
  }, [stageSlots, data?.sources, youtubeByKey]);

  const scoring = useMemo(() => {
    const rows = stageSlots.map((slot) => {
      const base = slot && data?.sources
        ? scoreSong(data.sources, slot.songTitle, slot.artist)
        : emptyMatchResult();
      const inferredArtist =
        slot?.artist.trim() ||
        (slot && data?.sources ? inferArtistFromCharts(data.sources, slot.songTitle) : "");
      const key = slot
        ? `${normalizeText(slot.songTitle)}::${normalizeText(inferredArtist || slot.artist)}`
        : null;
      const youtube = key ? youtubeByKey[key] ?? null : null;
      return { slot, base, youtube, youtubeScore: 0, totalOutOf70: 0 };
    });
    const maxViews = Math.max(0, ...rows.map((r) => r.youtube?.views ?? 0));
    return rows.map((row) => {
      const youtubeScore = maxViews > 0 ? ((row.youtube?.views ?? 0) / maxViews) * 20 : 0;
      const totalOutOf70 = row.base.totalOutOf50 + youtubeScore;
      return { ...row, youtubeScore, totalOutOf70 };
    });
  }, [stageSlots, data?.sources, youtubeByKey]);

  const ranking = useMemo(() => {
    return scoring
      .map((row, slotIndex) => ({ ...row, slotIndex }))
      .filter((row) => row.slot !== null)
      .sort((a, b) => b.totalOutOf70 - a.totalOutOf70);
  }, [scoring]);

  const updatedLabel = useMemo(() => {
    if (!data?.generatedAt) return "";
    return new Date(data.generatedAt).toLocaleString();
  }, [data?.generatedAt]);

  const filledCount = stageSlots.filter(Boolean).length;

  function handlePoolDragStart(candidate: Candidate) {
    setDragSrc({ from: "pool", candidate });
  }

  function handleStageDragStart(slotIndex: number) {
    if (!stageSlots[slotIndex]) return;
    setDragSrc({ from: "stage", slotIndex });
  }

  function handleDropOnSlot(targetIndex: number) {
    if (!dragSrc) return;
    const incoming =
      dragSrc.from === "pool" ? dragSrc.candidate : stageSlots[dragSrc.slotIndex];
    if (!incoming) return;
    setStageSlots((prev) => {
      const next = [...prev];
      if (dragSrc.from === "stage") {
        next[dragSrc.slotIndex] = next[targetIndex];
        next[targetIndex] = incoming;
      } else {
        next[targetIndex] = incoming;
      }
      return next;
    });
    setDragSrc(null);
    setDragOverSlot(null);
  }

  function handleDropOnPool() {
    if (dragSrc?.from === "stage") {
      const idx = dragSrc.slotIndex;
      setStageSlots((prev) => { const n = [...prev]; n[idx] = null; return n; });
    }
    setDragSrc(null);
    setDragOverSlot(null);
  }

  function handleDragEnd() {
    setDragSrc(null);
    setDragOverSlot(null);
  }

  function removeFromStage(index: number) {
    setStageSlots((prev) => { const n = [...prev]; n[index] = null; return n; });
  }

  function handlePoolTap(candidate: Candidate) {
    if (!isTouchDevice) return;
    const firstEmpty = stageSlots.findIndex((s) => s === null);
    if (firstEmpty === -1) return;
    setStageSlots((prev) => { const n = [...prev]; n[firstEmpty] = candidate; return n; });
  }

  const SimNav = () => (
    <nav className="site-nav">
      <Link href="/" className="nav-back">← Back to charts</Link>
    </nav>
  );

  if (isLoading) {
    return (
      <>
        <SimNav />
        <main className="sim-page">
          <div className="loading-wrap">
            <div className="loading-dots"><span /><span /><span /></div>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <SimNav />
        <main className="sim-page">
          <p className="sim-status sim-error">{error}</p>
        </main>
      </>
    );
  }

  return (
    <>
    <SimNav />
    <main className="sim-page">
      <section className="hero-block">
        <p className="eyebrow">K-pop Music Show Simulator</p>
        <h1>Pick Your Contenders</h1>
        <p className="hero-copy">
          Drag songs from the lineup onto the stage. Scores combine digital charts (40%), Hanteo
          album sales (10%), and YouTube views (20%). Available songs are those that appear across all major digital charts. Fan votes not incorporated.
        </p>
        <p className="hero-meta">Updated {updatedLabel || "recently"}</p>
      </section>

      <div
        className="lineup-wrap"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnPool}
      >
        <div className="lineup-hd">
          <span className="lineup-label">Lineup</span>
          <span className="lineup-sub">
            {candidates.length} songs · drag to the stage below
          </span>
        </div>
        <div className="lineup-grid">
          {candidates.length === 0 && (
            <p className="lineup-empty">No cross-chart songs found.</p>
          )}
          {candidates.map((c) => {
            const onStage = stageSlots.some((s) => s?.label === c.label);
            return (
              <div
                key={c.label}
                className={`lcard${onStage ? " lcard--used" : ""}`}
                draggable={!onStage}
                onDragStart={() => !onStage && handlePoolDragStart(c)}
                onDragEnd={handleDragEnd}
                onClick={() => !onStage && handlePoolTap(c)}
              >
                <span className="lcard-handle" aria-hidden>⠿</span>
                <span className="lcard-text">
                  <span className="lcard-song">{c.songTitle}</span>
                  <span className="lcard-artist">{c.artist}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/*  The Stage  */}
      <div className="sth-wrap">
        <div className="sth-back">
          <span className="sth-name">★ &nbsp;THE STAGE&nbsp; ★</span>
          <span className="sth-count">{filledCount} / {STAGE_SIZE} filled</span>
        </div>

\        <div className="sth-perf">
          {stageSlots.map((slot, i) => {
            const yt = slot ? (youtubeByKey[makeKey(slot)] ?? null) : null;
            const videoId = yt?.videoId ?? (yt?.url ? extractVideoId(yt.url) : null);
            const thumbUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
            const rowScore = scoring[i];
            const isOver = dragOverSlot === i;

            return (
              <div
                key={i}
                className={`spos${slot ? " spos--filled" : " spos--empty"}${isOver ? " spos--over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (dragOverSlot !== i) setDragOverSlot(i); }}
                onDragLeave={() => { if (dragOverSlot === i) setDragOverSlot(null); }}
                onDrop={() => handleDropOnSlot(i)}
              >
                {slot ? (
                  <div
                    className="sperf"
                    draggable
                    onDragStart={() => handleStageDragStart(i)}
                    onDragEnd={handleDragEnd}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={slot.songTitle} className="sperf-thumb" />
                    ) : (
                      <div className="sperf-ph">{yt === null ? "♪" : "—"}</div>
                    )}
                    <div className="sperf-body">
                      <strong className="sperf-title">{slot.songTitle}</strong>
                      <span className="sperf-artist">{slot.artist}</span>
                      {yt && !yt.error && (
                        <span className="sperf-views">{yt.viewText}</span>
                      )}
                      {rowScore.totalOutOf70 > 0 && (
                        <span className="sperf-score">{rowScore.totalOutOf70.toFixed(1)}<span className="sperf-score-denom"> / 70</span></span>
                      )}
                    </div>
                    <button
                      className="sperf-rm"
                      onClick={() => removeFromStage(i)}
                      aria-label="Remove from stage"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="spos-inner">
                    <span className="spos-num">{i + 1}</span>
                    <span className="spos-hint">{isOver ? "drop!" : "drag here"}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="sth-floor">
          {stageSlots.map((slot, i) => (
            <div key={i} className={`sth-dot${slot ? " sth-dot--on" : ""}`} />
          ))}
        </div>
      </div>

      {/*  Ranking Table  */}
      {ranking.length > 0 && (
        <section className="panel ranking-panel">
          <h2 className="rank-heading">Predicted Ranking</h2>
          <div className="rank-table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Song</th>
                  <th>Digital</th>
                  <th>Album</th>
                  <th>YouTube</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((row, index) => {
                  const videoId =
                    row.youtube?.videoId ??
                    (row.youtube?.url ? extractVideoId(row.youtube.url) : null);
                  const thumbUrl = videoId
                    ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
                    : null;
                  return (
                    <tr key={`rank-${row.slotIndex}`}>
                      <td><span className="rank-num">{index + 1}</span></td>
                      <td>
                        <div className="rank-song-cell">
                          {thumbUrl && (
                            <img src={thumbUrl} alt={row.slot!.songTitle} className="rank-thumb" />
                          )}
                          <div className="rank-song-info">
                            <strong>{row.slot!.songTitle}</strong>
                            <p className="row-meta">{row.slot!.artist}</p>
                            {row.youtube?.error ? (
                              <p className="row-meta">{row.youtube.error}</p>
                            ) : row.youtube?.url ? (
                              <p className="row-meta">
                                <a href={row.youtube.url} target="_blank" rel="noreferrer">
                                  {row.youtube.title}
                                </a>
                                {" · "}{row.youtube.viewText}
                              </p>
                            ) : (
                              <p className="row-meta">Fetching YouTube…</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{row.base.digitalScore.toFixed(2)} / 40</td>
                      <td>{row.base.albumScore.toFixed(2)} / 10</td>
                      <td>{row.youtubeScore.toFixed(2)} / 20</td>
                      <td><strong>{row.totalOutOf70.toFixed(2)} / 70</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
    </>
  );
}
