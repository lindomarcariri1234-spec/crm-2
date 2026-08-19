import { useMemo } from "react";

function ConfettiPiece({ delay, left, size, color, shape }: {
  delay: number; left: number; size: number; color: string; shape: "circle" | "square";
}) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${left}%`,
        top: "-12px",
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: shape === "circle" ? "50%" : "2px",
        animation: `confettiFall ${2 + delay}s ease-in ${delay * 0.1}s forwards`,
      }}
    />
  );
}

export function ConfettiAnimation() {
  const pieces = useMemo(() => {
    const colors = ["#f97316", "#3b82f6", "#22c55e", "#ef4444", "#a855f7", "#eab308", "#06b6d4"];
    return Array.from({ length: 80 }, (_, i) => ({
      id: i,
      delay: i * 0.05,
      left: Math.floor(Math.random() * 100),
      size: 6 + Math.floor(Math.random() * 8),
      color: colors[i % colors.length],
      shape: i % 2 === 0 ? ("circle" as const) : ("square" as const),
    }));
  }, []);

  return (
    <>
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {pieces.map((p) => (
          <ConfettiPiece key={p.id} {...p} />
        ))}
      </div>
    </>
  );
}
