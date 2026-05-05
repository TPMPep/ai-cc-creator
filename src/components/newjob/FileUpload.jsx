import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED_TYPES = "video/*,audio/*,.mp4,.mov,.mkv,.avi,.wav,.mp3,.m4a,.flac,.ogg,.webm";

export default function FileUpload({ onUploadComplete }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState(null);
  const fileRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setFileName(file.name);
    setProgress(0);

    try {
      // 1. Get presigned URL from backend
      const { data } = await base44.functions.invoke("getS3UploadUrl", {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });

      if (!data.uploadUrl) throw new Error("Failed to get upload URL");

      // 2. Upload directly to S3
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", data.uploadUrl);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          setProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };

      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });

      // 3. Pass the public S3 URL back
      onUploadComplete(data.publicUrl);
      toast.success("File uploaded successfully");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(`Upload failed: ${err.message}`);
      setFileName(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = () => {
    setFileName(null);
    setProgress(0);
    onUploadComplete("");
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileSelect}
        className="hidden"
      />

      {uploading ? (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-300 truncate">{fileName}</p>
            <div className="mt-1.5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-zinc-500 flex-shrink-0">{progress}%</span>
        </div>
      ) : fileName ? (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-xs text-emerald-300 truncate flex-1">{fileName}</p>
          <button onClick={handleClear} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          className="border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800/50 gap-2 w-full"
        >
          <Upload className="w-4 h-4" /> Upload Video / Audio File
        </Button>
      )}
    </div>
  );
}