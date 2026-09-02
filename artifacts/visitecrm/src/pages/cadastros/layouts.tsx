import { useState, useCallback, useMemo, useEffect } from "react";
import {
  useListLayouts,
  useCreateLayout,
  useUpdateLayout,
  useDeleteLayout,
} from "@workspace/api-client-react";
import type { VehicleLayout, LayoutCell } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ListLoadError } from "@/components/list-load-error";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  LayoutGrid,
  Armchair,
  Bus,
  MinusCircle,
  PlusCircle,
  Eye,
  Filter,
  ArrowUp,
  ArrowDown,
  Check,
  Layers,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentSubscription } from "@workspace/api-client-react";
import { PlanFeatureWall, canUpgradeForFeature, getRequiredPlanLabel } from "@/components/plan-limit-wall";

type CellType = LayoutCell["type"];

interface CellTypeInfo {
  type: CellType;
  label: string;
  emoji: string;
  bg: string;
  border: string;
  text: string;
}

const CELL_TYPES: CellTypeInfo[] = [
  { type: "seat", label: "Assento", emoji: "💺", bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-800" },
  { type: "vip", label: "VIP", emoji: "⭐", bg: "bg-amber-100", border: "border-amber-400", text: "text-amber-800" },
  { type: "accessible", label: "Acessível", emoji: "♿", bg: "bg-green-100", border: "border-green-400", text: "text-green-800" },
  { type: "wc", label: "Banheiro", emoji: "🚽", bg: "bg-cyan-100", border: "border-cyan-400", text: "text-cyan-800" },
  { type: "stairs", label: "Escada", emoji: "🪜", bg: "bg-purple-100", border: "border-purple-400", text: "text-purple-800" },
  { type: "fridge", label: "Frigobar", emoji: "🧊", bg: "bg-sky-100", border: "border-sky-400", text: "text-sky-800" },
  { type: "blocked", label: "Bloqueado", emoji: "🚫", bg: "bg-red-100", border: "border-red-400", text: "text-red-800" },
  { type: "empty", label: "Vazio", emoji: "·", bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-400" },
];

const cellTypeMap = Object.fromEntries(CELL_TYPES.map(c => [c.type, c])) as Record<CellType, CellTypeInfo>;

interface LayoutTemplate {
  name: string;
  rows: number;
  cols: number;
  floors: number;
  numberingType: string;
  vehicleType: string;
  busType: "DOUBLE_DECKER" | "CONVENTIONAL" | "EXECUTIVE" | "SEMI_LEITO" | "LEITO";
  generate: (rows: number, cols: number) => LayoutCell[];
}

function makeGridCells(rows: number, cols: number, wcCols: number[] = []): LayoutCell[] {
  const cells: LayoutCell[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const isLastCol = c === cols;
      const isWcRow = r > rows - 1 && wcCols.includes(c);
      cells.push({
        row: r,
        col: c,
        floor: 1,
        type: isWcRow ? "wc" : isLastCol && r === 1 ? "stairs" : "seat",
      });
    }
  }
  return cells;
}

const TEMPLATES: LayoutTemplate[] = [
  {
    name: "Ônibus 46 (2x2)",
    rows: 12,
    cols: 4,
    floors: 1,
    numberingType: "brazilian_standard",
    vehicleType: "Ônibus",
    busType: "CONVENTIONAL",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const isLastRow = r === rows;
          const type: CellType = isLastRow && (c === 3 || c === 4) ? "wc" : "seat";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
  {
    name: "Micro-ônibus (2x1)",
    rows: 8,
    cols: 3,
    floors: 1,
    numberingType: "sequential",
    vehicleType: "Micro-ônibus",
    busType: "CONVENTIONAL",
    generate: (rows, cols) => makeGridCells(rows, cols, [3]),
  },
  {
    name: "Van 15 (1+2)",
    rows: 5,
    cols: 3,
    floors: 1,
    numberingType: "sequential",
    vehicleType: "Van",
    busType: "CONVENTIONAL",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          cells.push({ row: r, col: c, floor: 1, type: "seat" });
        }
      }
      return cells;
    },
  },
  {
    name: "Ônibus Leito (1x1)",
    rows: 10,
    cols: 4,
    floors: 1,
    numberingType: "brazilian_standard",
    vehicleType: "Ônibus",
    busType: "LEITO",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const isLastRow = r === rows;
          const type: CellType = isLastRow && (c === 3 || c === 4) ? "wc" : "vip";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
  {
    name: "Double Decker (2 andares)",
    rows: 12,
    cols: 4,
    floors: 2,
    numberingType: "brazilian_standard_upper_first",
    vehicleType: "Ônibus",
    busType: "DOUBLE_DECKER",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let floor = 1; floor <= 2; floor++) {
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            const isLastRow = r === rows;
            const isFirstRow = r === 1;
            let type: CellType = "seat";
            if (floor === 1 && isLastRow && (c === 3 || c === 4)) type = "wc";
            if (floor === 2 && isFirstRow && c === cols) type = "stairs";
            cells.push({ row: r, col: c, floor, type });
          }
        }
      }
      return cells;
    },
  },
  // ─── Novos templates ──────────────────────────────────────────────────────
  {
    name: "Convencional 50 (2x2)",
    rows: 13,
    cols: 4,
    floors: 1,
    numberingType: "brazilian_standard",
    vehicleType: "Ônibus",
    busType: "CONVENTIONAL",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const isLastRow = r === rows;
          const type: CellType = (isLastRow && (c === 1 || c === 2)) ? "wc" : "seat";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
  {
    name: "Executivo 46 (2x2 VIP)",
    rows: 12,
    cols: 4,
    floors: 1,
    numberingType: "brazilian_standard",
    vehicleType: "Ônibus",
    busType: "EXECUTIVE",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const isLastRow = r === rows;
          const isFirstRow = r === 1;
          const type: CellType = (isLastRow && (c === 1 || c === 2)) ? "wc"
            : isFirstRow ? "vip"
            : "seat";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
  {
    name: "Semi-Leito 44 (2x2)",
    rows: 11,
    cols: 4,
    floors: 1,
    numberingType: "brazilian_standard",
    vehicleType: "Ônibus",
    busType: "SEMI_LEITO",
    generate: (rows, cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          cells.push({ row: r, col: c, floor: 1, type: "seat" });
        }
      }
      return cells;
    },
  },
  {
    name: "DD Semi-Leito 56 (Sup 46 + Inf 10)",
    rows: 12,
    cols: 4,
    floors: 2,
    numberingType: "brazilian_standard_upper_first",
    vehicleType: "Ônibus",
    busType: "DOUBLE_DECKER",
    generate: (_rows, _cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= 12; r++) {
        for (let c = 1; c <= 4; c++) {
          const isStairs = r === 4 && (c === 3 || c === 4);
          const type: CellType = isStairs ? "stairs" : "seat";
          cells.push({ row: r, col: c, floor: 2, type });
        }
      }
      for (let r = 1; r <= 4; r++) {
        for (let c = 1; c <= 4; c++) {
          const isWc = r === 4 && (c === 1 || c === 2);
          const type: CellType = isWc ? "wc" : "seat";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
  {
    name: "DD Executivo 51 (Sup 46 + Inf 5)",
    rows: 12,
    cols: 4,
    floors: 2,
    numberingType: "brazilian_standard_upper_first",
    vehicleType: "Ônibus",
    busType: "DOUBLE_DECKER",
    generate: (_rows, _cols) => {
      const cells: LayoutCell[] = [];
      for (let r = 1; r <= 12; r++) {
        for (let c = 1; c <= 4; c++) {
          const isStairs = r === 4 && (c === 3 || c === 4);
          const isVip = r === 1;
          const type: CellType = isStairs ? "stairs" : isVip ? "vip" : "seat";
          cells.push({ row: r, col: c, floor: 2, type });
        }
      }
      for (let r = 1; r <= 3; r++) {
        for (let c = 1; c <= 3; c++) {
          const isWc = r === 3 && c === 3;
          const type: CellType = isWc ? "wc" : "seat";
          cells.push({ row: r, col: c, floor: 1, type });
        }
      }
      return cells;
    },
  },
];

const SEAT_TYPES_RENUMBER = ["seat", "vip", "accessible"] as const;

function applyBrazilianNumbering(cells: LayoutCell[], floors: number): LayoutCell[] {
  const upperFirst = floors > 1;
  const seatCells = cells.filter(c => (SEAT_TYPES_RENUMBER as readonly string[]).includes(c.type));
  const maxCol = seatCells.length > 0 ? Math.max(...seatCells.map(c => c.col)) : 4;
  const aisleCol = Math.ceil(maxCol / 2);

  const rowGroups = new Map<string, LayoutCell[]>();
  for (const cell of seatCells) {
    const key = `${cell.floor ?? 1}-${cell.row}`;
    if (!rowGroups.has(key)) rowGroups.set(key, []);
    rowGroups.get(key)!.push(cell);
  }

  const sortedGroups = [...rowGroups.entries()].sort(([a], [b]) => {
    const [fa, ra] = a.split("-").map(Number);
    const [fb, rb] = b.split("-").map(Number);
    if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
    return ra - rb;
  });

  const labels = new Map<string, string>();
  let counter = 1;
  for (const [, groupCells] of sortedGroups) {
    const leftCells = groupCells.filter(c => c.col <= aisleCol).sort((a, b) => a.col - b.col);
    const rightCells = groupCells.filter(c => c.col > aisleCol).sort((a, b) => a.col - b.col);
    for (const lCell of leftCells) {
      labels.set(`${lCell.floor ?? 1}-${lCell.row}-${lCell.col}`, String(counter++));
    }
    const rightBase = counter;
    for (let i = 0; i < rightCells.length; i++) {
      const rCell = rightCells[i];
      labels.set(`${rCell.floor ?? 1}-${rCell.row}-${rCell.col}`, String(rightBase + (rightCells.length - 1 - i)));
    }
    counter += rightCells.length;
  }

  return cells.map(cell => {
    const key = `${cell.floor ?? 1}-${cell.row}-${cell.col}`;
    const label = labels.get(key);
    if (label !== undefined) return { ...cell, label };
    const { label: _removed, ...rest } = cell as LayoutCell & { label?: string };
    return rest as LayoutCell;
  });
}

function generateDefaultCells(rows: number, cols: number, existing: LayoutCell[] = [], floors = 1): LayoutCell[] {
  const existingMap = new Map(existing.map(c => [`${c.floor ?? 1}-${c.row}-${c.col}`, c]));
  const cells: LayoutCell[] = [];
  for (let f = 1; f <= floors; f++) {
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const key = `${f}-${r}-${c}`;
        cells.push(existingMap.get(key) ?? { row: r, col: c, floor: f, type: "seat" });
      }
    }
  }
  return cells;
}

