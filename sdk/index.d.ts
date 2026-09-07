export declare const PACKAGE_VERSION: "0.1.0";
export declare const API_VERSION: "v1";
export declare const PDFJS_VERSION: "6.1.200";
export declare const PDF_LIB_VERSION: "1.17.1";

export type PdfInput = Blob | ArrayBuffer | Uint8Array;
export interface NamedPdfInput { data: PdfInput; name?: string }
export type PdfLibRuntime = typeof import("pdf-lib");
export type PdfJsRuntime = typeof import("pdfjs-dist");
export interface PdfJsAssets {
  standardFontDataUrl?: string;
  cMapUrl?: string;
  cMapPacked?: boolean;
  wasmUrl?: string;
  [key: string]: unknown;
}
export interface CanvasFactory {
  (width: number, height: number): HTMLCanvasElement;
}
export interface ProgressEvent {
  operation: "merge" | "inspect" | "diagnose" | "normalize";
  phase?: string;
  percent?: number;
  page?: number;
  pageCount?: number;
  fileName?: string;
  fileIndex?: number;
  fileCount?: number;
  mode?: "quick" | "deep";
}
export interface CommonOptions { signal?: AbortSignal; onProgress?: (event: ProgressEvent) => void }
export interface PdfJsOptions extends CommonOptions { pdfjs: PdfJsRuntime; pdfjsAssets?: PdfJsAssets }
export interface FullRuntimeOptions extends PdfJsOptions { pdfLib: PdfLibRuntime; createCanvas?: CanvasFactory }
export type QuickDiagnosisOptions = FullRuntimeOptions & { mode?: "quick" };
export type DeepDiagnosisOptions = Omit<FullRuntimeOptions, "createCanvas"> & { mode: "deep"; createCanvas: CanvasFactory };

export interface PrivacyReport {
  version: number; pageCount: number;
  encryption: { encrypted: boolean; locked: boolean };
  standardMetadata: { count: number; fields: string[] };
  xmp: { present: boolean };
  sensitiveText: { count: number; truncated: boolean; categories: Record<string, number>; findings: Array<Record<string, unknown>> };
  warnings: string[]; limitations: string[];
  [key: string]: unknown;
}
export interface DoctorReport {
  version: number; mode: "quick" | "deep"; pageCount: number;
  parses: Record<string, { ok: boolean; error?: { name: string } }>;
  pageTree: { pdfLibCount: number; pdfjsCount: number; consistent: boolean };
  inspectionErrors: { count: number; categories: string[]; locations: Array<Record<string, unknown>>; truncated: boolean };
  warnings: string[]; limitations: string[];
  [key: string]: unknown;
}
export interface NormalizeResult {
  bytes: Uint8Array;
  diagnosis: Record<string, unknown>;
  verification: { pdfLibStrict: true; pdfjsStrict: true; renderedPages: number[] };
  lossManifest: { action: "normalize-structure"; changes: string[]; preservationIntent: string[]; losses: string[]; risks: string[] };
}

export declare function mergeV1(inputs: Array<PdfInput | NamedPdfInput>, options: CommonOptions & { pdfLib: PdfLibRuntime }): Promise<Uint8Array>;
export declare function inspectV1(input: PdfInput, options: PdfJsOptions & { maxMatches?: number }): Promise<PrivacyReport>;
export declare function diagnoseV1(input: PdfInput, options: QuickDiagnosisOptions | DeepDiagnosisOptions): Promise<DoctorReport>;
export declare function normalizeV1(input: PdfInput, options: Omit<FullRuntimeOptions, "createCanvas"> & { createCanvas: CanvasFactory }): Promise<NormalizeResult>;
