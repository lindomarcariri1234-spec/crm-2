import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Loader2, Image as ImageIcon, Link2, AlertCircle } from "lucide-react";
import { useUploadImage, isTripMediaResult } from "@/hooks/use-upload";

/** Shape returned when a `tripId` is provided and the record is auto-saved. */
export interface TripMediaRecord {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  createdAt: string;
}

interface CoverImageUploadProps {
  fileSizeMB?: string;
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  onMediaCreated?: (media: TripMediaRecord) => void;
  disabled?: boolean;
  previewClassName?: string;
  emptyLabel?: string;
  placeholder?: string;
  objectFit?: "contain" | "cover";
  /**
   * When provided, the upload endpoint will atomically insert a `trip_media`
   * record after upload. `onMediaCreated` will be called with the full record.
   */
  tripId?: string;
  /**
   * Caption to store with the `trip_media` record when `tripId` is set.
   * Ignored when `tripId` is not provided.
   */
  caption?: string;
}

type Mode = "upload" | "url";

export function CoverImageUpload({
  fileSizeMB = "8",
  value,
  onChange,
  onUploadingChange,
  onMediaCreated,
  disabled,
  previewClassName = "h-48",
  emptyLabel,
  placeholder,
  objectFit = "contain",
  tripId,
  caption,
}: CoverImageUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [urlInput, setUrlInput] = useState("");
  const [urlPreviewError, setUrlPreviewError] = useState(false);
  const [showUrlOverlay, setShowUrlOverlay] = useState(false);

  const maxSizeMB = parseFloat(fileSizeMB) || 8;

  const { startUpload, isUploading, isRetrying, uploadProgress, cancelUpload, guardDialog } = useUploadImage(
    {
      onBegin: () => onUploadingChange?.(true),
      onComplete: (result) => {
        onUploadingChange?.(false);
        onChange(result.url);
        // When tripId was provided the backend atomically created the trip_media
        // record and returned the full object — notify the parent directly.
        if (isTripMediaResult(result)) {
          onMediaCreated?.(result);
        }
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
    { maxSizeMB, tripId, caption }
  );

  const upload = (file: File) => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast({
        title: `Arquivo muito grande`,
        description: `Máximo permitido: ${fileSizeMB} MB. Arquivo enviado: ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        variant: "destructive",
      });
      return;
    }
    startUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upload(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading) setIsDragging(true);
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
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const handleRemove = () => onChange("");

  const confirmUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlOverlay(false);
  };

  const cancelUrl = () => {
    setUrlInput("");
    setUrlPreviewError(false);
    setShowUrlOverlay(false);
  };

  const labelText = emptyLabel ?? placeholder ?? "Clique ou arraste a imagem aqui";

  const urlForm = (
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
          onChange={(e) => {
            setUrlInput(e.target.value);
            setUrlPreviewError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); confirmUrl(); }
            if (e.key === "Escape") cancelUrl();
          }}
          disabled={disabled}
          className="text-sm h-8"
        />
        <Button type="button" size="sm" onClick={confirmUrl} disabled={!urlInput.trim() || urlPreviewError || disabled} className="shrink-0">
          Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancelUrl} disabled={disabled} className="shrink-0 px-2">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {urlInput.trim() && !urlPreviewError && (
        <div className="rounded overflow-hidden h-24 bg-muted">
          <img
            src={urlInput.trim()}
            alt="Preview"
            className="w-full h-full object-contain"
            onError={() => setUrlPreviewError(true)}
          />
        </div>
      )}
      {urlPreviewError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          URL inválida ou imagem não pôde ser carregada
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isUploading}
      />

      {value ? (
        <div className={`relative rounded-lg overflow-hidden bg-muted group ${previewClassName}`}>
          <img
            src={value}
            alt="Preview"
            className={`w-full h-full ${objectFit === "cover" ? "object-cover" : "object-contain"}`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div
            className={[
              "absolute inset-0 bg-black/50 transition-opacity flex flex-col items-center justify-center gap-2",
              isUploading || showUrlOverlay ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            ].join(" ")}
          >
            {isUploading ? (
              <>
                <span className="text-white text-sm font-medium">
                  {isRetrying ? "Tentando novamente..." : uploadProgress > 0 ? `${uploadProgress}%` : "Enviando..."}
                </span>
                {!isRetrying && uploadProgress > 0 && (
                  <div className="w-20 bg-white/30 rounded-full h-1">
                    <div
                      className="bg-white h-1 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
                <Button type="button" size="sm" variant="secondary" onClick={cancelUpload}>
                  <X className="w-4 h-4 mr-1" />
                  Cancelar
                </Button>
              </>
            ) : showUrlOverlay ? (
              <div className="w-full px-4" onClick={(e) => e.stopPropagation()}>
                <div className="space-y-2 bg-white/95 rounded-lg p-3">
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
                      className="text-sm h-8"
                    />
                    <Button type="button" size="sm" onClick={confirmUrl} disabled={!urlInput.trim() || urlPreviewError} className="shrink-0">Confirmar</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={cancelUrl} className="shrink-0 px-2"><X className="w-4 h-4" /></Button>
                  </div>
                  {urlInput.trim() && !urlPreviewError && (
                    <div className="rounded overflow-hidden h-16 bg-muted">
                      <img
                        src={urlInput.trim()}
                        alt="Preview"
                        className="w-full h-full object-contain"
                        onError={() => setUrlPreviewError(true)}
                      />
                    </div>
                  )}
                  {urlPreviewError && (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      URL inválida ou imagem não pôde ser carregada
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                  >
                    <Upload className="w-4 h-4 mr-1" />
                    Trocar arquivo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowUrlOverlay(true)}
                    disabled={disabled}
                  >
                    <Link2 className="w-4 h-4 mr-1" />
                    Trocar por URL
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={disabled}
                >
                  <X className="w-4 h-4 mr-1" />
                  Remover
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Mode toggle */}
          <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === "upload"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              disabled={disabled || isUploading}
            >
              <Upload className="w-3.5 h-3.5" />
              Enviar arquivo
            </button>
            <button
              type="button"
              onClick={() => setMode("url")}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === "url"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              disabled={disabled || isUploading}
            >
              <Link2 className="w-3.5 h-3.5" />
              Colar URL
            </button>
          </div>

          {mode === "url" ? (
            urlForm
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                disabled={disabled || isUploading}
                className={[
                  "w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  previewClassName,
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
                ].join(" ")}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      {isRetrying ? "Tentando novamente..." : uploadProgress > 0 ? `Enviando ${uploadProgress}%` : "Enviando..."}
                    </span>
                    {!isRetrying && uploadProgress > 0 && (
                      <div className="w-24 bg-muted-foreground/20 rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full transition-all duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    )}
                  </>
                ) : isDragging ? (
                  <>
                    <Upload className="w-8 h-8 text-primary" />
                    <span className="text-sm font-medium text-primary">
                      Solte para enviar
                    </span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      {labelText}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PNG, JPG, WEBP · máx. {fileSizeMB} MB
                    </span>
                  </>
                )}
              </button>
              {isUploading && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelUpload}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Cancelar envio
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {guardDialog}
    </div>
  );
}
