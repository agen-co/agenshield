import type { ComponentType } from 'react';
import type { HandleSpec, SystemComponentType } from '../../Canvas.types';

export type { HandleSpec };

export interface ChipLayout {
  body: { x: number; y: number; w: number; h: number };
}

export interface ThemeCtx {
  isDark: boolean;
  chipBody: string;
  chipBorder: string;
  padColor: string;
  pinColor: string;
  traceClr: string;
  silkColor: string;
  silkDim: string;
}

export interface VariantProps {
  componentType: SystemComponentType;
  label: string;
  sublabel: string;
  refDesignator: string;
  theme: ThemeCtx;
  layout: ChipLayout;
  w: number;
  h: number;
  /** Allocated bottom handle offsets — variants skip their own bottom pins when present */
  bottomHandles?: number[];
}

export interface VariantModule {
  w: number;
  h: number;
  refDesignator: string;
  layout: ChipLayout;
  defaultHandles: HandleSpec[];
  Component: ComponentType<VariantProps>;
}
