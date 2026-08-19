import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Loader2, Images, Link2, AlertCircle, Check } from "lucide-react";
import { useUploadImages } from "@/hooks/use-upload";

interface GalleryUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  maxImages?: number;
  fileSizeMB?: string;
}

export function GalleryUpload({
  value,
  onChange,
  onUploadingChange,
  disabled,
  maxImages = 3,
  fileSizeMB = "8",
}: GalleryUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlPreviewError, setUrlPreviewError] = useState(false);

  const canAdd = value.length < maxImages;
  const maxSizeMB = parseFloat(fileSizeMB) || 8;

  const { startUpload, isUploading, isRetrying, uploadProgress, cancelUpload, guardDialog } = useUploadImages(
    {
      onBegin: () => onUploadingChange?.(true),
      onComplete: (results) => {
        onUploadingChange?.(false);
        const newUrls = results.map((r) => r.url);
        onChange([...value, ...newUrls].slice(0, maxImages));
      },
      onError: (err) => {
        onUploadingChange?.(false);
        toast({ title: `Erro no upload: ${err.message}`, variant: "destructive" });
      },
      onCancel: () => {
        onUploadingChange?.(false);
        toast({ title: "Envio cancelado. O arquivo não foi salvo." });
      },
    },
    { maxSizeMB }
  );

  const upload = (files: File[]) => {
    const toUpload = files.slice(0, maxImages - value.length);
    if (!toUpload.length) return;

    const oversized = toUpload.find((f) => f.size > maxSizeMB * 1024 * 1024);
    if (oversized) {
      toast({
        title: `Arquivo muito grande`,
        description: `"${oversized.name}" excede o limite de ${fileSizeMB} MB.`,
        variant: "destructive",
      });
      return;
    }

    startUpload(toUpload);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    upload(files);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading && canAdd) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled || isUploading || !canAdd) return;
    const files = Array.from(e.dataTransfer.files);
    upload(files);
  };

  const handleRemove = (idx: number) =>
    onChange(value.filter((_, i) => i !== idx));

  const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".ogg", ".avi", ".mkv"];
  const isVideoUrl = (url: string) => {
    try {
      const path = new URL(url).pathname.toLowerCase();
      return VIDEO_EXTS.some((ext) => path.endsWith(ext));
    } catch { return false; }
  };

  const confirmUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed || urlPreviewError) return;
    onChange([...value, trimmed].slice(0, maxImages));
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlInput(false);
  };

  const cancelUrl = () => {
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlInput(false);
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isUploading || !canAdd}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {value.length}/{maxImages} imagens
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
                  {isRetrying ? "Tentando novamente..." : uploadProgress > 0 ? `Enviando ${uploadProgress}%` : "Enviando..."}
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

      {/* URL input row */}
      {showUrlInput && canAdd && (
        <div className="space-y-2 p-3 border-2 border-dashed border-primary/40 rounded-lg bg-primary/5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="w-3.5 h-3.5" />
            Colar link da imagem
          </div>
          <div className="flex gap-2">
            <Input
              autoFocus
              type="url"
              placeholder="https://exemplo.com/imagem.jpg"
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
          {urlInput.trim() && !urlPreviewError && (
            <div className="rounded overflow-hidden h-20 bg-muted w-32">
              <img
                src={urlInput.trim()}
                alt="Preview"
                className="w-full h-full object-cover"
                onError={() => setUrlPreviewError(true)}
              />
            </div>
          )}
          {urlPreviewError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {isVideoUrl(urlInput.trim())
                ? "Esta URL parece ser um vídeo. Use a seção \"Vídeos da Viagem\" abaixo para adicionar vídeos."
                : "URL inválida ou imagem não pôde ser carregada"}
            </div>
          )}
        </div>
      )}

      {value.length === 0 && !isUploading && !showUrlInput && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={disabled || isUploading}
          className={[
            "w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
          ].join(" ")}
        >
          {isDragging ? (
            <>
              <Upload className="w-7 h-7 text-primary" />
              <span className="text-sm font-medium text-primary">
                Solte para enviar
              </span>
            </>
          ) : (
            <>
              <Images className="w-7 h-7 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Clique para enviar ou arraste até {maxImages} imagens aqui
              </span>
              <span className="text-xs text-muted-foreground">
                PNG, JPG, WEBP · máx. {fileSizeMB} MB cada · ou use "Por URL" acima
              </span>
            </>
          )}
        </button>
      )}

      {(value.length > 0 || isUploading) && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url, idx) => (
            <div
              key={idx}
              className="relative rounded-lg overflow-hidden aspect-video bg-muted group"
            >
              <img
                src={url}
                alt={`Galeria ${idx + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
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
                  <div className="w-10 bg-muted-foreground/20 rounded-full h-1">
                    <div
                      className="bg-primary h-1 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{uploadProgress}%</span>
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
