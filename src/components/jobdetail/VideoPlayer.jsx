import React, { useRef, useEffect, useState, useCallback } from "react";

const API_BASE = "https://web-production-eba27.up.railway.app";

export default function VideoPlayer({ mediaUrl, cues, videoRef, onTimeUpdate, captionSettings }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [activeCue, setActiveCue] = useState(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const timeMs = videoRef.current.currentTime * 1000;
    setCurrentTime(timeMs);
    onTimeUpdate?.(timeMs);

    if (!cues || cues.length === 0) { setActiveCue(null); return; }
    const active = cues.find((c) => c.start <= timeMs && timeMs < c.end + 100);
    setActiveCue(active || null);
  }, [cues, onTimeUpdate, videoRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!videoRef.current) return;
      const vid = videoRef.current;
      
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      
      switch(e.key) {
        case " ":
          e.preventDefault();
          vid.paused ? vid.play() : vid.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          vid.currentTime = Math.max(0, vid.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5);
          break;
        case "j":
        case "J":
          vid.currentTime = Math.max(0, vid.currentTime - 10);
          break;
        case "k":
        case "K":
          vid.paused ? vid.play() : vid.pause();
          break;
        case "l":
        case "L":
          vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
          break;
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoRef]);

  const baseFontSize = captionSettings?.fontSize || 16;
  const opacity = captionSettings?.opacity ?? 0.8;
  const position = captionSettings?.position || "bottom";

  // Scale caption font size proportionally to container width
  // Base reference: 800px wide = full font size
  const scale = Math.min(1, containerWidth / 800);
  const fontSize = Math.max(9, Math.round(baseFontSize * scale));
  const padX = Math.max(2, Math.round(16 * scale));
  const padY = Math.max(1, Math.round(8 * scale));
  const bottomOffset = Math.max(6, Math.round(48 * scale));

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative rounded-lg overflow-hidden bg-black group">
      <video
        ref={videoRef}
        src={`${API_BASE}/v1/proxy?url=${encodeURIComponent(mediaUrl)}`}
        controls
        className="w-full aspect-video bg-black"
        onTimeUpdate={handleTimeUpdate}
        crossOrigin="anonymous"
      />
      {/* Caption overlay */}
      {activeCue && (
        <div
          className="absolute left-0 right-0 flex justify-center pointer-events-none"
          style={{ [position === "top" ? "top" : "bottom"]: `${bottomOffset}px`, padding: `0 ${padX}px` }}
        >
          <div className="rounded max-w-[80%] border border-zinc-700/30" style={{ backgroundColor: `rgba(0, 0, 0, ${opacity})`, backdropFilter: "blur(4px)", padding: `${padY}px ${padX}px` }}>
            <p className="text-white font-medium text-center leading-snug whitespace-pre-line" style={{ fontSize: `${fontSize}px` }}>
              {activeCue.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}