function deriveFloorDimensions(
  cells: LayoutCell[],
  floors: number,
  fallback: { rows: number; cols: number } = { rows: 12, cols: 4 },
): Record<number, { rows: number; cols: number }> {
  const dims: Record<number, { rows: number; cols: number }> = {};
  for (let f = 1; f <= floors; f++) {
    const floorCells = cells.filter(c => (c.floor ?? 1) === f);
    if (floorCells.length > 0) {
      dims[f] = {
        rows: Math.max(...floorCells.map(c => c.row)),
        cols: Math.max(...floorCells.map(c => c.col)),
      };
    } else {
      dims[f] = { rows: fallback.rows, cols: fallback.cols };
    }
  }
  return dims;
}

function generateFloorCells(
  floorDimensions: Record<number, { rows: number; cols: number }>,
  existing: LayoutCell[] = [],
): LayoutCell[] {
  const existingMap = new Map(existing.map(c => [`${c.floor ?? 1}-${c.row}-${c.col}`, c]));
  const cells: LayoutCell[] = [];
  const floors = Object.keys(floorDimensions).map(Number).sort();
  for (const f of floors) {
    const { rows, cols } = floorDimensions[f];
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const key = `${f}-${r}-${c}`;
        cells.push(existingMap.get(key) ?? { row: r, col: c, floor: f, type: "seat" });
      }
    }
  }
  return cells;
}

