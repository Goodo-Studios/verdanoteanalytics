import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Type, Square, Circle, Highlighter, Pencil,
  Undo2, Redo2, Trash2, Save, Download, FileEdit, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Tool = "arrow" | "text" | "rect" | "circle" | "highlight" | "freehand";
type Color = string;

interface DrawAction {
  tool: Tool;
  color: Color;
  points: { x: number; y: number }[];
  text?: string;
  width?: number;
  height?: number;
}

const COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#ffffff", label: "White" },
];

const TOOLS: { tool: Tool; icon: any; label: string }[] = [
  { tool: "arrow", icon: ArrowRight, label: "Arrow" },
  { tool: "text", icon: Type, label: "Text" },
  { tool: "rect", icon: Square, label: "Rectangle" },
  { tool: "circle", icon: Circle, label: "Circle" },
  { tool: "highlight", icon: Highlighter, label: "Highlight" },
  { tool: "freehand", icon: Pencil, label: "Draw" },
];

interface AnnotationCanvasProps {
  imageUrl: string;
  adId: string;
  accountId: string;
  onClose: () => void;
  onSaved?: () => void;
  briefs?: any[];
  onAddToBrief?: (briefId: string, imageUrl: string) => void;
}

export function AnnotationCanvas({
  imageUrl,
  adId,
  accountId,
  onClose,
  onSaved,
  briefs,
  onAddToBrief,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>("arrow");
  const [activeColor, setActiveColor] = useState<Color>("#ef4444");
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [undoneActions, setUndoneActions] = useState<DrawAction[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAction, setCurrentAction] = useState<DrawAction | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });
  const [saving, setSaving] = useState(false);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  // Load background image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      bgImageRef.current = img;
      const container = containerRef.current;
      if (container) {
        const maxW = container.clientWidth;
        const scale = Math.min(maxW / img.width, 500 / img.height, 1);
        setCanvasSize({
          width: Math.round(img.width * scale),
          height: Math.round(img.height * scale),
        });
      }
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw canvas whenever actions change
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height);
    }

    // Draw all committed actions
    for (const action of actions) {
      drawAction(ctx, action);
    }

    // Draw current in-progress action
    if (currentAction) {
      drawAction(ctx, currentAction);
    }
  }, [actions, currentAction]);

  useEffect(() => {
    redraw();
  }, [redraw, canvasSize]);

  function drawAction(ctx: CanvasRenderingContext2D, action: DrawAction) {
    ctx.strokeStyle = action.color;
    ctx.fillStyle = action.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pts = action.points;
    if (pts.length === 0) return;

    switch (action.tool) {
      case "freehand": {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
        break;
      }
      case "arrow": {
        if (pts.length < 2) break;
        const start = pts[0];
        const end = pts[pts.length - 1];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        // Arrowhead
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 15;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLen * Math.cos(angle - Math.PI / 6),
          end.y - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          end.x - headLen * Math.cos(angle + Math.PI / 6),
          end.y - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "rect": {
        if (pts.length < 2) break;
        const x = Math.min(pts[0].x, pts[pts.length - 1].x);
        const y = Math.min(pts[0].y, pts[pts.length - 1].y);
        const w = Math.abs(pts[pts.length - 1].x - pts[0].x);
        const h = Math.abs(pts[pts.length - 1].y - pts[0].y);
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case "circle": {
        if (pts.length < 2) break;
        const cx = (pts[0].x + pts[pts.length - 1].x) / 2;
        const cy = (pts[0].y + pts[pts.length - 1].y) / 2;
        const rx = Math.abs(pts[pts.length - 1].x - pts[0].x) / 2;
        const ry = Math.abs(pts[pts.length - 1].y - pts[0].y) / 2;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "highlight": {
        if (pts.length < 2) break;
        const hx = Math.min(pts[0].x, pts[pts.length - 1].x);
        const hy = Math.min(pts[0].y, pts[pts.length - 1].y);
        const hw = Math.abs(pts[pts.length - 1].x - pts[0].x);
        const hh = Math.abs(pts[pts.length - 1].y - pts[0].y);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#eab308";
        ctx.fillRect(hx, hy, hw, hh);
        ctx.globalAlpha = 1;
        break;
      }
      case "text": {
        if (action.text && pts.length > 0) {
          ctx.font = "bold 16px sans-serif";
          ctx.fillStyle = action.color;
          // Draw text background
          const metrics = ctx.measureText(action.text);
          const padding = 4;
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = "#000000";
          ctx.fillRect(
            pts[0].x - padding,
            pts[0].y - 16 - padding,
            metrics.width + padding * 2,
            20 + padding * 2
          );
          ctx.globalAlpha = 1;
          ctx.fillStyle = action.color;
          ctx.fillText(action.text, pts[0].x, pts[0].y);
        }
        break;
      }
    }
  }

  // Mouse event helpers
  function getPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasSize.width / rect.width),
      y: (e.clientY - rect.top) * (canvasSize.height / rect.height),
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (activeTool === "text") {
      const pos = getPos(e);
      setTextInput(pos);
      setTextValue("");
      return;
    }
    setIsDrawing(true);
    const pos = getPos(e);
    setCurrentAction({
      tool: activeTool,
      color: activeColor,
      points: [pos],
    });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing || !currentAction) return;
    const pos = getPos(e);

    if (activeTool === "freehand") {
      setCurrentAction((prev) => prev ? { ...prev, points: [...prev.points, pos] } : null);
    } else {
      setCurrentAction((prev) => prev ? { ...prev, points: [prev.points[0], pos] } : null);
    }
  }

  function handleMouseUp() {
    if (!isDrawing || !currentAction) return;
    setIsDrawing(false);
    if (currentAction.points.length >= 1) {
      setActions((prev) => [...prev, currentAction]);
      setUndoneActions([]);
    }
    setCurrentAction(null);
  }

  function commitText() {
    if (!textInput || !textValue.trim()) {
      setTextInput(null);
      return;
    }
    const action: DrawAction = {
      tool: "text",
      color: activeColor,
      points: [textInput],
      text: textValue,
    };
    setActions((prev) => [...prev, action]);
    setUndoneActions([]);
    setTextInput(null);
    setTextValue("");
  }

  function undo() {
    if (actions.length === 0) return;
    const last = actions[actions.length - 1];
    setActions((prev) => prev.slice(0, -1));
    setUndoneActions((prev) => [...prev, last]);
  }

  function redo() {
    if (undoneActions.length === 0) return;
    const last = undoneActions[undoneActions.length - 1];
    setUndoneActions((prev) => prev.slice(0, -1));
    setActions((prev) => [...prev, last]);
  }

  function clearAll() {
    setActions([]);
    setUndoneActions([]);
    setCurrentAction(null);
  }

  // Export as PNG blob
  function toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) return reject(new Error("No canvas"));
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export canvas"));
      }, "image/png");
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const blob = await toBlob();
      const timestamp = Date.now();
      const path = `${adId}/annotation_${timestamp}.png`;

      const { error: uploadError } = await supabase.storage
        .from("annotations")
        .upload(path, blob, { contentType: "image/png", upsert: false });

      if (uploadError) throw uploadError;

      const { data: { user } } = await supabase.auth.getUser();

      const { error: dbError } = await supabase.from("annotations").insert({
        ad_id: adId,
        account_id: accountId,
        image_path: path,
        created_by: user!.id,
      });

      if (dbError) throw dbError;

      toast.success("Annotation saved");
      onSaved?.();
    } catch (err: any) {
      toast.error("Failed to save annotation", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    try {
      const blob = await toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `annotation_${adId}_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export annotation");
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap bg-muted/50 rounded-md p-1.5 border border-border/50">
        {TOOLS.map((t) => (
          <Button
            key={t.tool}
            size="sm"
            variant={activeTool === t.tool ? "default" : "ghost"}
            className="h-8 w-8 p-0"
            onClick={() => setActiveTool(t.tool)}
            title={t.label}
          >
            <t.icon className="h-4 w-4" />
          </Button>
        ))}

        <div className="w-px h-6 bg-border mx-1" />

        {COLORS.map((c) => (
          <button
            key={c.value}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform",
              activeColor === c.value ? "border-foreground scale-110" : "border-border hover:scale-105",
            )}
            style={{ backgroundColor: c.value }}
            onClick={() => setActiveColor(c.value)}
            title={c.label}
          />
        ))}

        <div className="w-px h-6 bg-border mx-1" />

        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={undo} disabled={actions.length === 0} title="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={redo} disabled={undoneActions.length === 0} title="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={clearAll} title="Clear all">
          <Trash2 className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <Button size="sm" variant="ghost" className="h-8 gap-1 font-body text-[11px]" onClick={onClose}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative rounded-md overflow-hidden border border-border bg-muted">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="w-full cursor-crosshair"
          style={{ display: "block" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {/* Text input overlay */}
        {textInput && (
          <div
            className="absolute"
            style={{
              left: `${(textInput.x / canvasSize.width) * 100}%`,
              top: `${(textInput.y / canvasSize.height) * 100}%`,
            }}
          >
            <input
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") setTextInput(null);
              }}
              onBlur={commitText}
              className="bg-black/70 text-white border-0 outline-none px-2 py-1 text-sm font-bold rounded min-w-[120px]"
              placeholder="Type text..."
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleSave} disabled={saving || actions.length === 0} className="gap-1.5 font-body text-[12px]">
          {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="h-3.5 w-3.5" />}
          Save Annotation
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload} disabled={actions.length === 0} className="gap-1.5 font-body text-[12px]">
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
        {briefs && briefs.length > 0 && (
          <div className="relative group">
            <Button size="sm" variant="outline" className="gap-1.5 font-body text-[12px]" disabled={actions.length === 0}>
              <FileEdit className="h-3.5 w-3.5" /> Add to Brief
            </Button>
            <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-50 hidden group-hover:block min-w-[180px]">
              {briefs.map((b: any) => (
                <button
                  key={b.id}
                  className="w-full text-left px-3 py-2 font-body text-[12px] text-foreground hover:bg-muted transition-colors"
                  onClick={async () => {
                    try {
                      const blob = await toBlob();
                      const timestamp = Date.now();
                      const path = `${adId}/brief_annotation_${timestamp}.png`;
                      await supabase.storage.from("annotations").upload(path, blob, { contentType: "image/png" });
                      const { data: urlData } = supabase.storage.from("annotations").getPublicUrl(path);
                      onAddToBrief?.(b.id, urlData.publicUrl);
                      toast.success(`Added to brief: ${b.name}`);
                    } catch {
                      toast.error("Failed to add to brief");
                    }
                  }}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
