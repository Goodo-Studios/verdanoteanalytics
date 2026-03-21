import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonitorPlay, Circle, Square, RotateCcw, Download, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScreenCaptureResult {
  videoBlob: Blob;
  thumbnailBlob: Blob;
  durationSeconds: number;
}

interface ScreenCaptureTabProps {
  onCapture: (result: ScreenCaptureResult) => void;
  form: {
    source_url: string;
    advertiser_name: string;
    headline: string;
    body_text: string;
    cta_text: string;
    landing_page_url: string;
    platform: string;
    started_running: string;
  };
  onFormChange: (key: string, value: string) => void;
}

type CaptureState = "idle" | "recording" | "preview";

export function ScreenCaptureTab({ onCapture, form, onFormChange }: ScreenCaptureTabProps) {
  const [state, setState] = useState<CaptureState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const supported = typeof navigator?.mediaDevices?.getDisplayMedia === "function";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, []);

  const startCapture = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "never" } as any,
        audio: true,
      });
      streamRef.current = stream;

      // Detect when user stops sharing via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopCapture();
      };

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        setVideoBlob(blob);
        setFileSize(blob.size);

        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setState("preview");

        // Generate thumbnail at 25% mark
        generateThumbnail(blob).then((thumbBlob) => {
          if (thumbBlob) {
            onCapture({
              videoBlob: blob,
              thumbnailBlob: thumbBlob,
              durationSeconds: elapsed,
            });
          }
        });
      };

      recorder.start(1000); // collect data every second
      setState("recording");
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setError("Screen sharing was cancelled. Click Start to try again.");
      } else {
        setError(`Could not start screen capture: ${e.message}`);
      }
    }
  };

  const stopCapture = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setVideoBlob(null);
    setFileSize(0);
    setElapsed(0);
    setState("idle");
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!supported) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center space-y-2">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          Your browser doesn't support screen capture. Please use Chrome, Firefox, or Edge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state === "idle" && (
        <>
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-start gap-3">
              <MonitorPlay className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Record any video ad directly from your screen
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Navigate to the ad on Facebook or any other source in another tab.
                  Then click Start to record the video as it plays.
                </p>
              </div>
            </div>
          </div>

          <Button onClick={startCapture} size="lg" className="w-full gap-2">
            <MonitorPlay className="h-5 w-5" />
            Start Screen Capture
          </Button>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </>
      )}

      {state === "recording" && (
        <div className="space-y-4">
          <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-6 text-center space-y-3">
            <div className="flex items-center justify-center gap-2">
              <Circle className="h-3 w-3 fill-destructive text-destructive animate-pulse" />
              <span className="text-sm font-medium text-destructive">Recording</span>
              <span className="text-lg font-mono font-semibold text-foreground">{formatTime(elapsed)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Play the video ad on the shared screen. Click Stop when done.
            </p>
          </div>

          <Button
            onClick={stopCapture}
            variant="destructive"
            size="lg"
            className="w-full gap-2"
          >
            <Square className="h-4 w-4 fill-current" />
            Stop Recording
          </Button>
        </div>
      )}

      {state === "preview" && previewUrl && (
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-border bg-black">
            <video
              ref={videoPreviewRef}
              src={previewUrl}
              controls
              className="w-full max-h-64"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Duration: {formatTime(elapsed)} • Size: {formatSize(fileSize)}</span>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7" onClick={retake}>
              <RotateCcw className="h-3 w-3" />
              Retake
            </Button>
          </div>

          {/* Metadata fields */}
          <div className="grid gap-3 border-t border-border pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Source URL <span className="text-muted-foreground/50">(optional — for reference)</span>
              </Label>
              <Input
                value={form.source_url}
                onChange={(e) => onFormChange("source_url", e.target.value)}
                placeholder="https://www.facebook.com/ads/library/..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Advertiser Name</Label>
                <Input
                  value={form.advertiser_name}
                  onChange={(e) => onFormChange("advertiser_name", e.target.value)}
                  placeholder="e.g. Nike"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Platform</Label>
                <Select value={form.platform} onValueChange={(v) => onFormChange("platform", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Headline</Label>
              <Input
                value={form.headline}
                onChange={(e) => onFormChange("headline", e.target.value)}
                placeholder="Primary text or headline"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Body Text</Label>
              <Textarea
                value={form.body_text}
                onChange={(e) => onFormChange("body_text", e.target.value)}
                rows={2}
                placeholder="Ad copy"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">CTA Text</Label>
                <Input
                  value={form.cta_text}
                  onChange={(e) => onFormChange("cta_text", e.target.value)}
                  placeholder="Shop Now"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Landing Page URL</Label>
                <Input
                  value={form.landing_page_url}
                  onChange={(e) => onFormChange("landing_page_url", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function generateThumbnail(videoBlob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(videoBlob);

    video.onloadedmetadata = () => {
      // Seek to 25% of duration
      video.currentTime = video.duration * 0.25;
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(video.src);
        resolve(blob);
      }, "image/jpeg", 0.85);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    };
  });
}