function computePreviewLabels(cells: LayoutCell[], numberingType: string): Map<string, string> {
  const result = new Map<string, string>();
  const seatTypes = SEAT_TYPES_RENUMBER as readonly string[];
  const upperFirst = numberingType.endsWith("_upper_first");
  const baseType = upperFirst ? numberingType.replace("_upper_first", "") : numberingType;
  const keyOf = (c: LayoutCell) => `${c.floor ?? 1}-${c.row}-${c.col}`;

  const seatCells = cells
    .filter(c => seatTypes.includes(c.type))
    .sort((a, b) => {
      const fa = a.floor ?? 1, fb = b.floor ?? 1;
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

  if (seatCells.length === 0) return result;

  const maxFloor = Math.max(...cells.map(c => c.floor ?? 1), 1);
  const isMultiFloor = maxFloor > 1;

  if (baseType === "by_row") {
    const floorRowGroups = new Map<string, LayoutCell[]>();
    for (const cell of seatCells) {
      const floor = cell.floor ?? 1;
      const groupKey = `${floor}-${cell.row}`;
      if (!floorRowGroups.has(groupKey)) floorRowGroups.set(groupKey, []);
      floorRowGroups.get(groupKey)!.push(cell);
    }
    for (const [groupKey, groupCells] of [...floorRowGroups.entries()].sort(([a], [b]) => {
      const [fa, ra] = a.split("-").map(Number);
      const [fb, rb] = b.split("-").map(Number);
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      return ra - rb;
    })) {
      const [floor, row] = groupKey.split("-").map(Number);
      groupCells.sort((a, b) => a.col - b.col);
      groupCells.forEach((cell, i) => {
        const floorPrefix = isMultiFloor ? `A${floor}-` : "";
        result.set(keyOf(cell), `${floorPrefix}${row}${String.fromCharCode(65 + i)}`);
      });
    }
  } else if (baseType === "brazilian_standard") {
    const maxCol = Math.max(...seatCells.map(c => c.col), 4);
    const aisleCol = Math.ceil(maxCol / 2);

    const rowGroups = new Map<string, LayoutCell[]>();
    for (const cell of seatCells) {
      const key = `${cell.floor ?? 1}-${cell.row}`;
      if (!rowGroups.has(key)) rowGroups.set(key, []);
      rowGroups.get(key)!.push(cell);
    }

    const sortedGroups = [...rowGroups.entries()].sort(([a], [b]) => {
      const [fa, ra] = a.split("-").map(Number);
      const [fb, rb] = b.split("-").map(Number);
      if (fa !== fb) return upperFirst ? fb - fa : fa - fb;
      return ra - rb;
    });

    let counter = 1;
    for (const [, groupCells] of sortedGroups) {
      const leftCells = groupCells.filter(c => c.col <= aisleCol).sort((a, b) => a.col - b.col);
      const rightCells = groupCells.filter(c => c.col > aisleCol).sort((a, b) => a.col - b.col);
      for (const lCell of leftCells) {
        result.set(keyOf(lCell), String(counter++));
      }
      const rightBase = counter;
      for (let i = 0; i < rightCells.length; i++) {
        result.set(keyOf(rightCells[i]), String(rightBase + (rightCells.length - 1 - i)));
      }
      counter += rightCells.length;
    }
  } else {
    seatCells.forEach((cell, i) => {
      result.set(keyOf(cell), String(i + 1));
    });
  }

  return result;
}

function GridCell({
  cell,
  selected,
  onClick,
  cellSize,
  previewLabel,
}: {
  cell: LayoutCell;
  selected: boolean;
  onClick: () => void;
  cellSize: number;
  previewLabel?: string;
}) {
  const info = cellTypeMap[cell.type] ?? cellTypeMap["seat"];
  const displayLabel = previewLabel ?? ((SEAT_TYPES_RENUMBER as readonly string[]).includes(cell.type) ? (cell.label ?? undefined) : undefined);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: cellSize, height: cellSize }}
      className={`
        rounded border-2 flex flex-col items-center justify-center text-center transition-all
        hover:scale-105 hover:shadow-sm
        ${selected ? "ring-2 ring-offset-1 ring-primary scale-105" : ""}
        ${info.bg} ${info.border} ${info.text}
      `}
      title={displayLabel ? `${info.label} ${displayLabel}` : info.label}
    >
      {displayLabel ? (
        <>
          <span style={{ fontSize: Math.max(6, cellSize * 0.2), lineHeight: 1 }}>{info.emoji}</span>
          <span style={{ fontSize: Math.max(8, cellSize * 0.32), lineHeight: 1, fontWeight: 700 }}>{displayLabel}</span>
        </>
      ) : (
        <span style={{ fontSize: Math.max(10, cellSize * 0.4) }}>
          {info.emoji}
        </span>
      )}
    </button>
  );
}

