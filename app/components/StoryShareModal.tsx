"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Download, Share2, X } from "lucide-react";
import * as htmlToImage from "html-to-image";

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
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageError, setImageError] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [imageBaseColor, setImageBaseColor] = useState<string | null>(null);
    const [useAutoColor, setUseAutoColor] = useState(true);
    const [manualColor, setManualColor] = useState("#333333");
    const storyRef = useRef<HTMLDivElement>(null);

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

    const shadeColor = (hex: string, amount: number) => {
        const normalized = hex.replace("#", "");
        const color = normalized.length === 3
            ? normalized.split("").map((c) => c + c).join("")
            : normalized;
        const r = parseInt(color.slice(0, 2), 16);
        const g = parseInt(color.slice(2, 4), 16);
        const b = parseInt(color.slice(4, 6), 16);
        const apply = (value: number) => value + (amount >= 0 ? (255 - value) * amount : value * amount);
        return rgbToHex(apply(r), apply(g), apply(b));
    };

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

    useEffect(() => {
        let cancelled = false;

        const extractImageColor = async () => {
            if (!imageUrl) {
                setImageBaseColor(null);
                return;
            }

            try {
                const img = new window.Image();
                img.crossOrigin = "anonymous";
                img.referrerPolicy = "no-referrer";

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

    const generateImage = async () => {
        if (!storyRef.current) return null;
        try {
            const previewWidth = storyRef.current.getBoundingClientRect().width || 360;
            const targetPixelRatio = Math.max(2, EXPORT_WIDTH / previewWidth);

            const images = Array.from(storyRef.current.querySelectorAll("img"));
            await Promise.all(images.map(async (img) => {
                if (img.complete && img.naturalWidth > 0) return;
                try {
                    await (img.decode?.() ?? Promise.resolve());
                } catch {
                    // Keep exporting even if an image decode fails.
                }
            }));

            const dataUrl = await htmlToImage.toJpeg(storyRef.current, {
                quality: 1,
                cacheBust: true,
                pixelRatio: targetPixelRatio,
            });
            return dataUrl;
        } catch (err) {
            console.error("Error generating image:", err);
            return null;
        }
    };

    const handleDownload = async () => {
        setIsGenerating(true);
        const dataUrl = await generateImage();
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
        const dataUrl = await generateImage();
        setIsGenerating(false);

        if (dataUrl && navigator.share) {
            try {
                // Convert base64 to blob for sharing
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

    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    const fallbackColor = useMemo(() => {
        if (chartStats.length > 0) {
            return SOURCE_COLORS[chartStats[0].source.toLowerCase()] || "#333333";
        }
        return "#333333";
    }, [chartStats]);

    const autoColor = imageBaseColor || fallbackColor;
    const activeColor = useAutoColor ? autoColor : manualColor;
    const bgGradient = `linear-gradient(160deg, ${shadeColor(activeColor, 0.2)} 0%, ${activeColor} 45%, ${shadeColor(activeColor, -0.55)} 100%)`;

    return (
        <div className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4">
            {/* Container */}
            <div className="relative w-full max-w-[280px] sm:max-w-[400px] flex flex-col gap-3 sm:gap-4 my-4">
                <button
                    onClick={onClose}
                    className="absolute -top-11 right-0 p-2 text-white hover:bg-white/10 rounded-full transition-colors"
                    aria-label="Close"
                >
                    <X size={20} className="sm:h-6 sm:w-6" />
                </button>

                {/* The Story Element that will be captures (aspect ratio 9:16) */}
                <div
                    ref={storyRef}
                    className="relative w-full aspect-[9/16] rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center justify-center p-5 sm:p-8"
                    style={{ background: bgGradient }}
                >
                    {/* Main Card inside Story */}
                    <div className="w-full bg-black/45 sm:bg-black/40 backdrop-blur-0 sm:backdrop-blur-md rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg sm:shadow-xl border border-white/10 flex flex-col items-center gap-4 sm:gap-6">

                        {/* Album Art */}
                        <div className="w-36 h-36 sm:w-48 sm:h-48 rounded-lg overflow-hidden bg-white/5 shadow-lg sm:shadow-2xl relative">
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={songTitle}
                                    className="w-full h-full object-cover"
                                    crossOrigin="anonymous"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-white/40">
                                    {imageError ? "No Image" : "Loading..."}
                                </div>
                            )}
                        </div>

                        {/* Song Info */}
                        <div className="text-center w-full">
                            <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 truncate">{songTitle}</h2>
                            <p className="text-white/70 text-base sm:text-lg truncate">{artist}</p>
                        </div>

                        {/* Chart Stats */}
                        <div className="w-full flex justify-center gap-x-4 sm:gap-x-6 gap-y-3 sm:gap-y-4 flex-wrap mt-1 sm:mt-2">
                            {chartStats.map((stat) => (
                                <div key={stat.source} className="flex flex-col items-center">
                                    <span className="text-white/60 text-xs uppercase tracking-wider mb-1">
                                        {stat.source}
                                    </span>
                                    <div
                                        className="flex items-center justify-center font-bold text-lg sm:text-xl px-3 sm:px-4 py-1 sm:py-1.5 rounded-full"
                                        style={{
                                            backgroundColor: SOURCE_COLORS[stat.source.toLowerCase()] || "#111",
                                            color: "white"
                                        }}
                                    >
                                        #{stat.rank}
                                    </div>
                                </div>
                            ))}
                        </div>

                    </div>

                    <div className="absolute bottom-5 sm:bottom-8 flex items-center gap-2 text-white/50 text-xs sm:text-sm font-medium">
                        KCharts
                    </div>
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
                        disabled={isGenerating}
                        className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl flex items-center gap-2 justify-center transition-colors disabled:opacity-50 text-sm sm:text-base"
                    >
                        <Download size={18} className="sm:h-5 sm:w-5" />
                        Download
                    </button>
                    {canNativeShare && (
                        <button
                            onClick={handleShare}
                            disabled={isGenerating}
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
