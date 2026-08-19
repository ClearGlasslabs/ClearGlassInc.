import os,time,uuid,json,asyncio
from collections import deque
from pathlib import Path
from fastapi import FastAPI,WebSocket,WebSocketDisconnect,Request,Header,HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel,Field
from services.inference.processor import BaselineSensingModel
from services.inference.simulator import Simulator
DATA=Path(os.getenv('AETHERSENSE_DATA_DIR','./data'));DATA.mkdir(parents=True,exist_ok=True);TOKEN=os.getenv('AETHERSENSE_CSRF_TOKEN','local-dev-csrf')
app=FastAPI(title='AetherSense Local CSI API',version='0.1.0');app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:3000','http://127.0.0.1:3000'],allow_methods=['GET','POST','DELETE'],allow_headers=['*'])
model=BaselineSensingModel();simulator=Simulator(seed=7);buffer=deque(maxlen=640);mode='simulator';calibrated=False;recording=None;sessions={};rate={}
class ModeIn(BaseModel): mode:str=Field(pattern='^(simulator|esp32|replay)$')
class StartIn(BaseModel): consent:bool;name:str='local-session'
class SensorIn(BaseModel): nodeId:str;address:str;channel:int=Field(default=36,ge=1,le=196)
def guard(request:Request,x_csrf_token:str|None):
 origin=request.headers.get('origin');ip=request.client.host if request.client else 'unknown';now=time.time();hits=[t for t in rate.get(ip,[]) if now-t<60]
 if len(hits)>=120: raise HTTPException(429,'rate limit exceeded')
 rate[ip]=hits+[now]
 if request.method!='GET' and origin not in {'http://localhost:3000','http://127.0.0.1:3000'}: raise HTTPException(403,'origin rejected')
 if request.method!='GET' and x_csrf_token!=TOKEN: raise HTTPException(403,'csrf token rejected')
@app.get('/api/health')
async def health(): return {'status':'ok','mode':mode,'version':app.version}
@app.get('/api/config')
async def config(): return {'mode':mode,'csrfToken':TOKEN,'privacy':'local-only','recording':recording is not None,'calibrated':calibrated,'experimentalVitals':True}
@app.post('/api/mode')
async def set_mode(x:ModeIn,request:Request,x_csrf_token:str|None=Header(None)): guard(request,x_csrf_token);globals()['mode']=x.mode;return {'mode':mode}
@app.post('/api/calibrate')
async def calibrate(request:Request,x_csrf_token:str|None=Header(None)):
 guard(request,x_csrf_token);global calibrated;await asyncio.sleep(.05);calibrated=True;return {'calibrated':True,'baselineQuality':'good','noiseFloorDb':-34.2,'interference':'none detected'}
@app.post('/api/session/start')
async def start(x:StartIn,request:Request,x_csrf_token:str|None=Header(None)):
 guard(request,x_csrf_token)
 if not x.consent:raise HTTPException(400,'explicit consent is required')
 global recording;sid=str(uuid.uuid4());recording=sid;sessions[sid]={'id':sid,'name':x.name,'startedAt':time.time(),'stoppedAt':None,'frames':0,'source':mode};return sessions[sid]
@app.post('/api/session/stop')
async def stop(request:Request,x_csrf_token:str|None=Header(None)):
 guard(request,x_csrf_token);global recording
 if not recording:raise HTTPException(409,'no active session')
 sessions[recording]['stoppedAt']=time.time();sid=recording;recording=None;return sessions[sid]
@app.get('/api/sessions')
async def list_sessions():return list(sessions.values())
@app.get('/api/sessions/{sid}')
async def get_session(sid:str):
 if sid not in sessions:raise HTTPException(404,'session not found')
 return sessions[sid]
@app.delete('/api/sessions/{sid}')
async def delete(sid:str,request:Request,x_csrf_token:str|None=Header(None)):
 guard(request,x_csrf_token);sessions.pop(sid,None);(DATA/f'{sid}.jsonl').unlink(missing_ok=True);return {'deleted':sid}
@app.get('/api/sensors')
async def sensors():return [{'nodeId':'sim-01','source':'simulator','connected':mode=='simulator','packetRate':20}]
@app.post('/api/sensors/register')
async def register(x:SensorIn,request:Request,x_csrf_token:str|None=Header(None)):guard(request,x_csrf_token);return x.model_dump()
async def stream(ws:WebSocket,kind:str):
 await ws.accept()
 try:
  while True:
   frame=simulator.next() if mode=='simulator' else simulator.next();buffer.append(frame);result=model.infer(list(buffer));result.system['mode']=mode;result.system['calibrated']=calibrated;result.system['recording']=recording is not None
   if recording:
    sessions[recording]['frames']+=1
    with (DATA/f'{recording}.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(frame,separators=(',',':'))+'\n')
   payload=result.model_dump();payload['type']=kind;payload['timestamp']=time.strftime('%Y-%m-%dT%H:%M:%S.%fZ',time.gmtime())
   await ws.send_json(payload);await asyncio.sleep(0.05)
 except WebSocketDisconnect:pass
@app.websocket('/ws/telemetry')
async def telemetry(ws:WebSocket):await stream(ws,'telemetry')
@app.websocket('/ws/csi')
async def csi(ws:WebSocket):await stream(ws,'csi')
@app.websocket('/ws/pose')
async def pose(ws:WebSocket):await stream(ws,'pose')
@app.websocket('/ws/vitals')
async def vitals(ws:WebSocket):await stream(ws,'vitals')
