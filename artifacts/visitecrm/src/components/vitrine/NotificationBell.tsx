import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { clientPortalApi, type ClientNotification } from "@/lib/clientPortalApi";
import { useToast } from "@/hooks/use-toast";

function notificationLabel(type: ClientNotification["type"], payload: ClientNotification["payload"]): string {
  switch (type) {
    case "referral_converted":
      return payload.referredName
        ? `${payload.referredName} usou seu código e reservou!`
        : "Sua indicação foi confirmada!";
    case "referral_bonus_released":
      return payload.bonusAmount
        ? `Bônus de R$ ${Number(payload.bonusAmount).toFixed(2)} liberado para resgate!`
        : "Seu bônus de indicação foi liberado!";
    case "referral_bonus_paid":
      return payload.bonusAmount
        ? `Bônus de R$ ${Number(payload.bonusAmount).toFixed(2)} pago com sucesso!`
        : "Seu bônus de indicação foi pago!";
    case "referral_link_clicked":
      return "Alguém acessou sua página via link de indicação!";
    default:
      return "Nova notificação";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

interface Props {
  primaryColor?: string;
}

export function NotificationBell({ primaryColor = "#2563eb" }: Props) {
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const { toast } = useToast();

  const openStream = useCallback(() => {
    if (unmountedRef.current || esRef.current) return;

    const url = clientPortalApi.getNotificationStreamUrl();
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          type: string;
          data: {
            notifications?: ClientNotification[];
            unreadCount?: number;
            id?: string;
            type?: ClientNotification["type"];
            payload?: ClientNotification["payload"];
            readAt?: string | null;
            createdAt?: string;
          };
        };

        if (msg.type === "init" && msg.data.notifications) {
          setNotifications(msg.data.notifications);
          setUnreadCount(msg.data.unreadCount ?? 0);
        } else if (msg.type === "notification" && msg.data.id) {
          const newNotif: ClientNotification = {
            id: msg.data.id,
            type: msg.data.type!,
            payload: msg.data.payload ?? {},
            readAt: msg.data.readAt ?? null,
            createdAt: msg.data.createdAt ?? new Date().toISOString(),
          };
          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev].slice(0, 20);
          });
          setUnreadCount(msg.data.unreadCount ?? 0);

          toast({
            title: "Nova notificação",
            description: notificationLabel(newNotif.type, newNotif.payload),
          });
        } else if (msg.type === "all_read") {
          setUnreadCount(0);
          setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
        }
      } catch {
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (unmountedRef.current) return;
      reconnectRef.current = setTimeout(openStream, 5_000);
    };
  }, [toast]);

  useEffect(() => {
    unmountedRef.current = false;
    openStream();
    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
    };
  }, [openStream]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && unreadCount > 0) {
      try {
        await clientPortalApi.markAllNotificationsRead();
        setUnreadCount(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      } catch {
      }
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] font-bold leading-none"
            style={{ backgroundColor: "#ef4444" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl bg-white shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-semibold text-gray-800 text-sm">Notificações</span>
            {notifications.length > 0 && (
              <span className="text-xs text-gray-400">{notifications.length} recentes</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhuma notificação</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 text-left transition-colors ${
                    !n.readAt ? "bg-blue-50/60" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: !n.readAt ? "#3b82f6" : "transparent" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-snug">
                        {notificationLabel(n.type, n.payload)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
