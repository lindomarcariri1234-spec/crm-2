import { Bus, MapPin, Calendar, Clock } from "lucide-react";
import { PublicStore, StoreProduct } from "@/lib/storeApi";
import { calculateTripDuration } from "@/lib/tripDuration";
import { TRIP_TYPE_LABELS } from "@/lib/labels";
import { fmtDate } from "./constants";

export function ProductCard({ product, store }: { product: StoreProduct; store: PublicStore }) {
  const images = product.images ?? [];
  const startDate = product.departureDate ?? product.startDate;
  return (
    <div className="flex gap-4 p-4 border rounded-xl bg-muted/30">
      <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-muted flex items-center justify-center">
        {images[0] ? (
          <img src={images[0]} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Bus className="w-8 h-8 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm leading-tight mb-1 line-clamp-2">{product.name}</p>
        {product.tripType && (
          <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {TRIP_TYPE_LABELS[product.tripType] ?? product.tripType}
          </span>
        )}
        {product.destination && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {product.destination}
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {startDate && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {fmtDate(startDate)}
            </p>
          )}
          {(() => {
            const dur =
              calculateTripDuration(
                product.departureDate ?? product.startDate,
                product.endDate,
                product.departureTime,
                product.returnTime,
              ) ?? (product.durationDays ? { formattedShort: `${product.durationDays}d` } : null);
            return dur ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {dur.formattedShort}
              </p>
            ) : null;
          })()}
        </div>
        <p className="text-base font-bold mt-1" style={{ color: store.primaryColor }}>
          R$ {parseFloat(product.salePrice ?? product.price).toFixed(2)}
          <span className="text-xs font-normal text-muted-foreground ml-1">/ pessoa</span>
        </p>
      </div>
    </div>
  );
}
