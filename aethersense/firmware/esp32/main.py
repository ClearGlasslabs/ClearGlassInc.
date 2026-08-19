import json, math, socket, time
from machine import Pin
# ESP32-S3 CSI transport reference. Build with ESP-IDF/Arduino-ESP32 CSI callback support.
UDP_HOST='192.168.1.10'; UDP_PORT=9000; NODE_ID='esp32s3-01'
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)

def send_csi(rssi,channel,amps,phases):
    payload={'timestamp':time.time(),'source':'esp32','nodeId':NODE_ID,'rssi':int(rssi),'channel':int(channel),'subcarriers':list(range(-len(amps)//2,len(amps)//2)),'amplitudes':[float(x) for x in amps],'phases':[float(x) for x in phases]}
    s.sendto(json.dumps(payload,separators=(',',':')).encode(),(UDP_HOST,UDP_PORT))

# Wire this function to the platform CSI callback. Never put Wi-Fi credentials in payloads.
def csi_callback(rssi,channel,raw_complex):
    amps=[math.hypot(float(x[0]),float(x[1])) for x in raw_complex]
    phases=[math.atan2(float(x[1]),float(x[0])) for x in raw_complex]
    send_csi(rssi,channel,amps,phases)

while False: pass
