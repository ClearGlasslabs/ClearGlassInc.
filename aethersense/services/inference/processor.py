import numpy as np
from scipy import signal
from pydantic import BaseModel
class Metric(BaseModel):
 value:float|None;unit:str;confidence:float;signalQuality:str;status:str;sampleWindowSec:float;timestamp:float
class Result(BaseModel):
 people:list[dict];signal:dict;vitals:dict;system:dict

def extract_amplitude_phase(frames):
 return np.asarray([f['amplitudes'] for f in frames],float),np.asarray([f['phases'] for f in frames],float)
def unwrap_phase(phases): return np.unwrap(phases,axis=1) if phases.size else phases
def hampel(x,window=7,n_sigma=3.0):
 x=np.asarray(x,float);y=x.copy();half=window//2
 for i in range(half,len(x)-half):
  w=x[i-half:i+half+1];med=np.median(w);mad=np.median(np.abs(w-med))+1e-9
  if abs(x[i]-med)>n_sigma*1.4826*mad:y[i]=med
 return y
def normalize(x):
 x=np.asarray(x,float);z=x-np.nanmean(x);s=np.nanstd(z);return z/(s+1e-9)
def temporal_features(sig,fs):
 f,p=signal.welch(sig,fs=fs,nperseg=min(len(sig),int(fs*32)));return f,p
def band_peak(x,fs,lo,hi):
 if len(x)<int(fs*8):return None,0.0
 f,p=temporal_features(x,fs);m=(f>=lo)&(f<=hi)
 if not np.any(m):return None,0.0
 i=np.argmax(p[m]);freq=f[m][i];rel=float(p[m][i]/(np.sum(p[m])+1e-12));return float(freq),min(1.,rel*12)
class BaselineSensingModel:
 def __init__(self,sample_rate=20):self.fs=sample_rate
 def infer(self,frames):
  if not frames:return self.empty()
  amp,phase=extract_amplitude_phase(frames);phase=unwrap_phase(phase)
  # Robust subcarrier aggregation: reject transient packet outliers then normalize.
  clean=np.apply_along_axis(hampel,0,amp,7,3.0);series=normalize(np.median(clean,axis=1));var=float(np.var(series));motion=float(np.sqrt(np.mean(series**2)))
  quality=min(1.,max(0.,var/(var+0.35)));present=var>0.18
  br,bc=band_peak(series,self.fs,.1,.5);hr,hc=band_peak(series,self.fs,.7,2.0)
  def metric(v,unit,c):
   q='good' if c>.55 else 'fair' if c>.30 else 'insufficient';return Metric(value=None if v is None else round(v*60,1),unit=unit,confidence=round(c,2),signalQuality=q,status='experimental',sampleWindowSec=round(len(series)/self.fs,1),timestamp=float(frames[-1]['timestamp']))
  activity='walking' if motion>.9 else 'standing' if present else 'stationary';conf=round(max(.35,quality),2)
  people=[{'id':'Person 01','x':.52,'y':.48,'motion':round(min(1.,motion/2),2),'activity':activity,'confidence':conf}] if present else []
  return Result(people=people,signal={'packetRate':self.fs,'quality':'good' if quality>.55 else 'fair' if quality>.3 else 'poor','variance':round(var,6)},vitals={'breathingRate':metric(br,'breaths/min',bc),'heartRate':metric(hr,'bpm',hc)},system={'mode':'simulator','connectedNodes':1,'calibrated':True,'recording':False,'model':'baseline-csi-v0.1'})
 def empty(self):
  m=Metric(value=None,unit='unknown',confidence=0,signalQuality='insufficient',status='unavailable',sampleWindowSec=0,timestamp=0)
  return Result(people=[],signal={'packetRate':0,'quality':'insufficient','variance':0},vitals={'breathingRate':m,'heartRate':m},system={'mode':'simulator','connectedNodes':0,'calibrated':False,'recording':False,'model':'baseline-csi-v0.1'})
