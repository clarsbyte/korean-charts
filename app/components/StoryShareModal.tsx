"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Download, Share2, X } from "lucide-react";

export type ChartStats = {
    source: string;
    rank: string;
};

type StoryShareModalProps = {
    songTitle: string;
    artist: string;
    chartStats: ChartStats[];
    onClose: () => void;
};

const SOURCE_COLORS: Record<string, string> = {
    bugs: "#e8185a",
    melon: "#16a34a",
    flo: "#2563eb",
    genie: "#9333ea",
    naver: "#03c75a",
    hanteo: "#d97706",
};

export default function StoryShareModal({
    songTitle,
    artist,
    chartStats,
    onClose,
}: StoryShareModalProps) {
    const EXPORT_WIDTH = 1080;
    const EXPORT_HEIGHT = 1920;
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageError, setImageError] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [imageBaseColor, setImageBaseColor] = useState<string | null>(null);
    const [useAutoColor, setUseAutoColor] = useState(true);
    const [manualColor, setManualColor] = useState("#333333");
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const albumImageRef = useRef<HTMLImageElement | null>(null);

    const toDataUrl = async (url: string) => {
        try {
            const res = await fetch(url, { cache: "force-cache" });
            if (!res.ok) return null;
            const blob = await res.blob();
            return await new Promise<string | null>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
        } catch {
            return null;
        }
    };

    const rgbToHex = (r: number, g: number, b: number) =>
        `#${[r, g, b]
            .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
            .join("")}`;

    const shadeColor = useCallback((hex: string, amount: number) => {
        const normalized = hex.replace("#", "");
        const color = normalized.length === 3
            ? normalized.split("").map((c) => c + c).join("")
            : normalized;
        const r = parseInt(color.slice(0, 2), 16);
        const g = parseInt(color.slice(2, 4), 16);
        const b = parseInt(color.slice(4, 6), 16);
        const apply = (value: number) => value + (amount >= 0 ? (255 - value) * amount : value * amount);
        return rgbToHex(apply(r), apply(g), apply(b));
    }, []);

    // Load the album cover
    useEffect(() => {
        let cancelled = false;

        const fetchImage = async () => {
            try {
                const query = `${songTitle} ${artist}`;
                const res = await fetch(
                    `/api/flo-image?keyword=${encodeURIComponent(query)}`
                );
                if (res.ok) {
                    const data = await res.json();
                    const candidateUrls: string[] = [data.proxyImageUrl, data.imageUrl].filter(Boolean);
                    let safeDataUrl: string | null = null;
                    let fallbackUrl: string | null = null;

                    for (const url of candidateUrls) {
                        if (!fallbackUrl) fallbackUrl = url;
                        const converted = await toDataUrl(url);
                        if (converted) {
                            safeDataUrl = converted;
                            break;
                        }
                    }

                    if (cancelled) return;

                    if (safeDataUrl) {
                        setImageUrl(safeDataUrl);
                    } else if (fallbackUrl) {
                        setImageUrl(fallbackUrl);
                    } else {
                        setImageError(true);
                    }
                } else {
                    setImageError(true);
                }
            } catch {
                setImageError(true);
            }
        };

        fetchImage();

        return () => {
            cancelled = true;
        };
    }, [songTitle, artist]);

    // Pre-load album image into an Image element for canvas drawing
    useEffect(() => {
        if (!imageUrl) {
            albumImageRef.current = null;
            return;
        }
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            albumImageRef.current = img;
        };
        img.onerror = () => {
            albumImageRef.current = null;
        };
        img.src = imageUrl;
    }, [imageUrl]);

    useEffect(() => {
        let cancelled = false;

        const extractImageColor = async () => {
            if (!imageUrl) {
                setImageBaseColor(null);
                return;
            }

            try {
                const img = new window.Image();

                const color = await new Promise<string | null>((resolve) => {
                    img.onload = () => {
                        try {
                            const canvas = document.createElement("canvas");
                            const ctx = canvas.getContext("2d");
                            if (!ctx) return resolve(null);

                            const sampleSize = 48;
                            canvas.width = sampleSize;
                            canvas.height = sampleSize;
                            ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

                            const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
                            let totalWeight = 0;
                            let rSum = 0;
                            let gSum = 0;
                            let bSum = 0;

                            for (let i = 0; i < pixels.length; i += 16) {
                                const r = pixels[i];
                                const g = pixels[i + 1];
                                const b = pixels[i + 2];
                                const alpha = pixels[i + 3];
                                if (alpha < 120) continue;

                                const max = Math.max(r, g, b);
                                const min = Math.min(r, g, b);
                                const saturation = max === 0 ? 0 : (max - min) / max;
                                const brightness = (r + g + b) / 765;
                                const weight = 0.5 + saturation * 0.8 + brightness * 0.3;

                                rSum += r * weight;
                                gSum += g * weight;
                                bSum += b * weight;
                                totalWeight += weight;
                            }

                            if (totalWeight === 0) return resolve(null);
                            resolve(rgbToHex(rSum / totalWeight, gSum / totalWeight, bSum / totalWeight));
                        } catch {
                            resolve(null);
                        }
                    };
                    img.onerror = () => resolve(null);
                    img.src = imageUrl;
                });

                if (!cancelled) setImageBaseColor(color);
            } catch {
                if (!cancelled) setImageBaseColor(null);
            }
        };

        extractImageColor();

        return () => {
            cancelled = true;
        };
    }, [imageUrl]);

    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    const fallbackColor = useMemo(() => {
        if (chartStats.length > 0) {
            return SOURCE_COLORS[chartStats[0].source.toLowerCase()] || "#333333";
        }
        return "#333333";
    }, [chartStats]);

    const autoColor = imageBaseColor || fallbackColor;
    const activeColor = useAutoColor ? autoColor : manualColor;

    /** Draw a rounded rectangle path */
    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    /** Measure text and truncate with ellipsis if needed */
    const truncateText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let truncated = text;
        while (truncated.length > 0 && ctx.measureText(truncated + "\u2026").width > maxWidth) {
            truncated = truncated.slice(0, -1);
        }
        return truncated + "\u2026";
    };

    /** Load an image from a data URL / src into an HTMLImageElement, resolving when ready */
    const loadImage = (src: string): Promise<HTMLImageElement | null> =>
        new Promise((resolve) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });

    const generateImage = useCallback(async () => {
        const W = EXPORT_WIDTH;
        const H = EXPORT_HEIGHT;

        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        try {
            // Ensure the album image is loaded before drawing
            let albumImg: HTMLImageElement | null = albumImageRef.current;
            if (!albumImg && imageUrl) {
                albumImg = await loadImage(imageUrl);
            }

            // --- Background gradient (160deg) ---
            const x0 = W * 0.15, y0 = 0, x1 = W * 0.85, y1 = H;
            const grad = ctx.createLinearGradient(x0, y0, x1, y1);
            grad.addColorStop(0, shadeColor(activeColor, 0.2));
            grad.addColorStop(0.45, activeColor);
            grad.addColorStop(1, shadeColor(activeColor, -0.55));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // --- Card dimensions ---
            const cardPadX = 80;
            const cardW = W - cardPadX * 2;
            const cardX = cardPadX;
            const cardRadius = 40;
            const innerPad = 48;

            // Calculate card height dynamically
            const albumSize = 460;
            const albumGap = 56;
            const titleFontSize = 72;
            const artistFontSize = 54;
            const titleGap = 8;
            const afterArtistGap = 56;
            const statLabelFontSize = 34;
            const statPillH = 96;
            const statPillFontSize = 64;
            const statRowGapY = 28;
            const statLabelGap = 12;

            // Stat rows layout
            const statsPerRow = 3;
            const statRows = Math.ceil(chartStats.length / statsPerRow);
            const statsBlockH = statRows * (statLabelFontSize + statLabelGap + statPillH) + (statRows - 1) * statRowGapY;

            const cardContentH = innerPad + albumSize + albumGap + titleFontSize + titleGap + artistFontSize + afterArtistGap + statsBlockH + innerPad;
            const cardH = cardContentH;
            const cardY = (H - cardH) / 2 - 40; // slightly above center

            // Draw card background
            roundRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fill();

            // Card border
            roundRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
            ctx.strokeStyle = "rgba(255,255,255,0.1)";
            ctx.lineWidth = 2;
            ctx.stroke();

            // --- Album art ---
            const albumX = cardX + (cardW - albumSize) / 2;
            const albumY = cardY + innerPad;
            const albumRadius = 20;

            // Clip and draw album image
            ctx.save();
            roundRect(ctx, albumX, albumY, albumSize, albumSize, albumRadius);
            ctx.clip();

            if (albumImg) {
                ctx.drawImage(albumImg, albumX, albumY, albumSize, albumSize);
            } else {
                // Fallback placeholder
                ctx.fillStyle = "rgba(255,255,255,0.05)";
                ctx.fillRect(albumX, albumY, albumSize, albumSize);
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.font = `500 ${28}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(imageError ? "No Image" : "", albumX + albumSize / 2, albumY + albumSize / 2);
            }
            ctx.restore();

            // --- Song title ---
            const textMaxW = cardW - innerPad * 2;
            const titleY = albumY + albumSize + albumGap + titleFontSize;
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            const truncTitle = truncateText(ctx, songTitle, textMaxW);
            ctx.fillText(truncTitle, W / 2, titleY);

            // --- Artist ---
            const artistY = titleY + titleGap + artistFontSize;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = `500 ${artistFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            const truncArtist = truncateText(ctx, artist, textMaxW);
            ctx.fillText(truncArtist, W / 2, artistY);

            // --- Chart stat pills ---
            const statsStartY = artistY + afterArtistGap;
            const statPillMinW = 170;
            const statGapX = 44;

            for (let row = 0; row < statRows; row++) {
                const rowStats = chartStats.slice(row * statsPerRow, (row + 1) * statsPerRow);
                const rowY = statsStartY + row * (statLabelFontSize + statLabelGap + statPillH + statRowGapY);

                // Measure total row width to center it
                const pillWidths = rowStats.map((stat) => {
                    ctx.font = `bold ${statPillFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                    const textW = ctx.measureText(`#${stat.rank}`).width;
                    return Math.max(statPillMinW, textW + 48);
                });
                const totalRowW = pillWidths.reduce((a, b) => a + b, 0) + (rowStats.length - 1) * statGapX;
                let pillX = (W - totalRowW) / 2;

                for (let i = 0; i < rowStats.length; i++) {
                    const stat = rowStats[i];
                    const pillW = pillWidths[i];
                    const pillCenterX = pillX + pillW / 2;

                    // Source label
                    ctx.fillStyle = "rgba(255,255,255,0.6)";
                    ctx.font = `600 ${statLabelFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "alphabetic";
                    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
                    ctx.fillText(stat.source.toUpperCase(), pillCenterX, rowY + statLabelFontSize);
                    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

                    // Pill background
                    const pillY = rowY + statLabelFontSize + statLabelGap;
                    const pillRadius = statPillH / 2;
                    const bgColor = SOURCE_COLORS[stat.source.toLowerCase()] || "#111111";
                    roundRect(ctx, pillX, pillY, pillW, statPillH, pillRadius);
                    ctx.fillStyle = bgColor;
                    ctx.fill();

                    // Pill text
                    ctx.fillStyle = "#ffffff";
                    ctx.font = `bold ${statPillFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(`#${stat.rank}`, pillCenterX, pillY + statPillH / 2 + 2);

                    pillX += pillW + statGapX;
                }
            }

            // --- "KCharts" watermark ---
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.font = `500 ${28}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillText("KCharts", W / 2, H - 80);

            return canvas.toDataURL("image/jpeg", 0.95);
        } catch (err) {
            console.error("Error generating image:", err);
            return null;
        }
    }, [activeColor, songTitle, artist, chartStats, imageError, imageUrl, shadeColor]);

    // Generate preview whenever inputs change
    useEffect(() => {
        let cancelled = false;

        const updatePreview = async () => {
            const dataUrl = await generateImage();
            if (!cancelled) {
                setPreviewDataUrl(dataUrl);
            }
        };

        updatePreview();

        return () => {
            cancelled = true;
        };
    }, [generateImage]);

    const handleDownload = async () => {
        setIsGenerating(true);
        // Use existing preview if available, otherwise regenerate
        const dataUrl = previewDataUrl ?? await generateImage();
        setIsGenerating(false);

        if (dataUrl) {
            const link = document.createElement("a");
            link.download = `${songTitle}-chart-stats.jpg`;
            link.href = dataUrl;
            link.click();
        }
    };

    const handleShare = async () => {
        setIsGenerating(true);
        const dataUrl = previewDataUrl ?? await generateImage();
        setIsGenerating(false);

        if (dataUrl && navigator.share) {
            try {
                const blob = await fetch(dataUrl).then((r) => r.blob());
                const file = new File([blob], "story.jpg", { type: "image/jpeg" });

                await navigator.share({
                    title: `${songTitle} Chart Stats`,
                    files: [file],
                });
            } catch (err) {
                console.error("Native share failed:", err);
            }
        } else {
            alert("Native sharing is not supported on this browser.");
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4">
            {/* Container */}
            <div className="relative w-full max-w-[340px] sm:max-w-[420px] flex flex-col gap-3 sm:gap-4 my-4">
                <button
                    onClick={onClose}
                    className="absolute -top-11 right-0 p-2 text-white hover:bg-white/10 rounded-full transition-colors"
                    aria-label="Close"
                >
                    <X size={20} className="sm:h-6 sm:w-6" />
                </button>

                {/* Story Preview — rendered from the same canvas used for download */}
                <div className="relative w-full aspect-[9/16] rounded-xl sm:rounded-2xl overflow-hidden bg-zinc-900">
                    {previewDataUrl ? (
                        <img
                            src={previewDataUrl}
                            alt="Story preview"
                            className="w-full h-full object-contain"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">
                            Generating preview…
                        </div>
                    )}
                </div>

                <div className="w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 sm:px-4 py-3 text-white">
                    <p className="text-xs uppercase tracking-wider text-white/60 mb-2">Story Background</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <button
                            onClick={() => setUseAutoColor(true)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${useAutoColor
                                ? "bg-white text-black border-white"
                                : "bg-transparent text-white/80 border-white/20 hover:border-white/40"
                                }`}
                        >
                            Auto from cover
                        </button>
                        <label className="flex items-center gap-2 text-sm text-white/85">
                            <span>Custom</span>
                            <input
                                type="color"
                                value={manualColor}
                                onChange={(e) => {
                                    setManualColor(e.target.value);
                                    setUseAutoColor(false);
                                }}
                                className="h-8 w-10 rounded border border-white/20 bg-transparent cursor-pointer"
                                aria-label="Pick custom background color"
                            />
                        </label>
                        <span
                            className="sm:ml-auto h-6 w-6 rounded-md border border-white/20"
                            style={{ backgroundColor: activeColor }}
                            aria-hidden
                        />
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 sm:gap-4 w-full">
                    <button
                        onClick={handleDownload}
                        disabled={isGenerating || !previewDataUrl}
                        className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl flex items-center gap-2 justify-center transition-colors disabled:opacity-50 text-sm sm:text-base"
                    >
                        <Download size={18} className="sm:h-5 sm:w-5" />
                        Download
                    </button>
                    {canNativeShare && (
                        <button
                            onClick={handleShare}
                            disabled={isGenerating || !previewDataUrl}
                            className="flex-1 bg-white text-black font-semibold py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl flex items-center gap-2 justify-center hover:bg-white/90 transition-colors disabled:opacity-50 text-sm sm:text-base"
                        >
                            <Share2 size={18} className="sm:h-5 sm:w-5" />
                            Share
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
