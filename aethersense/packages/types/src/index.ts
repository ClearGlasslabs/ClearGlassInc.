export type Source = 'simulator' | 'esp32' | 'replay';
export type SignalQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'insufficient';
export type Activity = 'stationary' | 'walking' | 'sitting' | 'standing' | 'lying' | 'possible fall' | 'unknown';
export interface CSIFrame { timestamp:number; source:Source; nodeId:string; rssi:number; channel:number; subcarriers:number[]; amplitudes:number[]; phases:number[]; }
export interface CSIWindow { frames:CSIFrame[]; sampleRate:number; }
export interface Metric { value:number|null; unit:string; confidence:number; signalQuality:SignalQuality; status:'estimate'|'experimental'|'unavailable'; sampleWindowSec:number; timestamp:number; }
export interface Telemetry { type:'telemetry'; timestamp:string; source:Source; roomId:string; people:{id:string;x:number;y:number;motion:number;activity:Activity;confidence:number}[]; signal:{packetRate:number;quality:SignalQuality;variance:number}; vitals:{breathingRate:Metric;heartRate:Metric}; system:{mode:Source;connectedNodes:number;calibrated:boolean;recording:boolean;model:string}; }
