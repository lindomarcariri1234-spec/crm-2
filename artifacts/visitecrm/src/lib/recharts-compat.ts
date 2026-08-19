/**
 * Recharts compatibility shims for React 19.
 *
 * Recharts ships class-based chart components (XAxis, YAxis, Bar, …) whose
 * static context types pre-date React 19's stricter JSX element constraints,
 * causing TS2786 / TS2607 errors.  Each affected component is re-cast to
 * React.ComponentType<ExportedPropType> so TypeScript accepts them in JSX
 * while preserving full prop type-checking.
 *
 * Components that are already ForwardRefExoticComponent (BarChart, LineChart,
 * PieChart, AreaChart, ResponsiveContainer, CartesianGrid, Area, Cell, …)
 * work without shims and are re-exported as-is for convenience.
 */
import React from "react";
import type {
  XAxisProps,
  YAxisProps,
  TooltipProps,
  LegendProps,
  BarProps,
  LineProps,
  AreaProps,
  PieProps,
  SectorProps,
  CellProps,
} from "recharts";
import {
  XAxis as _XAxis,
  YAxis as _YAxis,
  Tooltip as _Tooltip,
  Legend as _Legend,
  Bar as _Bar,
  Line as _Line,
  Area as _Area,
  Pie as _Pie,
  Sector as _Sector,
  Cell as _Cell,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// recharts exports ValueType/NameType only from internal paths; define locally
// to match their exact shapes from recharts/types/component/DefaultTooltipContent.
export type ValueType = number | string | (number | string)[];
export type NameType = number | string;

type RC<P> = React.ComponentType<P>;

export const XAxis    = _XAxis   as unknown as RC<XAxisProps>;
export const YAxis    = _YAxis   as unknown as RC<YAxisProps>;
export const Tooltip  = _Tooltip as unknown as RC<TooltipProps<ValueType, NameType>>;
export const Legend   = _Legend  as unknown as RC<LegendProps>;
export const Bar      = _Bar     as unknown as RC<BarProps>;
export const Line     = _Line    as unknown as RC<LineProps>;
export const Area     = _Area    as unknown as RC<AreaProps>;
export const Pie      = _Pie     as unknown as RC<PieProps>;
export const Sector   = _Sector  as unknown as RC<SectorProps>;
export const Cell     = _Cell    as unknown as RC<CellProps>;

// Re-export ForwardRef components (no shim needed)
export { BarChart, LineChart, AreaChart, PieChart, ResponsiveContainer, CartesianGrid };
