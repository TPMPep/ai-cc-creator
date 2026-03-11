import React from "react";
import { Button } from "@/components/ui/button";
import { Italic, Music } from "lucide-react";

export default function StyleTagButtons({ onWrapSelection }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onWrapSelection("italic")}
        className="h-6 w-6 p-0 text-zinc-400 hover:text-white"
        title="Wrap in italics <i>...</i>"
      >
        <Italic className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onWrapSelection("music")}
        className="h-6 w-6 p-0 text-zinc-400 hover:text-white"
        title="Wrap in music notes ♪...♪"
      >
        <Music className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}