import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Loader2, Video, Link2, AlertCircle, Check } from "lucide-react";
import { useUploadVideo } from "@/hooks/use-upload";

/**
 * Format estimated seconds remaining into a human-friendly string shown
 * alongside the upload progress percentage.
 *
 * Returns an empty string when the estimate is not yet available or invalid,
 * so the caller can conditionally append it without extra guard logic.
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 10) return "< 10s";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins >= 10) return `~${mins}min`;
  return secs > 0 ? `~${mins}min ${secs}s` : `~${mins}min`;
}

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".ogg", ".avi", ".mkv"];

function isVideoUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

interface VideoGalleryUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  maxVideos?: number;
}

export function VideoGalleryUpload({
  value,
  onChange,
  onUploadingChange,
  disabled,
  maxVideos = 3,
}: VideoGalleryUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlPreviewError, setUrlPreviewError] = useState(false);

  const canAdd = value.length < maxVideos;

  const { startUpload, isUploading, isRetrying, uploadProgress, uploadEta, cancelUpload, guardDialog } = useUploadVideo(
    {
      onBegin: () => onUploadingChange?.(true),
      onComplete: (result) => {
        onUploadingChange?.(false);
        onChange([...value, result.url].slice(0, maxVideos));
      },
      onError: (err) => {
        onUploadingChange?.(false);
        toast({ title: `Erro no upload: ${err.message}`, variant: "destructive" });
      },
      onCancel: () => {
        onUploadingChange?.(false);
        toast({ title: "Envio cancelado. O arquivo não foi salvo." });
      },
    }
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 128 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast({
        title: "Arquivo muito grande",
        description: `"${file.name}" excede o limite de 128 MB.`,
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    startUpload(file);
    e.target.value = "";
  };

  const handleRemove = (idx: number) =>
    onChange(value.filter((_, i) => i !== idx));

  const confirmUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed || urlPreviewError) return;
    onChange([...value, trimmed].slice(0, maxVideos));
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlInput(false);
  };

  const cancelUrl = () => {
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlInput(false);
  };

  const urlIsLikelyVideo = urlInput.trim() && (
    isVideoUrl(urlInput.trim()) || urlInput.includes("ufs.sh")
  );

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/ogg,video/x-msvideo"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isUploading || !canAdd}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {value.length}/{maxVideos} vídeos
        </span>
        {canAdd && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  {isRetrying
                    ? "Tentando novamente..."
                    : uploadProgress > 0
                    ? [
                        `Enviando ${uploadProgress}%`,
                        formatEta(uploadEta),
                      ].filter(Boolean).join(" · ")
                    : "Enviando..."}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-1" />
                  Enviar arquivo
                </>
              )}
            </Button>
            {!isUploading && !showUrlInput && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowUrlInput(true)}
                disabled={disabled}
              >
                <Link2 className="w-4 h-4 mr-1" />
                Por URL
              </Button>
            )}
            {isUploading && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelUpload}
                className="text-muted-foreground hover:text-destructive px-2"
                title="Cancelar envio"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {showUrlInput && canAdd && (
        <div className="space-y-2 p-3 border-2 border-dashed border-primary/40 rounded-lg bg-primary/5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="w-3.5 h-3.5" />
            Colar link do vídeo
          </div>
          <div className="flex gap-2">
            <Input
              autoFocus
              type="url"
              placeholder="https://exemplo.com/video.mp4"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setUrlPreviewError(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmUrl(); }
                if (e.key === "Escape") cancelUrl();
              }}
              disabled={disabled}
              className="text-sm h-8"
            />
            <Button
              type="button"
              size="sm"
              onClick={confirmUrl}
              disabled={!urlInput.trim() || urlPreviewError || disabled}
              className="shrink-0"
            >
              <Check className="w-4 h-4 mr-1" />
              Adicionar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelUrl}
              disabled={disabled}
              className="shrink-0 px-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          {urlInput.trim() && !urlPreviewError && urlIsLikelyVideo && (
            <div className="rounded overflow-hidden h-20 bg-muted w-48">
              <video
                src={urlInput.trim()}
                muted
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
                onError={() => setUrlPreviewError(true)}
              />
            </div>
          )}
          {urlInput.trim() && !urlPreviewError && !urlIsLikelyVideo && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Certifique-se de que é uma URL direta para um arquivo de vídeo (MP4, WebM, MOV etc.)
            </div>
          )}
          {urlPreviewError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              URL de vídeo inválida ou não pôde ser carregada
            </div>
          )}
        </div>
      )}

      {value.length === 0 && !isUploading && !showUrlInput && (
        <div className="w-full h-28 border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Video className="w-7 h-7" />
          <span className="text-sm">Nenhum vídeo adicionado</span>
          <span className="text-xs">MP4, WebM, MOV · máx. 128 MB · ou use "Por URL" acima</span>
        </div>
      )}

      {(value.length > 0 || isUploading) && (
        <div className="grid grid-cols-2 gap-3">
          {value.map((url, idx) => (
            <div
              key={idx}
              className="relative rounded-lg overflow-hidden aspect-video bg-muted group"
            >
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLVideoElement).style.display = "none";
                }}
              />
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                disabled={disabled || isUploading}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:cursor-not-allowed"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {isUploading && (
            <div className="rounded-lg aspect-video bg-muted flex flex-col items-center justify-center gap-1 border-2 border-dashed border-muted-foreground/30 p-2">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              {isRetrying ? (
                <span className="text-xs text-muted-foreground">Tentando novamente...</span>
              ) : uploadProgress > 0 ? (
                <>
                  <div className="w-16 bg-muted-foreground/20 rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">
                    {uploadProgress}%
                  </span>
                  {formatEta(uploadEta) && (
                    <span className="text-xs text-muted-foreground">
                      {formatEta(uploadEta)} restantes
                    </span>
                  )}
                </>
              ) : null}
              <button
                type="button"
                onClick={cancelUpload}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5"
              >
                <X className="w-3 h-3" />
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
      {guardDialog}
    </div>
  );
}
