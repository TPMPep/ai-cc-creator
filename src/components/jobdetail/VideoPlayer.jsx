import React, { useRef, useEffect, useState, useCallback } from "react";

export default function VideoPlayer({ mediaUrl, cues, videoRef, onTimeUpdate }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [activeCue, setActiveCue] = useState(null);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const timeMs = videoRef.current.currentTime * 1000;
    setCurrentTime(timeMs);
    onTimeUpdate?.(timeMs);

    if (!cues || cues.length === 0) { setActiveCue(null); return; }
    const active = cues.find((c) => c.start <= timeMs && timeMs <= c.end);
    setActiveCue(active || null);
  }, [cues, onTimeUpdate, videoRef]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-black group">
      <video
        ref={videoRef}
        src={mediaUrl}
        controls
        className="w-full aspect-video bg-black"
        onTimeUpdate={handleTimeUpdate}
        crossOrigin="anonymous"
      />
      {/* Caption overlay */}
      {activeCue && (
        <div className="absolute bottom-12 left-0 right-0 flex justify-center pointer-events-none px-4">
          <div className="bg-black/80 backdrop-blur-sm rounded-md px-4 py-2 max-w-[80%] border border-zinc-700/30">
            <p className="text-white text-sm sm:text-base font-medium text-center leading-relaxed whitespace-pre-line">
              {activeCue.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}