function LayoutStats({ cells }: { cells: LayoutCell[] }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cell of cells) c[cell.type] = (c[cell.type] ?? 0) + 1;
    return c;
  }, [cells]);

  const seatTotal = (counts["seat"] ?? 0) + (counts["vip"] ?? 0) + (counts["accessible"] ?? 0);

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
        💺 {seatTotal} assento{seatTotal !== 1 ? "s" : ""}
      </Badge>
      {counts["vip"] ? <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">⭐ {counts["vip"]} VIP</Badge> : null}
      {counts["accessible"] ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">♿ {counts["accessible"]} acessível</Badge> : null}
      {counts["wc"] ? <Badge variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-300">🚽 {counts["wc"]} banheiro</Badge> : null}
      {counts["stairs"] ? <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">🪜 {counts["stairs"]} escada</Badge> : null}
      {counts["blocked"] ? <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">🚫 {counts["blocked"]} bloqueado</Badge> : null}
    </div>
  );
}

const BUS_TYPE_META: Record<string, { label: string; badgeCls: string }> = {
  DOUBLE_DECKER: { label: "Double Decker", badgeCls: "bg-purple-100 text-purple-700 border-purple-300" },
  CONVENTIONAL:  { label: "Convencional",  badgeCls: "bg-blue-100 text-blue-700 border-blue-300" },
  EXECUTIVE:     { label: "Executivo",     badgeCls: "bg-rose-100 text-rose-700 border-rose-300" },
  SEMI_LEITO:    { label: "Semi-Leito",    badgeCls: "bg-green-100 text-green-700 border-green-300" },
  LEITO:         { label: "Leito",         badgeCls: "bg-orange-100 text-orange-700 border-orange-300" },
};

function TabbedTemplatePreview({
  cells,
  rows,
  cols,
  floors,
  compact = true,
}: {
  cells: LayoutCell[];
  rows: number;
  cols: number;
  floors: number;
  compact?: boolean;
}) {
  const [activeFloor, setActiveFloor] = useState(floors > 1 ? 2 : 1);

  const renderGrid = (floorNum: number) => {
    const floorCells = cells.filter(c => (c.floor ?? 1) === floorNum);
    const floorMaxCol = floorCells.length > 0 ? Math.max(...floorCells.map(c => c.col)) : cols;
    const floorMaxRow = floorCells.length > 0 ? Math.max(...floorCells.map(c => c.row)) : rows;
    const floorAisle = Math.ceil(floorMaxCol / 2);
    const floorCellSize = compact ? Math.min(14, Math.floor(100 / floorMaxCol)) : Math.min(22, Math.floor(160 / floorMaxCol));
    const displayRows = compact ? Math.min(floorMaxRow, 10) : floorMaxRow;
    return (
      <div className="space-y-0.5 inline-block w-full">
        {Array.from({ length: displayRows }).map((_, rIdx) => {
          const row = rIdx + 1;
          const rowCells = floorCells.filter(c => c.row === row).sort((a, b) => a.col - b.col);
          const leftCells = rowCells.filter(c => c.col <= floorAisle);
          const rightCells = rowCells.filter(c => c.col > floorAisle);
          return (
            <div key={row} className="flex items-center gap-1 justify-center">
              <div className="flex gap-0.5">
                {leftCells.map(cell => {
                  const info = cellTypeMap[cell.type] ?? cellTypeMap["seat"];
                  return (
                    <div
                      key={`${cell.row}-${cell.col}`}
                      style={{ width: floorCellSize, height: floorCellSize }}
                      className={`rounded-sm border ${info.bg} ${info.border}`}
                      title={info.label}
                    />
                  );
                })}
              </div>
              <div className="w-1 border-l border-dashed border-slate-300 self-stretch" />
              <div className="flex gap-0.5">
                {rightCells.map(cell => {
                  const info = cellTypeMap[cell.type] ?? cellTypeMap["seat"];
                  return (
                    <div
                      key={`${cell.row}-${cell.col}`}
                      style={{ width: floorCellSize, height: floorCellSize }}
                      className={`rounded-sm border ${info.bg} ${info.border}`}
                      title={info.label}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {floorMaxRow > displayRows && (
          <p className="text-center text-[9px] text-muted-foreground mt-1">
            +{floorMaxRow - displayRows} fileiras...
          </p>
        )}
      </div>
    );
  };

  if (floors === 1) {
    return (
      <div className="bg-slate-50 rounded-md p-2 overflow-hidden">
        <div className="bg-slate-600 text-white text-center py-0.5 rounded text-[9px] font-semibold mb-1.5">FRENTE</div>
        {renderGrid(1)}
      </div>
    );
  }

  return (
    <Tabs value={String(activeFloor)} onValueChange={v => setActiveFloor(Number(v))}>
      <TabsList className="w-full h-8 mb-2">
        <TabsTrigger value="2" className="flex-1 text-[10px] gap-1">
          <ArrowUp className="h-3 w-3" /> Piso Superior
        </TabsTrigger>
        <TabsTrigger value="1" className="flex-1 text-[10px] gap-1">
          <ArrowDown className="h-3 w-3" /> Piso Inferior
        </TabsTrigger>
      </TabsList>
      <TabsContent value="2" className="mt-0">
        <div className="bg-slate-50 rounded-md p-2 overflow-hidden">
          <div className="bg-slate-600 text-white text-center py-0.5 rounded text-[9px] font-semibold mb-1.5">FRENTE — PISO SUPERIOR</div>
          {renderGrid(2)}
        </div>
      </TabsContent>
      <TabsContent value="1" className="mt-0">
        <div className="bg-slate-50 rounded-md p-2 overflow-hidden">
          <div className="bg-slate-600 text-white text-center py-0.5 rounded text-[9px] font-semibold mb-1.5">FRENTE — PISO INFERIOR</div>
          {renderGrid(1)}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function TemplateCardTabbed({
  tpl,
  onSelect,
}: {
  tpl: LayoutTemplate;
  onSelect: (tpl: LayoutTemplate) => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const cells = useMemo(() => tpl.generate(tpl.rows, tpl.cols), [tpl]);
  const seatCount = useMemo(
    () => cells.filter(c => c.type === "seat" || c.type === "vip" || c.type === "accessible").length,
    [cells],
  );
  const floorCounts = useMemo(() => {
    const upper = cells.filter(c => (c.floor ?? 1) === 2 && (c.type === "seat" || c.type === "vip" || c.type === "accessible")).length;
    const lower = cells.filter(c => (c.floor ?? 1) === 1 && (c.type === "seat" || c.type === "vip" || c.type === "accessible")).length;
    return { upper, lower };
  }, [cells]);

  const meta = BUS_TYPE_META[tpl.busType] ?? BUS_TYPE_META.CONVENTIONAL;

  return (
    <>
      <div className="border rounded-lg p-3 space-y-2.5 bg-white hover:shadow-md hover:border-blue-300 transition-all">
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-xs font-semibold text-gray-900 leading-tight">{tpl.name}</p>
          <Badge variant="outline" className={`shrink-0 text-[9px] px-1.5 border ${meta.badgeCls}`}>
            {meta.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span>💺</span> {seatCount}</span>
          {tpl.floors > 1 && (
            <span className="flex items-center gap-1"><Layers className="h-3 w-3 text-purple-500" /> Sup {floorCounts.upper} · Inf {floorCounts.lower}</span>
          )}
        </div>

        <TabbedTemplatePreview
          cells={cells}
          rows={tpl.rows}
          cols={tpl.cols}
          floors={tpl.floors}
          compact={true}
        />

        <div className="flex gap-1.5 pt-0.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-[11px] h-7"
            onClick={() => setShowFull(true)}
          >
            <Eye className="h-3 w-3 mr-1" />
            Ver Completo
          </Button>
          <Button
            size="sm"
            className="flex-1 text-[11px] h-7 bg-blue-600 hover:bg-blue-700"
            onClick={() => onSelect(tpl)}
          >
            <Check className="h-3 w-3 mr-1" />
            Selecionar
          </Button>
        </div>
      </div>

      <Dialog open={showFull} onOpenChange={setShowFull}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bus className="h-4 w-4 text-blue-600" />
              {tpl.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Visualização completa do layout de assentos
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 flex-wrap text-xs text-muted-foreground mt-1">
            <span>💺 {seatCount} assentos</span>
            {tpl.floors > 1 && <span>🏢 Superior: {floorCounts.upper} · Inferior: {floorCounts.lower}</span>}
            <Badge variant="outline" className={`text-[10px] px-1.5 border ${meta.badgeCls}`}>{meta.label}</Badge>
          </div>

          <TabbedTemplatePreview
            cells={cells}
            rows={tpl.rows}
            cols={tpl.cols}
            floors={tpl.floors}
            compact={false}
          />

          <div className="flex gap-2 mt-2 pt-2 border-t text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-400 inline-block" /> Assento</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-400 inline-block" /> VIP</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-cyan-100 border border-cyan-400 inline-block" /> Banheiro</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-100 border border-purple-400 inline-block" /> Escada</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFull(false)}>Fechar</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setShowFull(false); onSelect(tpl); }}>
              <Check className="h-3 w-3 mr-1.5" />
              Selecionar Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface EditorState {
  name: string;
  description: string;
  vehicleType: string;
  rows: number;
  cols: number;
  floors: number;
  numberingType: string;
  cells: LayoutCell[];
  floorDimensions: Record<number, { rows: number; cols: number }>;
}

function LayoutEditorModal({
  open,
  initialData,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  initialData: EditorState | null;
  onClose: () => void;
  onSave: (data: EditorState) => void;
  saving: boolean;
}) {
  const isEdit = !!initialData?.cells?.length;
  const [form, setForm] = useState<EditorState>(() => {
    if (initialData) return initialData;
    const defaultFloorDims = { 1: { rows: 12, cols: 4 } };
    return {
      name: "",
      description: "",
      vehicleType: "Ônibus",
      rows: 12,
      cols: 4,
      floors: 1,
      numberingType: "sequential",
      cells: generateFloorCells(defaultFloorDims),
      floorDimensions: defaultFloorDims,
    };
  });
  const [selectedType, setSelectedType] = useState<CellType>("seat");
  const [editingFloor, setEditingFloor] = useState(1);
  const [filterBusType, setFilterBusType] = useState("all");
  const [showRenumberConfirm, setShowRenumberConfirm] = useState(false);

  const setField = <K extends keyof EditorState>(k: K) => (v: EditorState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const adjustGlobalFloors = (delta: number) => {
    setForm(f => {
      const newFloors = Math.max(1, Math.min(3, f.floors + delta));
      const newFloorDims = { ...f.floorDimensions };
      if (newFloors > f.floors) {
        for (let fl = f.floors + 1; fl <= newFloors; fl++) {
          if (!newFloorDims[fl]) newFloorDims[fl] = { rows: f.floorDimensions[1]?.rows ?? 12, cols: f.floorDimensions[1]?.cols ?? 4 };
        }
      } else {
        for (let fl = newFloors + 1; fl <= f.floors; fl++) {
          delete newFloorDims[fl];
        }
        if (editingFloor > newFloors) setEditingFloor(newFloors);
      }
      const newCells = generateFloorCells(newFloorDims, f.cells);
      const maxRows = Math.max(...Object.values(newFloorDims).map(d => d.rows));
      const maxCols = Math.max(...Object.values(newFloorDims).map(d => d.cols));
      let newNumberingType = f.numberingType;
      if (newFloors > 1) {
        if (f.numberingType === "sequential") newNumberingType = "sequential_upper_first";
        else if (f.numberingType === "by_row") newNumberingType = "by_row_upper_first";
        else if (f.numberingType === "brazilian_standard") newNumberingType = "brazilian_standard_upper_first";
      } else if (newFloors === 1) {
        if (f.numberingType === "sequential_upper_first") newNumberingType = "sequential";
        else if (f.numberingType === "by_row_upper_first") newNumberingType = "by_row";
        else if (f.numberingType === "brazilian_standard_upper_first") newNumberingType = "brazilian_standard";
      }
      return { ...f, floors: newFloors, rows: maxRows, cols: maxCols, floorDimensions: newFloorDims, cells: newCells, numberingType: newNumberingType };
    });
  };

  const adjustFloorDimension = (floor: number, dim: "rows" | "cols", delta: number) => {
    setForm(f => {
      const current = f.floorDimensions[floor] ?? { rows: 12, cols: 4 };
      const newVal = Math.max(1, Math.min(20, current[dim] + delta));
      const newFloorDims = { ...f.floorDimensions, [floor]: { ...current, [dim]: newVal } };
      const otherFloorCells = f.cells.filter(c => (c.floor ?? 1) !== floor);
      const thisFloorCells = generateFloorCells({ [floor]: newFloorDims[floor] }, f.cells.filter(c => (c.floor ?? 1) === floor));
      const newCells = [...otherFloorCells, ...thisFloorCells];
      const maxRows = Math.max(...Object.values(newFloorDims).map(d => d.rows));
      const maxCols = Math.max(...Object.values(newFloorDims).map(d => d.cols));
      return { ...f, rows: maxRows, cols: maxCols, floorDimensions: newFloorDims, cells: newCells };
    });
  };

  const applyTemplate = (tpl: LayoutTemplate) => {
    const templateFloorDims: Record<number, { rows: number; cols: number }> = {};
    for (let f = 1; f <= tpl.floors; f++) {
      templateFloorDims[f] = { rows: tpl.rows, cols: tpl.cols };
    }
    setForm(f => ({
      ...f,
      rows: tpl.rows,
      cols: tpl.cols,
      floors: tpl.floors,
      numberingType: tpl.numberingType,
      vehicleType: tpl.vehicleType,
      cells: tpl.generate(tpl.rows, tpl.cols),
      floorDimensions: templateFloorDims,
      name: f.name || tpl.name,
    }));
    setEditingFloor(1);
  };

  const handleCellClick = useCallback((row: number, col: number, floor: number) => {
    setForm(f => ({
      ...f,
      cells: f.cells.map(c =>
        c.row === row && c.col === col && (c.floor ?? 1) === floor ? { ...c, type: selectedType } : c,
      ),
    }));
  }, [selectedType]);

  const activeFloorDims = form.floorDimensions[editingFloor] ?? { rows: form.rows, cols: form.cols };
  const aisleAfterCol = Math.ceil(activeFloorDims.cols / 2);
  const cellSize = Math.min(42, Math.floor(320 / activeFloorDims.cols));
  const activeFloorCells = form.cells.filter(c => (c.floor ?? 1) === editingFloor);
  const previewLabelMap = useMemo(
    () => computePreviewLabels(form.cells, form.numberingType),
    [form.cells, form.numberingType],
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            {isEdit ? "Editar Layout" : "Novo Layout de Assentos"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Left panel: controls */}
          <div className="space-y-5">
            {/* Name & description */}
            <div className="space-y-3">
              <div>
                <Label>Nome do layout *</Label>
                <Input
                  placeholder="Ex: Ônibus 46 lugares"
                  value={form.name}
                  onChange={e => setField("name")(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Tipo de veículo</Label>
                <Select value={form.vehicleType} onValueChange={setField("vehicleType")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Ônibus", "Micro-ônibus", "Van", "Carro", "Barco", "Avião", "Outro"].map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Numeração</Label>
                <Select value={form.numberingType} onValueChange={setField("numberingType")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {form.floors > 1 ? (
                      <>
                        <SelectItem value="brazilian_standard_upper_first">🇧🇷 Padrão Brasileiro — Superior primeiro (ímpar=janela)</SelectItem>
                        <SelectItem value="sequential_upper_first">Sequencial — Superior primeiro (1, 2, 3…)</SelectItem>
                        <SelectItem value="sequential">Sequencial — Inferior primeiro (1, 2, 3…)</SelectItem>
                        <SelectItem value="by_row_upper_first">Por fileira — Superior primeiro (1A, 1B…)</SelectItem>
                        <SelectItem value="by_row">Por fileira — Inferior primeiro (1A, 1B…)</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="brazilian_standard">🇧🇷 Padrão Brasileiro (ímpar=janela, par=corredor)</SelectItem>
                        <SelectItem value="sequential">Sequencial (1, 2, 3…)</SelectItem>
                        <SelectItem value="by_row">Por fileira (1A, 1B, 2A…)</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea
                  placeholder="Observações..."
                  value={form.description}
                  onChange={e => setField("description")(e.target.value)}
                  className="mt-1 h-16"
                />
              </div>
            </div>

            {/* Dimensions */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dimensões</p>

              {/* Floors — always a shared control */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">Andares</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustGlobalFloors(-1)}>
                    <MinusCircle className="h-4 w-4" />
                  </Button>
                  <span className="w-6 text-center font-semibold text-sm">{form.floors}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustGlobalFloors(+1)}>
                    <PlusCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {form.floors === 1 ? (
                /* Single floor: rows + cols in the same panel */
                (["rows", "cols"] as const).map(dim => (
                  <div key={dim} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{dim === "rows" ? "Fileiras" : "Colunas"}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustFloorDimension(1, dim, -1)}>
                        <MinusCircle className="h-4 w-4" />
                      </Button>
                      <span className="w-6 text-center font-semibold text-sm">
                        {form.floorDimensions[1]?.[dim] ?? (dim === "rows" ? form.rows : form.cols)}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => adjustFloorDimension(1, dim, +1)}>
                        <PlusCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                /* Multi-floor: one sub-panel per floor (highest first) */
                Array.from({ length: form.floors }, (_, i) => form.floors - i).map(floorNum => {
                  const fd = form.floorDimensions[floorNum] ?? { rows: 12, cols: 4 };
                  const isEditing = editingFloor === floorNum;
                  return (
                    <div
                      key={floorNum}
                      className={`border rounded-md p-2.5 space-y-2 cursor-pointer transition-colors ${isEditing ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-400"}`}
                      onClick={() => setEditingFloor(floorNum)}
                    >
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        {floorNum === 2 ? "⬆️" : "⬇️"}
                        {floorNum}º Andar
                        {isEditing && <span className="ml-auto text-[10px] text-primary font-normal">editando</span>}
                      </p>
                      {(["rows", "cols"] as const).map(dim => (
                        <div key={dim} className="flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                          <span className="text-xs text-muted-foreground">{dim === "rows" ? "Fileiras" : "Colunas"}</span>
                          <div className="flex items-center gap-1.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingFloor(floorNum); adjustFloorDimension(floorNum, dim, -1); }}>
                              <MinusCircle className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-5 text-center font-semibold text-xs">{fd[dim]}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingFloor(floorNum); adjustFloorDimension(floorNum, dim, +1); }}>
                              <PlusCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>

            {/* Templates */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Templates rápidos</p>
              <div className="flex items-center gap-1.5">
                <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                <Select value={filterBusType} onValueChange={setFilterBusType}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="DOUBLE_DECKER">Double Decker</SelectItem>
                    <SelectItem value="CONVENTIONAL">Convencional</SelectItem>
                    <SelectItem value="EXECUTIVE">Executivo</SelectItem>
                    <SelectItem value="SEMI_LEITO">Semi-Leito</SelectItem>
                    <SelectItem value="LEITO">Leito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(() => {
                const filtered = filterBusType === "all" ? TEMPLATES : TEMPLATES.filter(t => t.busType === filterBusType);
                return (
                  <>
                    <p className="text-[10px] text-muted-foreground">{filtered.length} template{filtered.length !== 1 ? "s" : ""} disponível{filtered.length !== 1 ? "is" : ""}</p>
                    <div className="max-h-[420px] overflow-y-auto space-y-2 pr-0.5">
                      {filtered.map(tpl => (
                        <TemplateCardTabbed
                          key={tpl.name}
                          tpl={tpl}
                          onSelect={(t) => { applyTemplate(t); }}
                        />
                      ))}
                      {filtered.length === 0 && (
                        <p className="text-xs text-center text-muted-foreground py-4">Nenhum template encontrado</p>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Stats */}
            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Resumo</p>
              <LayoutStats cells={form.cells} />
            </div>
          </div>

          {/* Right panel: grid editor */}
          <div className="space-y-4">
            {/* Palette */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tipo de célula selecionado</p>
              <div className="flex flex-wrap gap-1.5">
                {CELL_TYPES.map(ct => (
                  <button
                    key={ct.type}
                    type="button"
                    onClick={() => setSelectedType(ct.type)}
                    className={`
                      px-2 py-1 rounded border-2 text-xs font-medium flex items-center gap-1 transition-all
                      ${ct.bg} ${ct.border} ${ct.text}
                      ${selectedType === ct.type ? "ring-2 ring-offset-1 ring-primary scale-105 shadow-sm" : "opacity-70 hover:opacity-100"}
                    `}
                  >
                    {ct.emoji} {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Floor tabs (only when floors > 1) */}
            {form.floors > 1 && (
              <div className="flex gap-1">
                {Array.from({ length: form.floors }).map((_, i) => {
                  const f = i + 1;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setEditingFloor(f)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold border transition-all ${
                        editingFloor === f
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-white text-muted-foreground border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      {f}º Andar
                    </button>
                  );
                })}
              </div>
            )}

            {/* Grid */}
            <div className="border rounded-lg p-4 bg-slate-50 overflow-auto">
              <div className="bg-slate-700 text-white text-center py-1.5 rounded-t text-xs font-semibold mb-3">
                🚌 FRENTE DO VEÍCULO{form.floors > 1 ? ` — ${editingFloor}º ANDAR` : ""}
              </div>

              <div className="space-y-1 inline-block min-w-full">
                {Array.from({ length: activeFloorDims.rows }).map((_, rIdx) => {
                  const row = rIdx + 1;
                  const rowCells = activeFloorCells.filter(c => c.row === row).sort((a, b) => a.col - b.col);
                  const leftCells = rowCells.filter(c => c.col <= aisleAfterCol);
                  const rightCells = rowCells.filter(c => c.col > aisleAfterCol);

                  return (
                    <div key={row} className="flex items-center gap-2 justify-center">
                      <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{row}</span>
                      <div className="flex gap-1">
                        {leftCells.map(cell => (
                          <GridCell
                            key={`${cell.floor ?? 1}-${cell.row}-${cell.col}`}
                            cell={cell}
                            selected={false}
                            onClick={() => handleCellClick(cell.row, cell.col, cell.floor ?? 1)}
                            cellSize={cellSize}
                            previewLabel={previewLabelMap.get(`${cell.floor ?? 1}-${cell.row}-${cell.col}`)}
                          />
                        ))}
                      </div>
                      <div className="w-4 border-l-2 border-dashed border-slate-300 self-stretch" />
                      <div className="flex gap-1">
                        {rightCells.map(cell => (
                          <GridCell
                            key={`${cell.floor ?? 1}-${cell.row}-${cell.col}`}
                            cell={cell}
                            selected={false}
                            onClick={() => handleCellClick(cell.row, cell.col, cell.floor ?? 1)}
                            cellSize={cellSize}
                            previewLabel={previewLabelMap.get(`${cell.floor ?? 1}-${cell.row}-${cell.col}`)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-center text-muted-foreground mt-3">
                Clique em uma célula para aplicar o tipo selecionado
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-green-600 text-green-700 hover:bg-green-50 mr-auto"
            onClick={() => setShowRenumberConfirm(true)}
          >
            🇧🇷 Renumerar assentos
          </Button>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
          >
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Criar Layout"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={showRenumberConfirm} onOpenChange={setShowRenumberConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renumerar assentos com padrão brasileiro?</AlertDialogTitle>
            <AlertDialogDescription>
              Os labels de todas as poltronas serão redefinidos seguindo o padrão brasileiro (ímpar = janela, par = corredor, da frente para o fundo{form.floors > 1 ? ", andar superior primeiro" : ""}).
              O tipo de numeração também será atualizado automaticamente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const newNumberingType = form.floors > 1 ? "brazilian_standard_upper_first" : "brazilian_standard";
                setForm(f => ({
                  ...f,
                  numberingType: newNumberingType,
                  cells: applyBrazilianNumbering(f.cells, f.floors),
                }));
                setShowRenumberConfirm(false);
              }}
            >
              Sim, renumerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function LayoutCard({
  layout,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  layout: VehicleLayout;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const cells = layout.cells as LayoutCell[];
  const floors = layout.floors ?? 1;
  const [previewFloor, setPreviewFloor] = useState(floors > 1 ? 2 : 1);

  useEffect(() => {
    if (previewFloor > floors) setPreviewFloor(1);
  }, [floors, previewFloor]);

  const activeFloorCells = cells.filter(c => (c.floor ?? 1) === previewFloor);
  const floorMaxCol = activeFloorCells.length > 0 ? Math.max(...activeFloorCells.map(c => c.col)) : layout.cols;
  const floorMaxRow = activeFloorCells.length > 0 ? Math.max(...activeFloorCells.map(c => c.row)) : layout.rows;
  const aisleAfterCol = Math.ceil(floorMaxCol / 2);
  const cellSize = Math.min(18, Math.floor(140 / floorMaxCol));
  const maxRows = Math.min(floorMaxRow, 12);

  return (
    <div className="border rounded-xl p-4 space-y-3 hover:shadow-md transition-shadow bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{layout.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {layout.vehicleType ?? "Veículo"} · {layout.rows} fileiras × {layout.cols} col. · {layout.seatCount} assentos
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mini preview */}
      <div className="bg-slate-50 rounded-lg p-2 overflow-hidden">
        {floors > 1 && (
          <div className="flex gap-1 mb-1.5">
            <button
              type="button"
              onClick={() => setPreviewFloor(2)}
              className={`flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[9px] font-semibold border transition-all ${previewFloor === 2 ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}
            >
              <ArrowUp className="h-2.5 w-2.5" /> Superior
            </button>
            <button
              type="button"
              onClick={() => setPreviewFloor(1)}
              className={`flex-1 flex items-center justify-center gap-0.5 py-0.5 rounded text-[9px] font-semibold border transition-all ${previewFloor === 1 ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"}`}
            >
              <ArrowDown className="h-2.5 w-2.5" /> Inferior
            </button>
          </div>
        )}
        <div className="bg-slate-600 text-white text-center py-0.5 rounded text-[10px] mb-1.5">FRENTE</div>
        <div className="space-y-0.5 inline-block w-full">
          {Array.from({ length: maxRows }).map((_, rIdx) => {
            const row = rIdx + 1;
            const rowCells = activeFloorCells.filter(c => c.row === row).sort((a, b) => a.col - b.col);
            const leftCells = rowCells.filter(c => c.col <= aisleAfterCol);
            const rightCells = rowCells.filter(c => c.col > aisleAfterCol);
            return (
              <div key={row} className="flex items-center gap-1 justify-center">
                <div className="flex gap-0.5">
                  {leftCells.map(cell => {
                    const info = cellTypeMap[cell.type] ?? cellTypeMap["seat"];
                    return (
                      <div
                        key={`${cell.row}-${cell.col}`}
                        style={{ width: cellSize, height: cellSize }}
                        className={`rounded-sm border ${info.bg} ${info.border} flex items-center justify-center`}
                        title={info.label}
                      >
                        <span style={{ fontSize: cellSize * 0.5 }}>{info.emoji}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="w-1.5 border-l border-dashed border-slate-300 self-stretch" />
                <div className="flex gap-0.5">
                  {rightCells.map(cell => {
                    const info = cellTypeMap[cell.type] ?? cellTypeMap["seat"];
                    return (
                      <div
                        key={`${cell.row}-${cell.col}`}
                        style={{ width: cellSize, height: cellSize }}
                        className={`rounded-sm border ${info.bg} ${info.border} flex items-center justify-center`}
                        title={info.label}
                      >
                        <span style={{ fontSize: cellSize * 0.5 }}>{info.emoji}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {floorMaxRow > maxRows && (
            <p className="text-center text-[10px] text-muted-foreground mt-1">
              +{floorMaxRow - maxRows} fileiras...
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {floors > 1 && <Badge variant="outline" className="text-[10px] px-1.5 bg-purple-50 text-purple-700 border-purple-300">🏢 {floors} andares</Badge>}
        {layout.numberingType?.includes("brazilian_standard")
          ? <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">🇧🇷 Padrão Brasileiro</Badge>
          : layout.numberingType?.includes("by_row")
          ? <Badge variant="outline" className="text-[10px] px-1.5">Numeração por fileira</Badge>
          : <Badge variant="outline" className="text-[10px] px-1.5">Numeração sequencial</Badge>}
        {layout.numberingType?.endsWith("_upper_first") && (
          <Badge variant="outline" className="text-[10px] px-1.5 bg-purple-50 text-purple-700 border-purple-300">Superior primeiro</Badge>
        )}
        <Badge variant="outline" className="text-[10px] px-1.5">💺 {layout.seatCount} assentos</Badge>
      </div>
    </div>
  );
}

export default function LayoutsPage() {
  const { data: subData } = useGetCurrentSubscription();
  const seatMapLocked = subData !== undefined &&
    !(subData.plan?.supportedFeatures ?? []).includes("seatMap");
  const seatMapCanUpgrade = canUpgradeForFeature(subData, "seatMap");

  const { data: layouts = [], isLoading, isError, refetch } = useListLayouts({ query: { queryKey: ["layouts"] } });
  const createLayout = useCreateLayout();
  const updateLayout = useUpdateLayout();
  const deleteLayout = useDeleteLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState<VehicleLayout | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VehicleLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveWarning, setSaveWarning] = useState<{
    pendingForm: EditorState;
    activeTripsCount: number;
    confirmedReservationsCount: number;
  } | null>(null);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["layouts"] });

  const openCreate = () => {
    setEditingLayout(null);
    setEditorOpen(true);
  };

  const openEdit = (layout: VehicleLayout) => {
    setEditingLayout(layout);
    setEditorOpen(true);
  };

  const openDuplicate = (layout: VehicleLayout) => {
    setEditingLayout({
      ...layout,
      id: "",
      name: `${layout.name} (cópia)`,
    });
    setEditorOpen(true);
  };

  const doSave = async (form: EditorState) => {
    setSaving(true);
    const floorDimValues = Object.values(form.floorDimensions);
    const persistRows = floorDimValues.length > 0 ? Math.max(...floorDimValues.map(d => d.rows)) : form.rows;
    const persistCols = floorDimValues.length > 0 ? Math.max(...floorDimValues.map(d => d.cols)) : form.cols;
    // Legacy layouts may have cells without the `floor` property, which the
    // backend Zod schema now requires. Normalise every cell so the PUT
    // validation always passes.
    const cells = form.cells.map(c => ({ ...c, floor: c.floor ?? 1 }));
    try {
      if (editingLayout?.id) {
        await updateLayout.mutateAsync({
          id: editingLayout.id,
          data: {
            name: form.name,
            description: form.description || null,
            vehicleType: form.vehicleType || null,
            rows: persistRows,
            cols: persistCols,
            floors: form.floors,
            numberingType: form.numberingType,
            cells,
          },
        });
        toast({ title: "Layout atualizado com sucesso" });
      } else {
        await createLayout.mutateAsync({
          data: {
            name: form.name,
            description: form.description || null,
            vehicleType: form.vehicleType || null,
            rows: persistRows,
            cols: persistCols,
            floors: form.floors,
            numberingType: form.numberingType,
            cells,
          },
        });
        toast({ title: "Layout criado com sucesso" });
      }
      invalidate();
      setEditorOpen(false);
    } catch {
      toast({ title: "Erro ao salvar layout", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (form: EditorState) => {
    if (!form.name.trim()) return;

    if (editingLayout?.id) {
      setSaving(true);
      try {
        const res = await fetch(`${BASE}/api/layouts/${editingLayout.id}/usage`, {
          credentials: "include",
        });
        if (res.ok) {
          const usage = await res.json() as { activeTripsCount: number; confirmedReservationsCount: number };
          if (usage.confirmedReservationsCount > 0) {
            setSaving(false);
            setSaveWarning({ pendingForm: form, ...usage });
            return;
          }
        }
      } catch {
        // If the check fails, proceed with save (don't block the user)
      }
      setSaving(false);
    }

    await doSave(form);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLayout.mutateAsync({ id: deleteTarget.id });
      toast({ title: "Layout excluído" });
      invalidate();
    } catch {
      toast({ title: "Erro ao excluir layout", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const editorInitialData: EditorState | null = useMemo(() => {
    if (!editorOpen) return null;
    if (!editingLayout) return null;
    const cells = editingLayout.cells as LayoutCell[];
    const floors = editingLayout.floors ?? 1;
    const floorDimensions = deriveFloorDimensions(cells, floors, {
      rows: editingLayout.rows,
      cols: editingLayout.cols,
    });
    return {
      name: editingLayout.name ?? "",
      description: (editingLayout as VehicleLayout & { description?: string }).description ?? "",
      vehicleType: editingLayout.vehicleType ?? "Ônibus",
      rows: editingLayout.rows,
      cols: editingLayout.cols,
      floors,
      numberingType: editingLayout.numberingType,
      cells,
      floorDimensions,
    };
  }, [editorOpen, editingLayout]);

  if (seatMapLocked) {
    const seatMapRequiredPlan = getRequiredPlanLabel(subData, "seatMap") ?? "Pro";
    return (
      <PlanFeatureWall
        featureLabel="Layouts de Assentos"
        currentPlanLabel={subData?.plan?.name}
        requiredPlanLabel={seatMapRequiredPlan}
        description={`O mapa de assentos personalizável está disponível a partir do plano ${seatMapRequiredPlan}.`}
        canUpgrade={seatMapCanUpgrade}
      />
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            Layouts de Assentos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crie e gerencie mapas de assentos reutilizáveis para seus veículos
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Layout
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="border rounded-xl p-4 h-48 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : isError ? (
        <ListLoadError onRetry={refetch} message="Não foi possível carregar os layouts." />
      ) : layouts.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl p-12 text-center space-y-3">
          <Armchair className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">Nenhum layout criado ainda</p>
          <p className="text-sm text-muted-foreground">
            Crie um layout para definir a disposição de assentos dos seus veículos
          </p>
          <Button onClick={openCreate} className="mt-2 gap-2">
            <Plus className="h-4 w-4" />
            Criar primeiro layout
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {layouts.map(layout => (
            <LayoutCard
              key={layout.id}
              layout={layout}
              onEdit={() => openEdit(layout)}
              onDuplicate={() => openDuplicate(layout)}
              onDelete={() => setDeleteTarget(layout)}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {editorOpen && (
        <LayoutEditorModal
          key={editingLayout?.id ?? "new"}
          open={editorOpen}
          initialData={editorInitialData}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir layout?</AlertDialogTitle>
            <AlertDialogDescription>
              O layout <strong>{deleteTarget?.name}</strong> será excluído permanentemente.
              Viagens que usam este layout manterão seus mapas de assentos existentes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save warning — confirmed reservations exist */}
      <AlertDialog open={!!saveWarning} onOpenChange={v => !v && setSaveWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Viagens com reservas confirmadas</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Este layout está sendo usado por{" "}
                  <strong>{saveWarning?.activeTripsCount} viagem{saveWarning?.activeTripsCount !== 1 ? "ns" : ""} ativa{saveWarning?.activeTripsCount !== 1 ? "s" : ""}</strong>{" "}
                  com{" "}
                  <strong>{saveWarning?.confirmedReservationsCount} reserva{saveWarning?.confirmedReservationsCount !== 1 ? "s" : ""} confirmada{saveWarning?.confirmedReservationsCount !== 1 ? "s" : ""}</strong>.
                </p>
                <p>
                  Salvar alterações no layout (especialmente mudanças de numeração ou tipo de assento)
                  pode deixar passageiros com referências de assentos inválidas. Verifique os manifestos
                  de passageiros após salvar.
                </p>
                <p>Deseja salvar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSaveWarning(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                const form = saveWarning!.pendingForm;
                setSaveWarning(null);
                void doSave(form);
              }}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
